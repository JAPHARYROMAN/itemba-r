import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CrudCoverageService } from './crud-coverage.service';
import { ProductionReleaseGateService } from './production-release-gate.service';

function serviceWith(
  values: Record<string, string>,
  releaseGate: { status: 'passed' | 'failed'; blockers: Array<{ code: string; count: number }> } = {
    status: 'passed',
    blockers: [],
  },
) {
  const config = { get: jest.fn((name: string) => values[name]) } as unknown as ConfigService;
  const report = jest.fn(() => ({ releaseGate })) as jest.Mock;
  const service = new ProductionReleaseGateService(config, {
    report,
  } as unknown as CrudCoverageService);
  return { service, report };
}

describe('ProductionReleaseGateService activation boundary', () => {
  it('leaves ordinary human-user Msaidizi chat compatible in production', () => {
    const { service, report } = serviceWith({
      NODE_ENV: 'production',
      MSAIDIZI_ENABLED: 'true',
    });

    expect(service.productionReleaseRequired()).toBe(false);
    expect(() => service.onModuleInit()).not.toThrow();
    expect(report).not.toHaveBeenCalled();
  });

  it('does not misrepresent a development task worker as a production ring', () => {
    const { service, report } = serviceWith({
      NODE_ENV: 'test',
      MSAIDIZI_AUTONOMY_ENABLED: 'true',
      MSAIDIZI_TASK_WORKER_ENABLED: 'true',
    });

    expect(service.productionReleaseRequired()).toBe(false);
    service.onModuleInit();
    expect(report).not.toHaveBeenCalled();
  });

  it.each([
    'MSAIDIZI_AUTONOMY_ENABLED',
    'MSAIDIZI_TASK_WORKER_ENABLED',
    'MSAIDIZI_AUTOPILOT_ENABLED',
    'MSAIDIZI_HOST_EXECUTION_ENABLED',
    'MSAIDIZI_ADAPTIVE_REASONING_ENABLED',
    'MSAIDIZI_UPDATE_AUTOMATIC_ROLLOUT_ENABLED',
    'MSAIDIZI_UPDATE_EVALUATOR_ENABLED',
  ])('requires a protected production release for %s', (name) => {
    const { service } = serviceWith({ NODE_ENV: 'production', [name]: 'true' });
    expect(service.productionReleaseRequired()).toBe(true);
  });

  it('rejects autonomous startup before reading release files when CRUD coverage is incomplete', () => {
    const { service } = serviceWith(
      {
        NODE_ENV: 'production',
        MSAIDIZI_AUTONOMY_ENABLED: 'true',
        MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256: 'a'.repeat(64),
      },
      {
        status: 'failed',
        blockers: [
          { code: 'execution_evidence_artifact_rejected', count: 1 },
          { code: 'discovery_eligible_operations_unverified', count: 1 },
        ],
      },
    );

    expect(() => service.onModuleInit()).toThrow(
      'PRODUCTION_RELEASE_CRUD_EVIDENCE_REJECTED:discovery_eligible_operations_unverified,execution_evidence_artifact_rejected',
    );
  });

  it('rejects missing protected promotion coordinates after CRUD coverage passes', () => {
    const { service, report } = serviceWith({
      NODE_ENV: 'production',
      MSAIDIZI_AUTONOMY_ENABLED: 'true',
      MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256: 'b'.repeat(64),
    });

    expect(() => service.onModuleInit()).toThrow(
      'PRODUCTION_RELEASE_NOT_CONFIGURED:MSAIDIZI_PRODUCTION_PROMOTION_INVENTORY_PATH',
    );
    expect(report).toHaveBeenCalledWith('b'.repeat(64));
  });

  it('accepts exact external inventory/evidence bytes and immutable deployment coordinates', () => {
    const externalRoot = mkdtempSync(join(tmpdir(), 'msaidizi-production-release-'));
    try {
      const release = releaseFixture(externalRoot);
      const { service, report } = serviceWith({
        NODE_ENV: 'production',
        MSAIDIZI_TASK_WORKER_ENABLED: 'true',
        ...release.config,
      });

      expect(service.assertCurrent()).toMatchObject({
        contract: 'msaidizi-production-ring-promotion-inventory/v1',
        backendImageReference: release.imageReference,
        sourceCommit: release.sourceCommit,
        repository: 'itemba/itemba-r',
      });
      expect(report).toHaveBeenCalledWith(release.evidenceSha256);
    } finally {
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });
});

function releaseFixture(externalRoot: string) {
  const sourceCommit = '1'.repeat(40);
  const imageDigest = `sha256:${'2'.repeat(64)}`;
  const imageReference = `ghcr.io/itemba/itemba-r-backend@${imageDigest}`;
  const evidenceBytes = Buffer.from('exact accepted signed CRUD evidence bytes\n');
  const evidenceSha256 = sha256(evidenceBytes);
  const inventory = {
    contract: 'msaidizi-production-ring-promotion-inventory/v1',
    environment: 'production',
    targetId: 'itemba-production-primary',
    ring: '0',
    source: {
      commitSha: sourceCommit,
      gitTreeDigest: '3'.repeat(40),
      trackedSourceSha256: '4'.repeat(64),
      trackedFileCount: 1303,
    },
    backendImage: {
      reference: imageReference,
      repository: 'ghcr.io/itemba/itemba-r-backend',
      digest: imageDigest,
    },
    evidence: {
      applicationBuildDigest: '5'.repeat(64),
      artifactSha256: evidenceSha256,
      executedCaseCount: 1087,
      expiresAt: '2026-09-03T10:00:00.000Z',
      generatedAt: '2026-08-27T10:00:00.000Z',
      manifestDigest: '6'.repeat(64),
      payloadDigest: '7'.repeat(64),
      prismaSchemaMigrationDigest: '8'.repeat(64),
      runId: 'crud-evidence-run-1',
      signatureKeyId: 'crud-evidence-2026-01',
    },
    release: {
      contract: 'msaidizi-crud-evidence-release/v1',
      issuedAt: '2026-08-27T10:05:00.000Z',
      payloadDigest: '9'.repeat(64),
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
  const inventoryPath = join(externalRoot, 'promotion-inventory.json');
  const evidencePath = join(externalRoot, 'crud-evidence.json');
  writeFileSync(inventoryPath, inventoryBytes, { mode: 0o444 });
  writeFileSync(evidencePath, evidenceBytes, { mode: 0o444 });
  return {
    sourceCommit,
    imageReference,
    evidenceSha256,
    config: {
      MSAIDIZI_PRODUCTION_PROMOTION_INVENTORY_PATH: inventoryPath,
      MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256: sha256(inventoryBytes),
      MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256: evidenceSha256,
      MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST: imageDigest,
      MSAIDIZI_DEPLOYED_BACKEND_IMAGE_REFERENCE: imageReference,
      MSAIDIZI_DEPLOYED_SOURCE_COMMIT: sourceCommit,
      MSAIDIZI_DEPLOYED_SOURCE_REPOSITORY: 'itemba/itemba-r',
      MSAIDIZI_CRUD_EVIDENCE_PATH: evidencePath,
      MSAIDIZI_CRUD_EVIDENCE_KEY_ID: 'crud-evidence-2026-01',
      MSAIDIZI_CRUD_EVIDENCE_APPLICATION_BUILD_DIGEST: '5'.repeat(64),
      MSAIDIZI_CRUD_EVIDENCE_PRISMA_SCHEMA_MIGRATION_DIGEST: '8'.repeat(64),
    },
  };
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
