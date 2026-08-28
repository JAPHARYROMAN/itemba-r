import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Msaidizi update rollout v2 migration', () => {
  const migration = readFileSync(
    resolve(
      __dirname,
      '../../../../database/prisma/migrations/20260827030000_msaidizi_update_rollout_progression/migration.sql',
    ),
    'utf8',
  );
  const regression = readFileSync(
    resolve(
      __dirname,
      '../../../../database/prisma/migrations/20260827030000_msaidizi_update_rollout_progression/regression.sql',
    ),
    'utf8',
  );

  it('aborts before DDL rather than fabricating v2 provenance for a legacy ledger', () => {
    const guard = migration.indexOf('DO $msaidizi_update_rollout_v2_guard$');
    const ledgerProbe = migration.indexOf(
      'IF EXISTS (SELECT 1 FROM "msaidizi_update_deployments")',
    );
    const abortCode = migration.indexOf("ERRCODE = '55000'");
    const firstAlter = migration.indexOf('ALTER TABLE "msaidizi_update_candidates"');

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(ledgerProbe).toBeGreaterThan(guard);
    expect(abortCode).toBeGreaterThan(ledgerProbe);
    expect(firstAlter).toBeGreaterThan(abortCode);
    expect(migration).toContain('requires an empty legacy deployment ledger');
  });

  it('ships an executable regression for both QUEUED and DISPATCHED v1 rows', () => {
    expect(regression).toContain("VALUES ('queued-v1', 'QUEUED')");
    expect(regression).toContain("VALUES ('dispatched-v1', 'DISPATCHED')");
    expect(regression.match(/ERRCODE = '55000'/g)).toHaveLength(2);
    expect(regression).toMatch(/BEGIN;[\s\S]*ROLLBACK;\s*$/);
  });
});
