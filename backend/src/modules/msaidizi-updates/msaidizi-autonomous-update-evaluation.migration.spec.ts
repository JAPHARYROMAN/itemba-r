import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Msaidizi autonomous update evaluation migration', () => {
  const migration = readFileSync(
    resolve(
      __dirname,
      '../../../../database/prisma/migrations/20260828100000_msaidizi_autonomous_update_evaluation/migration.sql',
    ),
    'utf8',
  );

  it('binds generated candidates and every immutable evaluation input with lowercase digests', () => {
    expect(migration).toContain('msaidizi_update_candidates_generated_binding_check');
    expect(migration).toContain(
      '("generatedSourceArtifactId" IS NULL AND "generationManifestSha256" IS NULL)',
    );
    expect(migration).toContain('"generationManifestSha256" ~ \'^[0-9a-f]{64}$\'');
    expect(migration).toContain('msaidizi_update_evaluation_run_bindings_immutable');
    for (const binding of [
      'generationArtifactId',
      'generationArtifactSha256',
      'generationManifestSha256',
      'requestDigest',
      'generatorPrincipalId',
      'generatorModelId',
      'policyVersion',
      'policyDigest',
      'requiredChecks',
      'provenance',
      'deadlineAt',
    ]) {
      expect(migration).toContain(`NEW."${binding}"`);
      expect(migration).toContain(`OLD."${binding}"`);
    }
  });

  it('enforces monotonic accounting, exact lease acquisition, and immutable terminal rows', () => {
    expect(migration).toContain('"leaseGeneration" = "dispatchCount"');
    expect(migration).toContain('NEW."leaseGeneration" < OLD."leaseGeneration"');
    expect(migration).toContain('NEW."usedModelCostMicrousd" < OLD."usedModelCostMicrousd"');
    expect(migration).toContain('NEW."leaseGeneration" <> OLD."leaseGeneration" + 1');
    expect(migration).toContain('Msaidizi update evaluation lease identity transition is invalid');
    expect(migration).toContain('Msaidizi update evaluation terminal state is immutable');
    expect(migration).toContain('Msaidizi update evaluation state transition is invalid');
  });

  it('makes terminal leases inactive and prevents deadline or wall-time lease extension', () => {
    expect(migration).toContain('"leaseId" IS NULL AND "leaseExpiresAt" IS NULL');
    expect(migration).toContain('"leaseExpiresAt" <= "deadlineAt"');
    expect(migration).toContain(
      '"leaseExpiresAt" <= "startedAt" + ("maxWallTimeSeconds" * INTERVAL \'1 second\')',
    );
    expect(migration).toContain('Msaidizi update evaluation start time is immutable');
    expect(migration).toContain('Msaidizi update evaluation lease time transition is invalid');
  });
});
