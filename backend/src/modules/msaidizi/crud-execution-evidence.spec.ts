import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Capability } from '../../common/capabilities/capability-manifest';
import {
  CRUD_EVIDENCE_CONTRACT,
  CRUD_EVIDENCE_FIXTURES,
  CRUD_EVIDENCE_HARNESS_VERSION,
  CRUD_EVIDENCE_MAX_CASE_ASSERTIONS,
  CrudEvidencePayload,
  CrudFixtureRegistration,
  CrudMetadataReadFixtureRegistration,
  capabilityContractDigest,
  canonicalJson,
  crudEvidenceFixturePacksForManifest,
  crudEvidenceFixturesForManifest,
  evaluateMetadataReadCompanyMarkers,
  exactRecordReadEvidenceFixtures,
  fixtureContractDigest,
  manifestContractDigest,
  metadataReadEvidenceBlockers,
  metadataReadEvidenceFixtures,
  prismaSchemaMigrationDigest,
  signCrudEvidenceArtifact,
  verifyCrudEvidenceArtifact,
} from './crud-execution-evidence';
import {
  CRUD_PATH_READ_REVIEWED_DEFINITION_COUNT,
  CRUD_PATH_READ_REMAINING_BLOCKERS,
  pathRecordReadEvidencePacks,
} from './crud-path-read-evidence';

const NOW = new Date('2026-08-25T12:00:00.000Z');
const BUILD_DIGEST = 'b'.repeat(64);
const PRISMA_DIGEST = 'c'.repeat(64);

function capability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: 'CustomersController.findAll',
    controller: 'CustomersController',
    handler: 'findAll',
    verb: 'GET',
    path: 'customers',
    permissions: ['customers.view'],
    anyPermissions: [],
    roles: [],
    apiScopes: [],
    guard: 'permission',
    tier: 'green',
    tierReason: 'read-verb',
    params: { path: [], query: [], freeFormQuery: false, hasBody: false },
    agentExcluded: false,
    ...overrides,
  };
}

const fixture: CrudFixtureRegistration = {
  fixtureId: 'customer-list-positive',
  fixtureVersion: 1,
  capabilityId: 'CustomersController.findAll',
  controlKind: 'positive',
  description: 'test fixture',
  governance: { scope: 'company', audit: 'not_applicable' },
};

describe('signed CRUD execution evidence', () => {
  const keys = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const otherKeys = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const manifest = [capability()];

  function payload(overrides: Partial<CrudEvidencePayload> = {}): CrudEvidencePayload {
    return {
      contract: CRUD_EVIDENCE_CONTRACT,
      harnessVersion: CRUD_EVIDENCE_HARNESS_VERSION,
      runId: 'run_evidence_1',
      generatedAt: '2026-08-25T11:59:00.000Z',
      expiresAt: '2026-08-26T11:59:00.000Z',
      manifestDigest: manifestContractDigest(manifest),
      provenance: {
        applicationBuildDigest: BUILD_DIGEST,
        prismaSchemaMigrationDigest: PRISMA_DIGEST,
      },
      database: {
        disposable: true,
        isolatedSchemaNameDigest: 'a'.repeat(64),
      },
      cases: [
        {
          fixtureId: fixture.fixtureId,
          fixtureVersion: fixture.fixtureVersion,
          capabilityId: fixture.capabilityId,
          capabilityContractDigest: capabilityContractDigest(manifest[0]),
          fixtureContractDigest: fixtureContractDigest(fixture),
          controlKind: 'positive',
          outcome: 'passed',
          httpStatus: 200,
          assertions: [{ name: 'returned seeded customer', passed: true }],
          finishedAt: '2026-08-25T11:59:30.000Z',
        },
      ],
      ...overrides,
    };
  }

  function verify(
    input: unknown,
    targetManifest = manifest,
    targetFixtures: readonly CrudFixtureRegistration[] = [fixture],
    expectedBuildDigest = BUILD_DIGEST,
    expectedPrismaDigest = PRISMA_DIGEST,
  ) {
    return verifyCrudEvidenceArtifact(input, targetManifest, {
      publicKeyPem: keys.publicKey,
      expectedKeyId: 'evidence-key-1',
      expectedApplicationBuildDigest: expectedBuildDigest,
      expectedPrismaSchemaMigrationDigest: expectedPrismaDigest,
      now: NOW,
      maxAgeMs: 24 * 60 * 60 * 1000,
      fixtures: targetFixtures,
    });
  }

  function signedArtifactFor(
    targetManifest: readonly Capability[],
    targetFixtures: readonly CrudFixtureRegistration[],
    outcomes: Readonly<Record<string, 'passed' | 'failed' | 'skipped'>> = {},
  ) {
    const byId = new Map(targetManifest.map((item) => [item.id, item]));
    return signCrudEvidenceArtifact(
      payload({
        manifestDigest: manifestContractDigest(targetManifest),
        cases: targetFixtures.map((targetFixture) => {
          const targetCapability = byId.get(targetFixture.capabilityId)!;
          const outcome = outcomes[targetFixture.fixtureId] ?? 'passed';
          return {
            fixtureId: targetFixture.fixtureId,
            fixtureVersion: targetFixture.fixtureVersion,
            capabilityId: targetFixture.capabilityId,
            capabilityContractDigest: capabilityContractDigest(targetCapability),
            fixtureContractDigest: fixtureContractDigest(targetFixture),
            controlKind: targetFixture.controlKind,
            outcome,
            ...(outcome === 'skipped' ? {} : { httpStatus: outcome === 'passed' ? 200 : 422 }),
            assertions: [
              {
                name: 'exact fixture contract completed',
                passed: outcome === 'passed',
              },
            ],
            finishedAt: '2026-08-25T11:59:30.000Z',
          };
        }),
      }),
      keys.privateKey,
      'evidence-key-1',
    );
  }

  it('registers the exact expected base security controls, including Fixed Assets scope denial', () => {
    const controls = CRUD_EVIDENCE_FIXTURES.filter(
      (candidate) => candidate.controlKind !== 'positive',
    );

    expect(controls).toHaveLength(7);
    expect(
      controls.filter((candidate) => candidate.controlKind === 'permission_denial'),
    ).toHaveLength(3);
    expect(controls.map((candidate) => candidate.fixtureId).sort()).toEqual(
      [
        'contracts-list-sensitive-permission-denial',
        'customer-agent-audit-attribution',
        'customer-company-isolation',
        'customer-create-permission-denial',
        'customer-create-service-principal-task-scope',
        'fixed-assets-dispose-group-scope-denial',
        'user-dashboard-list-autopilot-mandate-scope',
      ].sort(),
    );
    expect(
      controls.filter((candidate) => candidate.controlKind === 'service_principal_task_scope'),
    ).toHaveLength(2);
    expect(
      controls.find(
        (candidate) => candidate.fixtureId === 'fixed-assets-dispose-group-scope-denial',
      ),
    ).toEqual({
      fixtureId: 'fixed-assets-dispose-group-scope-denial',
      fixtureVersion: 1,
      capabilityId: 'FixedAssetsController.dispose',
      controlKind: 'permission_denial',
      description:
        'A COMPANY-scoped principal deliberately carrying fixed-assets.update receives HTTP 403 before disposal and emits one strict GROUP-scoped sensitive-denial audit event.',
    });
  });

  it('accepts a fresh signature bound to the exact manifest, capability and fixture version', () => {
    const artifact = signCrudEvidenceArtifact(payload(), keys.privateKey, 'evidence-key-1');

    const result = verify(artifact);

    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      expect(result.positiveEvidence).toEqual({
        'CustomersController.findAll': {
          cases: ['customer-list-positive'],
          lastVerifiedAt: '2026-08-25T11:59:30.000Z',
        },
      });
      expect(result.governanceEvidence['CustomersController.findAll']).toEqual({
        authorizationContract: { passed: true },
        scope: {
          classification: 'company',
          required: true,
          passed: true,
          cases: ['customer-list-positive'],
        },
        auditAttribution: { required: false, passed: true, cases: [] },
      });
    }
  });

  it('accepts a bounded compound proof and rejects one assertion beyond the envelope', () => {
    const artifactWithAssertionCount = (count: number) => {
      const unsigned = payload();
      unsigned.cases[0].assertions = Array.from({ length: count }, (_, index) => ({
        name: `independent compound assertion ${index + 1}`,
        passed: true,
      }));
      return signCrudEvidenceArtifact(unsigned, keys.privateKey, 'evidence-key-1');
    };

    expect(verify(artifactWithAssertionCount(CRUD_EVIDENCE_MAX_CASE_ASSERTIONS)).status).toBe(
      'accepted',
    );
    expect(verify(artifactWithAssertionCount(CRUD_EVIDENCE_MAX_CASE_ASSERTIONS + 1))).toMatchObject(
      {
        status: 'rejected',
        reason: 'artifact_shape_invalid',
      },
    );
  });

  it('requires both registered service-principal lanes to pass the shared runtime control', () => {
    const serviceFixtures = CRUD_EVIDENCE_FIXTURES.filter(
      (candidate) => candidate.controlKind === 'service_principal_task_scope',
    );
    const serviceManifest = [
      capability({
        id: 'CustomersController.create',
        handler: 'create',
        verb: 'POST',
        permissions: ['customers.create'],
        params: { path: [], query: [], freeFormQuery: false, hasBody: true },
      }),
      capability({
        id: 'UserDashboardPreferencesController.list',
        controller: 'UserDashboardPreferencesController',
        handler: 'list',
        path: 'bi/my-dashboards',
        permissions: ['dashboard_preferences.manage'],
      }),
    ];
    const result = verify(
      signedArtifactFor(serviceManifest, serviceFixtures, {
        'user-dashboard-list-autopilot-mandate-scope': 'failed',
      }),
      serviceManifest,
      serviceFixtures,
    );

    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      expect(result.securityControls.service_principal_task_scope).toEqual({
        passed: false,
        cases: [
          'customer-create-service-principal-task-scope',
          'user-dashboard-list-autopilot-mandate-scope',
        ],
      });
    }
  });

  it("derives capability governance only from that capability's passed registered fixture", () => {
    const mutationCapability = capability({
      id: 'CustomersController.create',
      handler: 'create',
      verb: 'POST',
      permissions: ['customers.create'],
      tier: 'amber',
      tierReason: 'write-verb',
      params: { path: [], query: [], freeFormQuery: false, hasBody: true },
    });
    const mutationFixture: CrudFixtureRegistration = {
      fixtureId: 'customer-create-governance-test',
      fixtureVersion: 1,
      capabilityId: mutationCapability.id,
      controlKind: 'positive',
      description: 'Exact mutation audit test.',
      governance: { scope: 'not_applicable', audit: 'required' },
    };
    const unclassifiedCapability = capability({
      id: 'ReportsController.summary',
      controller: 'ReportsController',
      handler: 'summary',
      path: 'reports/summary',
      permissions: ['reports.view'],
    });
    const unclassifiedFixture: CrudFixtureRegistration = {
      fixtureId: 'unclassified-report-read',
      fixtureVersion: 1,
      capabilityId: unclassifiedCapability.id,
      controlKind: 'positive',
      description: 'A response without an exact reviewed ownership assertion.',
      governance: { scope: 'unclassified', audit: 'not_applicable' },
    };
    const targetManifest = [manifest[0], mutationCapability, unclassifiedCapability];
    const targetFixtures = [fixture, mutationFixture, unclassifiedFixture];
    const result = verify(
      signedArtifactFor(targetManifest, targetFixtures, {
        [mutationFixture.fixtureId]: 'failed',
      }),
      targetManifest,
      targetFixtures,
    );

    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      expect(result.governanceEvidence[manifest[0].id].scope).toMatchObject({
        classification: 'company',
        required: true,
        passed: true,
        cases: [fixture.fixtureId],
      });
      expect(result.governanceEvidence[mutationCapability.id].auditAttribution).toEqual({
        required: true,
        passed: false,
        cases: [],
      });
      expect(result.governanceEvidence[unclassifiedCapability.id].scope).toEqual({
        classification: 'unclassified',
        required: false,
        passed: true,
        cases: [],
      });
    }
  });

  it('enforces an actual P-256 key and canonical 64-byte P1363 signature for ES256', () => {
    const rsaKeys = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    expect(() => signCrudEvidenceArtifact(payload(), rsaKeys.privateKey, 'evidence-key-1')).toThrow(
      /EC P-256 key/,
    );

    const p384Keys = generateKeyPairSync('ec', {
      namedCurve: 'P-384',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const unsigned = payload();
    const canonical = canonicalJson(unsigned);
    const p384Artifact = {
      ...unsigned,
      payloadDigest: createHash('sha256').update(canonical).digest('hex'),
      signature: {
        algorithm: 'ES256' as const,
        keyId: 'evidence-key-1',
        value: cryptoSign('sha256', Buffer.from(canonical), {
          key: p384Keys.privateKey,
          dsaEncoding: 'ieee-p1363',
        }).toString('base64'),
      },
    };
    expect(
      verifyCrudEvidenceArtifact(p384Artifact, manifest, {
        publicKeyPem: p384Keys.publicKey,
        expectedKeyId: 'evidence-key-1',
        expectedApplicationBuildDigest: BUILD_DIGEST,
        expectedPrismaSchemaMigrationDigest: PRISMA_DIGEST,
        now: NOW,
        maxAgeMs: 24 * 60 * 60 * 1000,
        fixtures: [fixture],
      }),
    ).toMatchObject({ status: 'rejected', reason: 'signature_invalid' });

    const malformed = signCrudEvidenceArtifact(payload(), keys.privateKey, 'evidence-key-1');
    malformed.signature.value = Buffer.alloc(63).toString('base64');
    expect(verify(malformed)).toMatchObject({ status: 'rejected', reason: 'signature_invalid' });
  });

  it('rejects an artifact modified after signing', () => {
    const artifact = signCrudEvidenceArtifact(payload(), keys.privateKey, 'evidence-key-1');
    artifact.cases[0].assertions[0].name = 'fabricated assertion';

    expect(verify(artifact)).toMatchObject({
      status: 'rejected',
      reason: 'payload_digest_mismatch',
    });
  });

  it('rejects a validly signed but stale artifact', () => {
    const artifact = signCrudEvidenceArtifact(
      payload({
        generatedAt: '2026-08-20T00:00:00.000Z',
        expiresAt: '2026-08-30T00:00:00.000Z',
      }),
      keys.privateKey,
      'evidence-key-1',
    );

    expect(verify(artifact)).toMatchObject({ status: 'rejected', reason: 'artifact_stale' });
  });

  it('rejects evidence bound to a different manifest revision', () => {
    const artifact = signCrudEvidenceArtifact(payload(), keys.privateKey, 'evidence-key-1');
    const changedManifest = [capability({ path: 'customers-v2' })];

    expect(verify(artifact, changedManifest)).toMatchObject({
      status: 'rejected',
      reason: 'manifest_digest_mismatch',
    });
  });

  it('rejects a valid signature made by an untrusted key', () => {
    const artifact = signCrudEvidenceArtifact(payload(), otherKeys.privateKey, 'evidence-key-1');

    expect(verify(artifact)).toMatchObject({ status: 'rejected', reason: 'signature_invalid' });
  });

  it('rejects an invented or mismatched fixture even when it is signed', () => {
    const value = payload();
    value.cases[0].fixtureId = 'invented-positive-control';
    const artifact = signCrudEvidenceArtifact(value, keys.privateKey, 'evidence-key-1');

    expect(verify(artifact)).toMatchObject({
      status: 'rejected',
      reason: 'fixture_registration_mismatch',
    });
  });

  it('rejects a fixture-version mismatch even when it is signed', () => {
    const value = payload();
    value.cases[0].fixtureVersion = 2;
    const artifact = signCrudEvidenceArtifact(value, keys.privateKey, 'evidence-key-1');

    expect(verify(artifact)).toMatchObject({
      status: 'rejected',
      reason: 'fixture_registration_mismatch',
    });
  });

  it('rejects signed evidence after governance-contract drift without relying on a version bump', () => {
    const artifact = signCrudEvidenceArtifact(payload(), keys.privateKey, 'evidence-key-1');
    const driftedFixture = {
      ...fixture,
      governance: { scope: 'global' as const, audit: 'not_applicable' as const },
    };

    expect(verify(artifact, manifest, [driftedFixture])).toMatchObject({
      status: 'rejected',
      reason: 'fixture_contract_mismatch',
    });
  });

  it('rejects validly signed fixture, build, migration and legacy-v1 provenance drift', () => {
    const fixtureDriftPayload = payload();
    fixtureDriftPayload.cases[0].fixtureContractDigest = 'd'.repeat(64);
    expect(
      verify(signCrudEvidenceArtifact(fixtureDriftPayload, keys.privateKey, 'evidence-key-1')),
    ).toMatchObject({ status: 'rejected', reason: 'fixture_contract_mismatch' });

    const artifact = signCrudEvidenceArtifact(payload(), keys.privateKey, 'evidence-key-1');
    expect(verify(artifact, manifest, [fixture], 'e'.repeat(64))).toMatchObject({
      status: 'rejected',
      reason: 'application_build_digest_mismatch',
    });
    expect(verify(artifact, manifest, [fixture], BUILD_DIGEST, 'f'.repeat(64))).toMatchObject({
      status: 'rejected',
      reason: 'prisma_schema_migration_digest_mismatch',
    });

    const legacyPayload = { ...payload(), contract: 'msaidizi-crud-execution-evidence/v1' };
    const legacyArtifact = signCrudEvidenceArtifact(
      legacyPayload as unknown as CrudEvidencePayload,
      keys.privateKey,
      'evidence-key-1',
    );
    expect(verify(legacyArtifact)).toMatchObject({
      status: 'rejected',
      reason: 'artifact_contract_mismatch',
    });
  });

  it('attests the actual Prisma schema and ordered migration file contents', () => {
    const root = mkdtempSync(join(tmpdir(), 'crud-prisma-attestation-'));
    try {
      mkdirSync(join(root, 'migrations', '20260825000000_initial'), { recursive: true });
      writeFileSync(join(root, 'schema.prisma'), 'datasource db { provider = "postgresql" }\n');
      const migration = join(root, 'migrations', '20260825000000_initial', 'migration.sql');
      writeFileSync(migration, 'CREATE TABLE "One" ("id" text primary key);\n');
      const initial = prismaSchemaMigrationDigest(root);

      writeFileSync(migration, 'CREATE TABLE "Two" ("id" text primary key);\n');
      const changed = prismaSchemaMigrationDigest(root);

      expect(initial).toMatch(/^[a-f0-9]{64}$/);
      expect(changed).toMatch(/^[a-f0-9]{64}$/);
      expect(changed).not.toBe(initial);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked Prisma attestation root instead of following it', () => {
    const target = mkdtempSync(join(tmpdir(), 'crud-prisma-real-'));
    const link = `${target}-link`;
    try {
      mkdirSync(join(target, 'migrations'), { recursive: true });
      writeFileSync(join(target, 'schema.prisma'), 'datasource db { provider = "postgresql" }\n');
      symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');

      expect(() => prismaSchemaMigrationDigest(link)).toThrow(/real directory, not a symlink/);
    } finally {
      try {
        unlinkSync(link);
      } catch {
        // The assertion still owns the primary test failure when link creation failed.
      }
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('never promotes a legacy status-less-than-500 smoke response to positive coverage', () => {
    const value = payload();
    value.cases[0].httpStatus = 404;
    value.cases[0].assertions = [{ name: 'did not return 500', passed: true }];
    const artifact = signCrudEvidenceArtifact(value, keys.privateKey, 'evidence-key-1');

    expect(verify(artifact)).toMatchObject({
      status: 'rejected',
      reason: 'fabricated_positive_result',
    });
  });

  it('keeps a genuine failed fixture as failure evidence rather than positive coverage', () => {
    const value = payload();
    value.cases[0].outcome = 'failed';
    value.cases[0].httpStatus = 422;
    value.cases[0].assertions = [{ name: 'created customer', passed: false }];
    const artifact = signCrudEvidenceArtifact(value, keys.privateKey, 'evidence-key-1');

    const result = verify(artifact);
    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      expect(result.positiveEvidence).toEqual({});
      expect(result.failedPositiveFixtures).toEqual({
        'CustomersController.findAll': ['customer-list-positive'],
      });
      expect(result.governanceEvidence['CustomersController.findAll']).toMatchObject({
        scope: { required: true, passed: false, cases: [] },
      });
    }
  });

  it('derives only reviewed DTO-safe marker reads and blocks shape-only responses', () => {
    const safe = capability({
      id: 'SuppliersController.findAll',
      controller: 'SuppliersController',
      permissions: ['suppliers.view'],
      path: 'suppliers',
    });
    const supportedQuery = capability({
      id: 'TaxRatesController.findCurrent',
      controller: 'TaxRatesController',
      handler: 'findCurrent',
      path: 'tax/tax-rates/current',
      permissions: ['tax_rates.view'],
      params: {
        path: [],
        query: [],
        freeFormQuery: true,
        hasBody: false,
        querySchema: {
          schema: {
            type: 'object',
            properties: { companyId: { type: 'string', format: 'uuid' } },
            required: ['companyId'],
            additionalProperties: false,
          },
          quality: 'strict',
          sources: ['class-validator'],
          dtoName: 'CompanyReportQueryDto',
        },
      },
    });
    const shapeOnly = capability({
      id: 'ReportsController.summary',
      controller: 'ReportsController',
      handler: 'summary',
      path: 'reports/summary',
      permissions: ['reports.view'],
    });
    const pathBound = capability({
      id: 'SuppliersController.findOne',
      controller: 'SuppliersController',
      handler: 'findOne',
      path: 'suppliers/:id',
      params: { path: ['id'], query: [], freeFormQuery: false, hasBody: false },
    });
    const opaqueQuery = capability({
      id: 'SuppliersController.search',
      controller: 'SuppliersController',
      handler: 'search',
      params: { path: [], query: [], freeFormQuery: true, hasBody: false },
    });
    const unknownRequiredQuery = capability({
      id: 'ReportsController.bySupplier',
      controller: 'ReportsController',
      handler: 'bySupplier',
      params: {
        path: [],
        query: [],
        freeFormQuery: true,
        hasBody: false,
        querySchema: {
          schema: {
            type: 'object',
            properties: { supplierId: { type: 'string', format: 'uuid' } },
            required: ['supplierId'],
            additionalProperties: false,
          },
          quality: 'strict',
          sources: ['class-validator'],
          dtoName: 'SupplierReportQueryDto',
        },
      },
    });
    const terminalHeaders = capability({
      id: 'MobilePosLiteController.session',
      controller: 'MobilePosLiteController',
      handler: 'session',
      path: 'mobile-pos-lite/session',
      permissions: ['mobile_pos_lite.use'],
    });

    const fixtures = metadataReadEvidenceFixtures([
      safe,
      supportedQuery,
      shapeOnly,
      pathBound,
      opaqueQuery,
      unknownRequiredQuery,
      terminalHeaders,
      capability({
        id: 'PublicController.list',
        controller: 'PublicController',
        permissions: [],
        guard: 'public',
      }),
      capability({
        id: 'SecretsController.list',
        controller: 'SecretsController',
        agentExcluded: true,
      }),
    ]);

    expect(fixtures.map((item) => item.capabilityId)).toEqual([
      'SuppliersController.findAll',
      'TaxRatesController.findCurrent',
    ]);
    expect(new Set(fixtures.map((item) => item.fixtureId)).size).toBe(fixtures.length);
    expect(fixtures.every((item) => item.observable.kind === 'seeded-company-marker')).toBe(true);
    expect(fixtures.map((item) => item.observable.seedModel)).toEqual(['Supplier', 'TaxRate']);
    expect(fixtures.every((item) => item.observable.present.binding === 'companyA')).toBe(true);
    expect(fixtures.every((item) => item.observable.absent.binding === 'companyB')).toBe(true);
    expect(metadataReadEvidenceBlockers([safe, supportedQuery, shapeOnly])).toEqual([
      expect.objectContaining({
        capabilityId: 'ReportsController.summary',
        reason: 'no_deterministic_seeded_positive_control',
      }),
    ]);
  });

  it('requires the seeded company-A marker and rejects company-B leakage', () => {
    expect(evaluateMetadataReadCompanyMarkers([], 'company-a', 'company-b')).toMatchObject({
      present: false,
      absent: true,
    });
    expect(
      evaluateMetadataReadCompanyMarkers({ data: [], total: 0 }, 'company-a', 'company-b'),
    ).toMatchObject({ present: false, absent: true });
    expect(
      evaluateMetadataReadCompanyMarkers({ status: 'ok' }, 'company-a', 'company-b'),
    ).toMatchObject({ present: false, absent: true });
    expect(
      evaluateMetadataReadCompanyMarkers(
        { data: [{ companyId: 'company-a' }] },
        'company-a',
        'company-b',
      ),
    ).toMatchObject({ present: true, absent: true });
    expect(
      evaluateMetadataReadCompanyMarkers(
        { data: [{ companyId: 'company-a' }, { companyId: 'company-b' }] },
        'company-a',
        'company-b',
      ),
    ).toMatchObject({ present: true, absent: false });
  });

  it('binds the HIGH-severity precondition required by the sensitive audit-log read', () => {
    const [sensitiveAuditLogs] = metadataReadEvidenceFixtures([
      capability({
        id: 'AuditLogsController.findSensitive',
        controller: 'AuditLogsController',
        handler: 'findSensitive',
        path: 'audit-logs/sensitive',
        permissions: ['audit_logs.view'],
        params: { path: [], query: ['limit'], freeFormQuery: false, hasBody: false },
      }),
    ]);

    expect(sensitiveAuditLogs).toMatchObject({
      fixtureVersion: 4,
      observable: {
        kind: 'seeded-company-marker',
        seedModel: 'AuditLog',
        seedFields: { severity: 'HIGH' },
      },
    });
    if (!sensitiveAuditLogs) throw new Error('sensitive audit-log fixture is absent');
    const unsignedPrecondition = {
      ...sensitiveAuditLogs,
      observable: {
        ...sensitiveAuditLogs.observable,
        seedFields: undefined,
      },
    };
    expect(fixtureContractDigest(sensitiveAuditLogs)).not.toBe(
      fixtureContractDigest(unsignedPrecondition),
    );
  });

  it('binds actor-owned metadata reads to actor A/B markers instead of tenant markers', () => {
    const actorReads = metadataReadEvidenceFixtures([
      capability({
        id: 'ApprovalRequestsController.submittedByMe',
        controller: 'ApprovalRequestsController',
        handler: 'submittedByMe',
        path: 'approvals/requests/submitted-by/me',
        permissions: ['approval_requests.view'],
      }),
      capability({
        id: 'NotificationsController.findMy',
        controller: 'NotificationsController',
        handler: 'findMy',
        path: 'notifications/my',
        permissions: ['notifications.view'],
      }),
      capability({
        id: 'SavedReportViewsController.findAll',
        controller: 'SavedReportViewsController',
        handler: 'findAll',
        path: 'bi/saved-report-views',
        permissions: ['saved_report_views.view'],
      }),
      capability({
        id: 'TasksController.myTasks',
        controller: 'TasksController',
        handler: 'myTasks',
        path: 'tasks/my-tasks',
        permissions: ['tasks.view'],
      }),
      capability({
        id: 'UserDashboardPreferencesController.list',
        controller: 'UserDashboardPreferencesController',
        handler: 'list',
        path: 'bi/my-dashboards',
        permissions: ['dashboard_preferences.manage'],
      }),
    ]);

    expect(actorReads).toHaveLength(5);
    expect(
      actorReads.map((fixture) => ({
        capabilityId: fixture.capabilityId,
        scope: fixture.governance.scope,
        executionPrincipal: fixture.executionPrincipal,
        present: fixture.observable.present.binding,
        absent: fixture.observable.absent.binding,
        negativeControl: fixture.observable.negativeControl,
      })),
    ).toEqual([
      {
        capabilityId: 'ApprovalRequestsController.submittedByMe',
        scope: 'actor',
        executionPrincipal: 'actor',
        present: 'userA',
        absent: 'userB',
        negativeControl: {
          seedModel: 'ApprovalRequest',
          actorField: 'requestedById',
          actorBinding: 'userB',
          companyBinding: 'companyA',
        },
      },
      {
        capabilityId: 'NotificationsController.findMy',
        scope: 'actor',
        executionPrincipal: 'actor',
        present: 'userA',
        absent: 'userB',
        negativeControl: {
          seedModel: 'Notification',
          actorField: 'recipientUserId',
          actorBinding: 'userB',
          companyBinding: 'companyA',
        },
      },
      {
        capabilityId: 'SavedReportViewsController.findAll',
        scope: 'actor',
        executionPrincipal: 'actor',
        present: 'userA',
        absent: 'userB',
        negativeControl: {
          seedModel: 'SavedReportView',
          actorField: 'userId',
          actorBinding: 'userB',
          companyBinding: 'companyA',
        },
      },
      {
        capabilityId: 'TasksController.myTasks',
        scope: 'actor',
        executionPrincipal: 'actor',
        present: 'userA',
        absent: 'userB',
        negativeControl: {
          seedModel: 'Task',
          actorField: 'assignedToId',
          actorBinding: 'userB',
          companyBinding: 'companyA',
        },
      },
      {
        capabilityId: 'UserDashboardPreferencesController.list',
        scope: 'actor',
        executionPrincipal: 'actor',
        present: 'userA',
        absent: 'userB',
        negativeControl: {
          seedModel: 'UserDashboardPreference',
          actorField: 'userId',
          actorBinding: 'userB',
          companyBinding: 'companyA',
        },
      },
    ]);
  });

  it('signs exact request bytes and fixture-isolated A/B records for dedicated read controls', () => {
    const dedicated = metadataReadEvidenceFixtures([
      capability({
        id: 'ProfitController.costGaps',
        controller: 'ProfitController',
        handler: 'costGaps',
        path: 'profit/cost-gaps',
        permissions: ['profit.view'],
        params: {
          path: [],
          query: [],
          freeFormQuery: true,
          hasBody: false,
          querySchema: {
            schema: {
              type: 'object',
              properties: {
                companyId: { type: 'string', format: 'uuid' },
                divisionId: { type: 'string', format: 'uuid' },
                branchId: { type: 'string', format: 'uuid' },
              },
              required: [],
              additionalProperties: false,
            },
            quality: 'strict',
            sources: ['class-validator'],
            dtoName: 'ProfitCostGapsQueryDto',
          },
        },
      }),
      capability({
        id: 'SalesOrdersController.findReceiptAccounts',
        controller: 'SalesOrdersController',
        handler: 'findReceiptAccounts',
        path: 'sales-orders/receipt-accounts',
        permissions: [],
        anyPermissions: ['pos.create', 'sales.create', 'receivables.manage'],
        params: {
          path: [],
          query: [],
          freeFormQuery: true,
          hasBody: false,
          querySchema: {
            schema: {
              type: 'object',
              properties: {
                companyId: { type: 'string', format: 'uuid' },
                divisionId: { type: 'string', format: 'uuid' },
                branchId: { type: 'string', format: 'uuid' },
                paymentMethod: { type: 'string', enum: ['CASH', 'CREDIT'] },
                limit: { type: 'integer' },
              },
              required: [],
              additionalProperties: false,
            },
            quality: 'strict',
            sources: ['class-validator'],
            dtoName: 'ReceiptAccountsQueryDto',
          },
        },
      }),
    ]);

    expect(dedicated).toEqual([
      expect.objectContaining({
        fixtureId: 'metadata-read-profit-controller-cost-gaps-9317e6a3bb04',
        fixtureVersion: 6,
        capabilityId: 'ProfitController.costGaps',
        executionPrincipal: 'group',
        request: { queryBindings: [{ name: 'companyId', binding: 'companyA' }] },
        observable: expect.objectContaining({
          seedModel: 'Product',
          causalRecordControl: {
            seedScenario: 'profit-cost-gap-product-company-pair-v1',
            lifecycle: 'fixture_isolated',
            responseMarkerField: 'id',
            present: { binding: 'scenarioA', companyBinding: 'companyA' },
            absent: { binding: 'scenarioB', companyBinding: 'companyB' },
          },
        }),
      }),
      expect.objectContaining({
        fixtureId: 'metadata-read-sales-orders-controller-find-receipt-accounts-cb9004bf82fc',
        fixtureVersion: 6,
        capabilityId: 'SalesOrdersController.findReceiptAccounts',
        executionPrincipal: 'group',
        request: {
          queryBindings: [
            { name: 'companyId', binding: 'companyA' },
            { name: 'divisionId', binding: 'divisionA' },
            { name: 'branchId', binding: 'branchA' },
            { name: 'paymentMethod', literal: 'CASH' },
            { name: 'limit', literal: 20 },
          ],
        },
        observable: expect.objectContaining({
          seedModel: 'CashAccount',
          causalRecordControl: {
            seedScenario: 'receipt-account-company-pair-v1',
            lifecycle: 'fixture_isolated',
            responseMarkerField: 'id',
            present: { binding: 'scenarioA', companyBinding: 'companyA' },
            absent: { binding: 'scenarioB', companyBinding: 'companyB' },
          },
        }),
      }),
    ]);
    const receipt = dedicated[1];
    if (!receipt) throw new Error('receipt-account fixture is absent');
    const missingBranchBinding: CrudMetadataReadFixtureRegistration = {
      ...receipt,
      request: {
        queryBindings: receipt.request!.queryBindings.filter(
          (binding) => binding.name !== 'branchId',
        ),
      },
    };
    expect(fixtureContractDigest(missingBranchBinding)).not.toBe(fixtureContractDigest(receipt));
  });

  it('registers only reviewed exact-id reads with an explicit seed and company binding', () => {
    const accountingPeriod = capability({
      id: 'AccountingPeriodsController.findOne',
      controller: 'AccountingPeriodsController',
      handler: 'findOne',
      path: 'accounting-periods/:id',
      permissions: ['accounting_periods.view'],
      params: { path: ['id'], query: [], freeFormQuery: false, hasBody: false },
    });
    const inventoryBalance = capability({
      id: 'InventoryBalancesController.findOne',
      controller: 'InventoryBalancesController',
      handler: 'findOne',
      path: 'inventory-balances/:id',
      permissions: ['inventory.view'],
      params: { path: ['id'], query: [], freeFormQuery: false, hasBody: false },
    });

    const fixtures = exactRecordReadEvidenceFixtures([
      accountingPeriod,
      inventoryBalance,
      capability({
        id: 'SuppliersController.findOne',
        controller: 'SuppliersController',
        handler: 'findOne',
        path: 'suppliers/:id',
        permissions: ['suppliers.view'],
        params: { path: ['id'], query: [], freeFormQuery: false, hasBody: false },
      }),
      capability({
        id: 'AccountingLocksController.findOne',
        controller: 'AccountingLocksController',
        handler: 'findOne',
        path: 'accounting-locks/:lockId',
        permissions: ['accounting_locks.view'],
        params: { path: ['lockId'], query: [], freeFormQuery: false, hasBody: false },
      }),
      capability({
        id: 'CashAccountsController.findOne',
        controller: 'CashAccountsController',
        handler: 'findOne',
        path: 'cash-accounts/:id',
        permissions: ['cash_accounts.view'],
        params: { path: ['id'], query: [], freeFormQuery: false, hasBody: false },
        agentExcluded: true,
      }),
    ]);

    expect(fixtures).toEqual([
      expect.objectContaining({
        capabilityId: 'AccountingPeriodsController.findOne',
        recordBinding: 'accountingPeriodA',
        responseCompanyPath: ['companyId'],
      }),
      expect.objectContaining({
        capabilityId: 'InventoryBalancesController.findOne',
        recordBinding: 'inventoryBalanceA',
        responseCompanyPath: ['companyId'],
      }),
    ]);
    expect(fixtures.every((item) => item.fixtureId.startsWith('exact-record-read-'))).toBe(true);
  });

  it('composes an ordered additive registry without duplicate fixture ids', () => {
    const targetManifest = [
      capability(),
      capability({
        id: 'AccountingPeriodsController.findOne',
        controller: 'AccountingPeriodsController',
        handler: 'findOne',
        path: 'accounting-periods/:id',
        permissions: ['accounting_periods.view'],
        params: { path: ['id'], query: [], freeFormQuery: false, hasBody: false },
      }),
    ];

    const packs = crudEvidenceFixturePacksForManifest(targetManifest);
    const fixtures = crudEvidenceFixturesForManifest(targetManifest);

    expect(packs.map((pack) => pack.packId)).toEqual([
      'base-governed-crud',
      'metadata-collection-reads-platform',
      'metadata-collection-reads-governance',
      'metadata-collection-reads-finance',
      'metadata-collection-reads-operations',
      'metadata-collection-reads-hr',
      'global-admin-deterministic-reads',
      'remaining-deterministic-reads',
      'derived-financial-report-reads',
      'derived-operations-report-reads',
      'derived-company-summary-reads',
      'westsides-derived-report-reads',
      'exact-record-reads',
      'domain-parameter-reads',
      'terminal-context-reads',
      'path-record-platform',
      'path-record-governance',
      'path-record-finance',
      'path-record-operations',
      'path-record-hr',
      'path-record-derived',
      'mutation-base-customers-journal',
      'mutation-am-platform',
      'mutation-am-finance-compliance',
      'mutation-am-hr-operations',
      'mutation-ns-operations',
      'mutation-ns-products-procurement',
      'mutation-ns-revenue-records',
      'mutation-ns-workforce-sales',
      'mutation-ns-stock-suppliers',
      'mutation-tz-tasks-tax',
      'mutation-tz-units-shifts',
      'mutation-tz-users-integrations',
      'mutation-gap-database-deletes',
      'mutation-gap-database-creates',
      'mutation-action-database-tranche',
      'mutation-action-closure-second-tranche',
      'mutation-financial-actions-positive-v1',
      'mutation-admin-operations-positive-v1',
      'mutation-autonomy-release-positive-v1',
      'mutation-user-dashboard-upserts',
      'mutation-next-bounded-finance-operations',
    ]);
    expect(fixtures).toEqual(packs.flatMap((pack) => pack.fixtures));
    expect(new Set(fixtures.map((item) => item.fixtureId)).size).toBe(fixtures.length);
  });

  it('binds domain path fixtures to an exact route, parameter set and governed GET', () => {
    const activeSession = capability({
      id: 'ActiveSessionsController.findOne',
      controller: 'ActiveSessionsController',
      handler: 'findOne',
      path: 'active-sessions/:id',
      permissions: ['active_sessions.view'],
      params: { path: ['id'], query: [], freeFormQuery: false, hasBody: false },
    });
    const driftedPath = capability({
      ...activeSession,
      path: 'active-sessions/:sessionId',
      params: { path: ['sessionId'], query: [], freeFormQuery: false, hasBody: false },
    });
    const permissionless = capability({
      ...activeSession,
      permissions: [],
      guard: 'public',
    });

    const included = pathRecordReadEvidencePacks([activeSession]).flatMap((pack) => pack.fixtures);
    const drifted = pathRecordReadEvidencePacks([driftedPath]).flatMap((pack) => pack.fixtures);
    const ungated = pathRecordReadEvidencePacks([permissionless]).flatMap((pack) => pack.fixtures);

    expect(included).toEqual([
      expect.objectContaining({
        capabilityId: 'ActiveSessionsController.findOne',
        expectedPath: 'active-sessions/:id',
        pathBindings: [{ name: 'id', binding: 'model:ActiveSession' }],
        seedModel: 'ActiveSession',
        response: expect.objectContaining({
          identity: { responsePath: ['id'], binding: 'model:ActiveSession' },
          scope: { kind: 'company', responsePath: ['companyId'], binding: 'companyA' },
        }),
      }),
    ]);
    expect(drifted).toEqual([]);
    expect(ungated).toEqual([]);
    expect(CRUD_PATH_READ_REVIEWED_DEFINITION_COUNT).toBeGreaterThan(100);
  });

  it('keeps every known path-read blocker explicit without registering it as evidence', () => {
    const unscopedCompanyRead = capability({
      id: 'AutomationRulesController.findOne',
      controller: 'AutomationRulesController',
      handler: 'findOne',
      path: 'automation-rules/:id',
      permissions: ['automation_rules.view'],
      params: { path: ['id'], query: [], freeFormQuery: false, hasBody: false },
    });

    expect(
      pathRecordReadEvidencePacks([unscopedCompanyRead]).flatMap((pack) => pack.fixtures),
    ).toEqual([]);
    expect(CRUD_PATH_READ_REMAINING_BLOCKERS).toHaveLength(53);
    expect(
      new Set(CRUD_PATH_READ_REMAINING_BLOCKERS.map((blocker) => blocker.capabilityId)).size,
    ).toBe(CRUD_PATH_READ_REMAINING_BLOCKERS.length);
    expect(
      CRUD_PATH_READ_REMAINING_BLOCKERS.find(
        (blocker) => blocker.capabilityId === 'AutomationRulesController.findOne',
      ),
    ).toMatchObject({ reason: 'company_scope_not_enforced' });
  });
});
