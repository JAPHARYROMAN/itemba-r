import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('host-action dispatch-mode fail-closed migration', () => {
  const schema = readFileSync(
    resolve(__dirname, '../../../../database/prisma/schema.prisma'),
    'utf8',
  );
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../../../database/prisma/migrations/20260825470000_msaidizi_host_action_dispatch_mode_fail_closed/migration.sql',
    ),
    'utf8',
  );

  it('requires every new dispatch row to state its execution authority explicitly', () => {
    const dispatchModel = schema.match(
      /model MsaidiziHostActionDispatch \{[\s\S]*?@@map\("msaidizi_host_action_dispatches"\)\s*\}/,
    )?.[0];

    expect(dispatchModel).toBeDefined();
    expect(dispatchModel).toMatch(/executionMode\s+String\s*(?:\r?\n)/);
    expect(dispatchModel).not.toMatch(/executionMode[^\r\n]*@default/);
    expect(sql).toContain('ALTER COLUMN "executionMode" DROP DEFAULT');
    expect(sql).not.toMatch(/ALTER COLUMN "executionMode" DROP NOT NULL/i);
    expect(sql).not.toMatch(/DROP CONSTRAINT[^;]*executionMode/i);
  });

  it('reclassifies only legacy evidence leases while preserving the append-only guard', () => {
    const disable = sql.indexOf(
      'DISABLE TRIGGER "msaidizi_host_action_dispatches_append_only_guard"',
    );
    const rewrite = sql.indexOf('SET "executionMode" = \'REPLAY_RESULT_ONLY\'');
    const scopedPredicate = sql.indexOf('WHERE "leaseId" LIKE \'evidence-%\'');
    const dropDefault = sql.indexOf('ALTER COLUMN "executionMode" DROP DEFAULT');
    const enable = sql.indexOf(
      'ENABLE TRIGGER "msaidizi_host_action_dispatches_append_only_guard"',
    );

    expect(sql.trimStart().startsWith('-- Dispatch authorization is fail-closed')).toBe(true);
    expect(sql).toMatch(/\bBEGIN;/);
    expect(disable).toBeGreaterThanOrEqual(0);
    expect(rewrite).toBeGreaterThan(disable);
    expect(scopedPredicate).toBeGreaterThan(rewrite);
    expect(dropDefault).toBeGreaterThan(scopedPredicate);
    expect(enable).toBeGreaterThan(dropDefault);
    expect(sql).toMatch(/COMMIT;\s*$/);
    expect(sql.match(/UPDATE\s+"msaidizi_host_action_dispatches"/g)).toHaveLength(1);
    expect(sql).toContain('AND "executionMode" = \'EXECUTE\'');
  });
});
