import { createHash } from 'node:crypto';
import {
  ProductionReleaseBindingInput,
  verifyProductionReleaseBinding,
} from './production-release-gate.protocol';

const sourceCommit = '1'.repeat(40);
const sourceTree = '2'.repeat(40);
const imageDigest = `sha256:${'4'.repeat(64)}`;
const imageReference = `ghcr.io/itemba/itemba-r-backend@${imageDigest}`;
const applicationBuildDigest = '5'.repeat(64);
const prismaDigest = '6'.repeat(64);

function fixture(): ProductionReleaseBindingInput {
  const evidenceArtifactBytes = Buffer.from('signed CRUD evidence bytes\n');
  const actualEvidenceSha256 = sha256(evidenceArtifactBytes);
  const inventory = {
    contract: 'msaidizi-production-ring-promotion-inventory/v1',
    environment: 'production',
    targetId: 'itemba-production-primary',
    ring: '0',
    source: {
      commitSha: sourceCommit,
      gitTreeDigest: sourceTree,
      trackedSourceSha256: '7'.repeat(64),
      trackedFileCount: 120,
    },
    backendImage: {
      reference: imageReference,
      repository: 'ghcr.io/itemba/itemba-r-backend',
      digest: imageDigest,
    },
    evidence: {
      applicationBuildDigest,
      artifactSha256: actualEvidenceSha256,
      executedCaseCount: 1087,
      expiresAt: '2026-09-03T10:00:00.000Z',
      generatedAt: '2026-08-27T10:00:00.000Z',
      manifestDigest: '8'.repeat(64),
      payloadDigest: '9'.repeat(64),
      prismaSchemaMigrationDigest: prismaDigest,
      runId: 'crud-evidence-run-1',
      signatureKeyId: 'crud-evidence-2026-01',
    },
    release: {
      contract: 'msaidizi-crud-evidence-release/v1',
      issuedAt: '2026-08-27T10:05:00.000Z',
      payloadDigest: 'a'.repeat(64),
      signatureKeyId: 'crud-release-2026-01',
      pipeline: {
        repository: 'itemba/itemba-r',
        workflow: 'Msaidizi CRUD Evidence Release',
        runId: '1234',
        runAttempt: '1',
      },
    },
  };
  const inventoryBytes = Buffer.from(`${JSON.stringify(inventory, null, 2)}\n`);
  return {
    inventoryBytes,
    evidenceArtifactBytes,
    expectedInventorySha256: sha256(inventoryBytes),
    expectedEvidenceSha256: actualEvidenceSha256,
    expectedImageDigest: imageDigest,
    expectedBackendImageReference: imageReference,
    expectedSourceCommit: sourceCommit,
    expectedRepository: 'itemba/itemba-r',
    expectedEvidenceKeyId: 'crud-evidence-2026-01',
    expectedApplicationBuildDigest: applicationBuildDigest,
    expectedPrismaSchemaMigrationDigest: prismaDigest,
  };
}

describe('production release binding protocol', () => {
  it('accepts one exact promotion inventory, evidence artifact, source and image binding', () => {
    expect(verifyProductionReleaseBinding(fixture())).toEqual({
      contract: 'msaidizi-production-ring-promotion-inventory/v1',
      targetId: 'itemba-production-primary',
      ring: '0',
      inventorySha256: fixture().expectedInventorySha256,
      evidenceSha256: fixture().expectedEvidenceSha256,
      backendImageReference: imageReference,
      backendImageDigest: imageDigest,
      sourceCommit,
      sourceTree,
      repository: 'itemba/itemba-r',
      releaseRunId: '1234',
      releaseRunAttempt: '1',
    });
  });

  it.each([
    ['inventory digest', { expectedInventorySha256: 'b'.repeat(64) }],
    ['evidence digest', { expectedEvidenceSha256: 'c'.repeat(64) }],
    ['image digest', { expectedImageDigest: `sha256:${'d'.repeat(64)}` }],
    [
      'image reference',
      { expectedBackendImageReference: `ghcr.io/itemba/itemba-r-backend@sha256:${'e'.repeat(64)}` },
    ],
    ['source commit', { expectedSourceCommit: 'f'.repeat(40) }],
    ['repository', { expectedRepository: 'attacker/itemba-r' }],
    ['evidence key', { expectedEvidenceKeyId: 'different-key' }],
    ['application build', { expectedApplicationBuildDigest: 'b'.repeat(64) }],
    ['Prisma tree', { expectedPrismaSchemaMigrationDigest: 'c'.repeat(64) }],
  ])('fails closed on %s drift', (_label, override) => {
    expect(() => verifyProductionReleaseBinding({ ...fixture(), ...override })).toThrow(
      /PRODUCTION_RELEASE_/,
    );
  });

  it('rejects extra fields and malformed immutable coordinates even with a matching digest', () => {
    const base = fixture();
    const inventory = JSON.parse(base.inventoryBytes.toString('utf8')) as Record<string, unknown>;
    inventory.unreviewed = true;
    const inventoryBytes = Buffer.from(`${JSON.stringify(inventory)}\n`);
    expect(() =>
      verifyProductionReleaseBinding({
        ...base,
        inventoryBytes,
        expectedInventorySha256: sha256(inventoryBytes),
      }),
    ).toThrow(/FIELDS_INVALID/);
  });
});

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
