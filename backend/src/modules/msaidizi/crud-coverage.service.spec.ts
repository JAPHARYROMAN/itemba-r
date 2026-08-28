import { Capability, extractCapabilities } from '../../common/capabilities/capability-manifest';
import { generateKeyPairSync } from 'node:crypto';
import { CustomersController } from '../customers/customers.controller';
import { JournalEntriesController } from '../journal-entries/journal-entries.controller';
import { CrudEvidenceStore } from './crud-evidence.store';
import {
  CRUD_EVIDENCE_CONTRACT,
  CRUD_EVIDENCE_FIXTURES,
  CRUD_EVIDENCE_HARNESS_VERSION,
  capabilityContractDigest,
  crudEvidenceFixturesForManifest,
  fixtureContractDigest,
  manifestContractDigest,
  signCrudEvidenceArtifact,
  verifyCrudEvidenceArtifact,
} from './crud-execution-evidence';
import { CrudCoverageService, buildCrudCoverageReport } from './crud-coverage.service';
import { ManifestProvider } from './manifest.provider';

const EVIDENCE_BUILD_DIGEST = 'd'.repeat(64);
const EVIDENCE_PRISMA_DIGEST = 'e'.repeat(64);

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

describe('CRUD coverage report', () => {
  const strictBody = {
    schema: {
      type: 'object' as const,
      properties: {
        branchId: { type: 'string' },
        companyId: { type: 'string' },
        customerCode: { type: 'string' },
        customerType: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['branchId', 'companyId', 'customerCode', 'customerType', 'name'],
      additionalProperties: false,
    },
    quality: 'strict' as const,
    sources: ['class-validator' as const, 'design-type' as const],
    dtoName: 'CreateCustomerDto',
  };

  const manifest = [
    capability(),
    capability({
      id: 'CustomersController.create',
      handler: 'create',
      verb: 'POST',
      permissions: ['customers.create'],
      tier: 'amber',
      tierReason: 'write-verb',
      params: {
        path: [],
        query: [],
        freeFormQuery: false,
        hasBody: true,
        bodySchema: strictBody,
      },
    }),
    capability({
      id: 'CustomersController.remove',
      handler: 'remove',
      verb: 'DELETE',
      path: 'customers/:id',
      permissions: ['customers.delete'],
      tier: 'red',
      tierReason: 'delete-verb',
      params: { path: ['id'], query: [], freeFormQuery: false, hasBody: false },
    }),
    capability({
      id: 'AuthController.login',
      controller: 'AuthController',
      handler: 'login',
      verb: 'POST',
      path: 'auth/login',
      permissions: [],
      guard: 'public',
      tier: 'amber',
      tierReason: 'write-verb',
      params: { path: [], query: [], freeFormQuery: false, hasBody: true },
    }),
    capability({
      id: 'DocumentsController.download',
      controller: 'DocumentsController',
      handler: 'download',
      permissions: ['documents.view'],
      agentExcluded: true,
    }),
  ];

  it('reports every route with inclusion, permissions, risk, schema and execution evidence', () => {
    const report = buildCrudCoverageReport(
      manifest,
      {
        status: 'rejected',
        reason: 'artifact_not_configured',
        detail: 'No signed evidence.',
      },
      '2026-08-25T11:00:00.000Z',
    );

    expect(report.contract).toBe('msaidizi-crud-coverage/v1');
    expect(report.summary).toMatchObject({
      total: 5,
      discoveryEligible: 3,
      discoveryIneligible: 2,
      included: 0,
      excluded: 5,
      loopbackVerified: 0,
      byOperation: { read: 2, create: 1, update: 0, delete: 1, action: 1 },
    });

    expect(
      report.capabilities.find((entry) => entry.capabilityId === 'CustomersController.create'),
    ).toMatchObject({
      operation: 'create',
      discoveryEligibility: { status: 'eligible' },
      inclusion: { status: 'excluded', reason: 'evidence_artifact_not_configured' },
      permissions: { allOf: ['customers.create'], anyOf: [] },
      risk: { tier: 'amber', reason: 'write-verb' },
      schema: { body: 'strict', bodyDto: 'CreateCustomerDto' },
      testedExecution: {
        level: 'none',
        status: 'unverified',
        cases: [],
        unverifiedReason: 'evidence_artifact_not_configured',
      },
    });
    expect(
      report.capabilities.find((entry) => entry.capabilityId === 'AuthController.login')?.inclusion,
    ).toEqual({ status: 'excluded', reason: 'public_route' });
    expect(
      report.capabilities.find((entry) => entry.capabilityId === 'DocumentsController.download')
        ?.inclusion,
    ).toEqual({ status: 'excluded', reason: 'agent_excluded' });
    expect(report.releaseGate).toEqual({
      status: 'failed',
      target: 'all_discovery_eligible_operations',
      blockers: expect.arrayContaining([
        { code: 'execution_evidence_artifact_rejected', count: 1 },
        { code: 'discovery_eligible_operations_unverified', count: 3 },
        { code: 'registered_positive_fixtures_not_executed', count: 3 },
        { code: 'authorization_contract_missing', count: 3 },
        { code: 'shared_permission_guard_runtime_missing', count: 1 },
        { code: 'scoped_read_binding_evidence_missing', count: 1 },
        { code: 'mutation_audit_evidence_missing', count: 2 },
      ]),
    });
  });

  it('exposes the same contract through the injectable service', () => {
    const provider = new ManifestProvider();
    provider.setForTesting(manifest);
    const report = new CrudCoverageService(provider).report();

    expect(report.capabilities.map((entry) => entry.capabilityId)).toEqual(
      [...manifest].map((entry) => entry.id).sort(),
    );
    expect(report.executionEvidence).toMatchObject({
      status: 'rejected',
      reason: 'artifact_not_configured',
    });
    expect(report.summary).toMatchObject({
      discoveryEligible: 3,
      included: 0,
      excluded: 5,
      releaseQualified: false,
    });
    expect(
      report.capabilities.find((entry) => entry.capabilityId === 'CustomersController.findAll')
        ?.testedExecution,
    ).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'evidence_artifact_not_configured',
    });
    expect(
      report.capabilities.find((entry) => entry.capabilityId === 'CustomersController.remove')
        ?.testedExecution,
    ).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'evidence_artifact_not_configured',
    });
    expect(
      report.capabilities.find((entry) => entry.capabilityId === 'AuthController.login')
        ?.testedExecution,
    ).toEqual({
      level: 'none',
      status: 'not_applicable',
      cases: [],
      unverifiedReason: 'capability_excluded',
    });
  });

  it('keeps a discoverable operation excluded until it has a positive fixture', () => {
    const report = buildCrudCoverageReport([
      capability({
        id: 'SuppliersController.findOne',
        controller: 'SuppliersController',
        handler: 'findOne',
        path: 'suppliers/:id',
        permissions: ['suppliers.view'],
        params: { path: ['id'], query: [], freeFormQuery: false, hasBody: false },
      }),
    ]);

    expect(report.capabilities[0].testedExecution).toEqual({
      level: 'none',
      status: 'unverified',
      cases: [],
      unverifiedReason: 'no_positive_fixture_registered',
    });
    expect(report.capabilities[0].discoveryEligibility).toEqual({ status: 'eligible' });
    expect(report.capabilities[0].inclusion).toEqual({
      status: 'excluded',
      reason: 'no_positive_fixture_registered',
    });
    expect(report.releaseGate.blockers).toEqual(
      expect.arrayContaining([
        { code: 'discovery_eligible_operations_unverified', count: 1 },
        { code: 'operations_without_positive_fixture', count: 1 },
      ]),
    );
  });

  it('registers a reviewed metadata read with a closed ownership classification', () => {
    const report = buildCrudCoverageReport([
      capability({
        id: 'SuppliersController.findAll',
        controller: 'SuppliersController',
        handler: 'findAll',
        path: 'suppliers',
        permissions: ['suppliers.view'],
      }),
    ]);

    expect(report.releaseGate.blockers).not.toContainEqual(
      expect.objectContaining({ code: 'read_scope_unclassified' }),
    );
  });

  it('consumes only verifier-accepted loopback evidence through the service', () => {
    const provider = new ManifestProvider();
    provider.setForTesting(manifest);
    const keys = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const generatedAt = '2026-08-25T10:00:00.000Z';
    const artifact = signCrudEvidenceArtifact(
      {
        contract: CRUD_EVIDENCE_CONTRACT,
        harnessVersion: CRUD_EVIDENCE_HARNESS_VERSION,
        runId: 'coverage-service-run',
        generatedAt,
        expiresAt: '2026-08-27T10:00:00.000Z',
        manifestDigest: manifestContractDigest(manifest),
        provenance: {
          applicationBuildDigest: EVIDENCE_BUILD_DIGEST,
          prismaSchemaMigrationDigest: EVIDENCE_PRISMA_DIGEST,
        },
        database: { disposable: true, isolatedSchemaNameDigest: 'b'.repeat(64) },
        cases: [
          {
            fixtureId: 'customer-list-positive',
            fixtureVersion: 1,
            capabilityId: 'CustomersController.findAll',
            capabilityContractDigest: capabilityContractDigest(manifest[0]),
            fixtureContractDigest: fixtureContractDigest(
              CRUD_EVIDENCE_FIXTURES.find((item) => item.fixtureId === 'customer-list-positive')!,
            ),
            controlKind: 'positive',
            outcome: 'passed',
            httpStatus: 200,
            assertions: [{ name: 'seeded customer returned', passed: true }],
            finishedAt: generatedAt,
          },
        ],
      },
      keys.privateKey,
      'coverage-test-key',
    );
    const verification = verifyCrudEvidenceArtifact(artifact, manifest, {
      publicKeyPem: keys.publicKey,
      expectedKeyId: 'coverage-test-key',
      expectedApplicationBuildDigest: EVIDENCE_BUILD_DIGEST,
      expectedPrismaSchemaMigrationDigest: EVIDENCE_PRISMA_DIGEST,
      now: new Date('2026-08-25T11:00:00.000Z'),
      maxAgeMs: 24 * 60 * 60 * 1000,
      fixtures: [
        CRUD_EVIDENCE_FIXTURES.find((item) => item.fixtureId === 'customer-list-positive')!,
      ],
    });
    expect(verification).toMatchObject({ status: 'accepted' });

    const store = { load: jest.fn().mockReturnValue(verification) } as unknown as CrudEvidenceStore;
    const report = new CrudCoverageService(provider, store).report();

    expect(store.load).toHaveBeenCalledWith(manifest);
    expect(report.executionEvidence.status).toBe('accepted');
    expect(report.summary.loopbackVerified).toBe(1);
    expect(report.summary.discoveryEligible).toBe(3);
    expect(report.summary.included).toBe(1);
    expect(report.summary.excluded).toBe(4);
    const verifiedEntry = report.capabilities.find(
      (entry) => entry.capabilityId === 'CustomersController.findAll',
    );
    expect(verifiedEntry?.inclusion).toEqual({ status: 'included' });
    expect(verifiedEntry?.testedExecution).toMatchObject({
      level: 'loopback',
      status: 'verified',
      cases: ['customer-list-positive'],
    });
    expect(report.releaseGate).toMatchObject({
      status: 'failed',
      blockers: expect.arrayContaining([
        { code: 'discovery_eligible_operations_unverified', count: 2 },
        { code: 'registered_positive_fixtures_not_executed', count: 2 },
        { code: 'shared_permission_guard_runtime_missing', count: 1 },
        { code: 'mutation_audit_evidence_missing', count: 2 },
      ]),
    });

    const forged = { ...verification } as typeof verification;
    const forgedReport = buildCrudCoverageReport(manifest, forged);
    expect(forgedReport.executionEvidence).toMatchObject({
      status: 'rejected',
      reason: 'artifact_shape_invalid',
    });
    expect(forgedReport.summary.included).toBe(0);
  });

  it('keeps the fixture registry bound to included live controller capability ids', () => {
    const provider = new ManifestProvider();
    provider.setForTesting(extractCapabilities([CustomersController, JournalEntriesController]));
    const capabilities = provider.capabilities();
    const byId = new Map(capabilities.map((entry) => [entry.id, entry]));
    const fixtures = crudEvidenceFixturesForManifest(capabilities);

    expect(new Set(fixtures.map((fixture) => fixture.fixtureId)).size).toBe(fixtures.length);
    for (const fixture of fixtures) {
      const live = byId.get(fixture.capabilityId);
      expect(live).toBeDefined();
      if (fixture.controlKind === 'positive') expect(live?.agentExcluded).toBe(false);
      expect((live?.permissions.length ?? 0) + (live?.anyPermissions.length ?? 0)).toBeGreaterThan(
        0,
      );
    }

    const report = new CrudCoverageService(provider).report();
    const positiveOperations = new Set(
      report.capabilities
        .filter((entry) =>
          fixtures.some(
            (fixture) =>
              fixture.controlKind === 'positive' && fixture.capabilityId === entry.capabilityId,
          ),
        )
        .map((entry) => entry.operation),
    );
    const positiveFixtureCount = fixtures.filter(
      (fixture) => fixture.controlKind === 'positive',
    ).length;
    expect(positiveOperations).toEqual(new Set(['read', 'create', 'update', 'delete', 'action']));
    expect(report.summary.registeredPositiveFixtures).toBe(positiveFixtureCount);
    expect(report.summary.executedPositiveFixtures).toBe(0);
    expect(report.summary.loopbackVerified).toBe(0);
    expect(report.summary.releaseQualified).toBe(false);
    expect(report.summary.included).toBe(0);
    expect(report.summary.discoveryEligible).toBeGreaterThan(0);
    expect(report.releaseGate.blockers).toEqual(
      expect.arrayContaining([
        {
          code: 'discovery_eligible_operations_unverified',
          count: report.summary.discoveryEligible,
        },
        {
          code: 'registered_positive_fixtures_not_executed',
          count: positiveFixtureCount,
        },
      ]),
    );
  });

  it('keeps the complete live manifest closed over positive fixtures and explicit exclusions', () => {
    const provider = new ManifestProvider();
    provider.onModuleInit();
    const capabilities = provider.capabilities();
    const report = buildCrudCoverageReport(capabilities, undefined, '2000-01-01T00:00:00.000Z');
    const fixtures = crudEvidenceFixturesForManifest(capabilities);
    const discoveryEligible = report.capabilities
      .filter((entry) => entry.discoveryEligibility.status === 'eligible')
      .map((entry) => entry.capabilityId)
      .sort();
    const registeredPositiveCapabilities = [
      ...new Set(
        fixtures
          .filter((fixture) => fixture.controlKind === 'positive')
          .map((fixture) => fixture.capabilityId),
      ),
    ].sort();

    expect(discoveryEligible.length).toBeGreaterThan(0);
    expect(registeredPositiveCapabilities).toEqual(discoveryEligible);
    expect(
      report.capabilities
        .filter((entry) => entry.discoveryEligibility.status === 'ineligible')
        .filter((entry) => !entry.discoveryEligibility.reason)
        .map((entry) => entry.capabilityId),
    ).toEqual([]);
  });

  it('passes the release gate only when every discovery-eligible operation and governance control is proven', () => {
    const gateManifest = [
      capability(),
      manifest[1],
      manifest[2],
      capability({
        id: 'CustomersController.findOne',
        handler: 'findOne',
        path: 'customers/:id',
        params: { path: ['id'], query: [], freeFormQuery: false, hasBody: false },
        agentExcluded: true,
        agentExclusionReason: 'read_writes_audit_ledger',
      }),
    ];
    const byId = new Map(gateManifest.map((entry) => [entry.id, entry]));
    const keys = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const generatedAt = '2026-08-25T12:00:00.000Z';
    const gateFixtures = crudEvidenceFixturesForManifest(gateManifest);
    const fixtureIds = gateFixtures.map((fixture) => fixture.fixtureId);
    const passedCases = fixtureIds.map((fixtureId) => {
      const fixture = gateFixtures.find((item) => item.fixtureId === fixtureId)!;
      const capability = byId.get(fixture.capabilityId)!;
      const httpStatus =
        fixture.controlKind === 'permission_denial'
          ? 403
          : fixture.controlKind === 'company_isolation'
            ? 404
            : fixture.capabilityId === 'CustomersController.create'
              ? 201
              : 200;
      return {
        fixtureId,
        fixtureVersion: fixture.fixtureVersion,
        capabilityId: fixture.capabilityId,
        capabilityContractDigest: capabilityContractDigest(capability),
        fixtureContractDigest: fixtureContractDigest(fixture),
        controlKind: fixture.controlKind,
        outcome: 'passed' as const,
        httpStatus,
        assertions: [{ name: `exact ${fixture.controlKind} control passed`, passed: true }],
        finishedAt: generatedAt,
      };
    });
    const evidencePayload = {
      contract: CRUD_EVIDENCE_CONTRACT,
      harnessVersion: CRUD_EVIDENCE_HARNESS_VERSION,
      runId: 'coverage-release-gate-run',
      generatedAt,
      expiresAt: '2026-08-26T12:00:00.000Z',
      manifestDigest: manifestContractDigest(gateManifest),
      provenance: {
        applicationBuildDigest: EVIDENCE_BUILD_DIGEST,
        prismaSchemaMigrationDigest: EVIDENCE_PRISMA_DIGEST,
      },
      database: { disposable: true as const, isolatedSchemaNameDigest: 'c'.repeat(64) },
      cases: passedCases,
    };
    const artifact = signCrudEvidenceArtifact(
      evidencePayload,
      keys.privateKey,
      'coverage-release-key',
    );
    const verification = verifyCrudEvidenceArtifact(artifact, gateManifest, {
      publicKeyPem: keys.publicKey,
      expectedKeyId: 'coverage-release-key',
      expectedApplicationBuildDigest: EVIDENCE_BUILD_DIGEST,
      expectedPrismaSchemaMigrationDigest: EVIDENCE_PRISMA_DIGEST,
      now: new Date('2026-08-25T12:05:00.000Z'),
      maxAgeMs: 24 * 60 * 60 * 1000,
    });
    if (verification.status === 'rejected') {
      throw new Error(`${verification.reason}: ${verification.detail}`);
    }
    expect(verification).toMatchObject({ status: 'accepted' });

    const report = buildCrudCoverageReport(gateManifest, verification);

    expect(report.summary).toMatchObject({
      discoveryEligible: 3,
      included: 3,
      excluded: 1,
      passedPositiveFixtures: 3,
      securityControlsPassed: 4,
      releaseQualified: true,
    });
    expect(report.releaseGate).toEqual({
      status: 'passed',
      target: 'all_discovery_eligible_operations',
      blockers: [],
    });

    const humanOnlyArtifact = signCrudEvidenceArtifact(
      {
        ...evidencePayload,
        runId: 'coverage-human-only-run',
        cases: passedCases.map((evidenceCase) =>
          evidenceCase.controlKind === 'service_principal_task_scope'
            ? {
                ...evidenceCase,
                outcome: 'failed' as const,
                httpStatus: 401,
                assertions: [
                  {
                    name: 'service-principal runtime proof was unavailable',
                    passed: false,
                  },
                ],
              }
            : evidenceCase,
        ),
      },
      keys.privateKey,
      'coverage-release-key',
    );
    const humanOnlyVerification = verifyCrudEvidenceArtifact(humanOnlyArtifact, gateManifest, {
      publicKeyPem: keys.publicKey,
      expectedKeyId: 'coverage-release-key',
      expectedApplicationBuildDigest: EVIDENCE_BUILD_DIGEST,
      expectedPrismaSchemaMigrationDigest: EVIDENCE_PRISMA_DIGEST,
      now: new Date('2026-08-25T12:05:00.000Z'),
      maxAgeMs: 24 * 60 * 60 * 1000,
    });
    expect(humanOnlyVerification.status).toBe('accepted');
    const humanOnlyReport = buildCrudCoverageReport(gateManifest, humanOnlyVerification);
    expect(humanOnlyReport.releaseGate.status).toBe('failed');
    expect(humanOnlyReport.releaseGate.blockers).toContainEqual({
      code: 'service_principal_task_scope_runtime_missing',
      count: 1,
    });
  });
});
