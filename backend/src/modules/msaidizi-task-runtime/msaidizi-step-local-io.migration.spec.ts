import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Msaidizi step local-I/O migration', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../../../database/prisma/migrations/20260825410000_msaidizi_step_local_io_accounting/migration.sql',
    ),
    'utf8',
  );

  it('adds nonnegative durable counters without pretending historical attribution is exact', () => {
    expect(sql).toContain('ADD COLUMN "bytesRead" BIGINT NOT NULL DEFAULT 0');
    expect(sql).toContain('ADD COLUMN "bytesWritten" BIGINT NOT NULL DEFAULT 0');
    expect(sql).toContain('ADD COLUMN "localIoAccountingValid" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).toContain('CHECK ("bytesRead" >= 0)');
    expect(sql).toContain('CHECK ("bytesWritten" >= 0)');
    expect(sql).toContain('ALTER COLUMN "localIoAccountingValid" SET DEFAULT true');
    expect(sql).not.toMatch(
      /UPDATE\s+"msaidizi_task_steps"\s+SET\s+"localIoAccountingValid"\s*=\s*true/i,
    );
  });

  it('makes the persisted step ceiling immutable at the database boundary', () => {
    expect(sql).toContain('msaidizi_reject_step_budget_rewrite');
    expect(sql).toContain('NEW."budgets" IS DISTINCT FROM OLD."budgets"');
    expect(sql).toContain('BEFORE UPDATE ON "msaidizi_task_steps"');
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN/i);
  });
});
