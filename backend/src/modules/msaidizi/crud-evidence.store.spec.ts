import { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CrudEvidenceStore } from './crud-evidence.store';
import { prismaSchemaMigrationDigest } from './crud-execution-evidence';

function storeWith(overrides: Record<string, string | number> = {}): CrudEvidenceStore {
  const values: Record<string, string | number> = {
    MSAIDIZI_CRUD_EVIDENCE_PATH: resolve('missing-evidence.json'),
    MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH: resolve('missing-evidence-public.pem'),
    MSAIDIZI_CRUD_EVIDENCE_KEY_ID: 'store-test-key',
    MSAIDIZI_CRUD_EVIDENCE_APPLICATION_BUILD_DIGEST: 'a'.repeat(64),
    MSAIDIZI_CRUD_EVIDENCE_PRISMA_SCHEMA_MIGRATION_DIGEST: prismaSchemaMigrationDigest(
      resolve(process.cwd(), '../database/prisma'),
    ),
    ...overrides,
  };
  return new CrudEvidenceStore({
    get: (name: string) => values[name],
  } as ConfigService);
}

describe('CrudEvidenceStore runtime provenance', () => {
  it('accepts numeric values emitted by the validated ConfigService', () => {
    const store = storeWith({ MSAIDIZI_CRUD_EVIDENCE_MAX_AGE_HOURS: 24 });
    const value = (
      store as unknown as {
        value(name: string): string | undefined;
      }
    ).value('MSAIDIZI_CRUD_EVIDENCE_MAX_AGE_HOURS');

    expect(value).toBe('24');
  });

  it('rejects configured Prisma provenance that differs from the deployed local tree', () => {
    expect(
      storeWith({
        MSAIDIZI_CRUD_EVIDENCE_PRISMA_SCHEMA_MIGRATION_DIGEST: 'f'.repeat(64),
      }).load([]),
    ).toMatchObject({
      status: 'rejected',
      reason: 'prisma_schema_migration_digest_mismatch',
    });
  });

  it('fails closed when the runtime Prisma tree is unavailable', () => {
    const originalDirectory = process.cwd();
    const isolatedBackend = mkdtempSync(join(tmpdir(), 'crud-store-no-prisma-'));
    try {
      const store = storeWith();
      process.chdir(isolatedBackend);
      expect(store.load([])).toMatchObject({
        status: 'rejected',
        reason: 'runtime_prisma_attestation_unavailable',
      });
    } finally {
      process.chdir(originalDirectory);
      rmSync(isolatedBackend, { recursive: true, force: true });
    }
  });

  it('binds verification to the exact protected artifact bytes', () => {
    const externalRoot = mkdtempSync(join(tmpdir(), 'crud-store-bound-evidence-'));
    const artifactPath = join(externalRoot, 'evidence.json');
    const publicKeyPath = join(externalRoot, 'public.pem');
    try {
      writeFileSync(artifactPath, '{}\n', { encoding: 'utf8', mode: 0o444 });
      writeFileSync(publicKeyPath, 'not-a-real-key\n', { encoding: 'utf8', mode: 0o444 });
      expect(
        storeWith({
          MSAIDIZI_CRUD_EVIDENCE_PATH: artifactPath,
          MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH: publicKeyPath,
        }).load([], new Date(), 'f'.repeat(64)),
      ).toMatchObject({
        status: 'rejected',
        reason: 'artifact_digest_mismatch',
      });
    } finally {
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });
});
