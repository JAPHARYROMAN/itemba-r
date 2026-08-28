import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('trusted audit signer migration', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../../../database/prisma/migrations/20260825280000_msaidizi_trusted_audit_signer/migration.sql',
    ),
    'utf8',
  );

  it('exposes exact canonical material, aborts on prior-chain mismatch, and is append-only', () => {
    expect(sql).toContain('msaidizi_task_event_canonical_v1');
    expect(sql).toContain('existing task-event hash mismatch at cursor');
    expect(sql).toContain('BEFORE UPDATE OR DELETE OR TRUNCATE');
    expect(sql).toContain('msaidizi audit checkpoints are append-only');
    expect(sql).not.toMatch(/DROP TABLE|ON DELETE CASCADE/i);
  });
});
