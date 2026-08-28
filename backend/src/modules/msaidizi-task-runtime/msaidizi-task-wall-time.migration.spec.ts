import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Msaidizi task wall-time migration', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../../../database/prisma/migrations/20260828090000_msaidizi_task_wall_time_accounting/migration.sql',
    ),
    'utf8',
  );
  const regression = readFileSync(
    resolve(
      __dirname,
      '../../../../database/prisma/migrations/20260828090000_msaidizi_task_wall_time_accounting/regression.sql',
    ),
    'utf8',
  );
  const utcSql = readFileSync(
    resolve(
      __dirname,
      '../../../../database/prisma/migrations/20260828110000_msaidizi_utc_runtime_accounting/migration.sql',
    ),
    'utf8',
  );
  const deadlineSql = readFileSync(
    resolve(
      __dirname,
      '../../../../database/prisma/migrations/20260827050000_msaidizi_runtime_deadline_immutability/migration.sql',
    ),
    'utf8',
  );
  const schema = readFileSync(
    resolve(__dirname, '../../../../database/prisma/schema.prisma'),
    'utf8',
  );

  it('adds and conservatively backfills a durable millisecond counter', () => {
    expect(sql).toContain('ADD COLUMN "consumedWallTimeMs" BIGINT NOT NULL DEFAULT 0');
    expect(sql).toContain('ADD COLUMN "wallTimeCheckpointAt" TIMESTAMP(3)');
    expect(sql).toContain("statement_timestamp() AT TIME ZONE 'UTC'");
    expect(sql).toContain('CHECK ("consumedWallTimeMs" >= 0)');
    expect(sql).toMatch(
      /\("wallTimeCheckpointAt" IS NOT NULL\)\s*=\s*\("startedAt" IS NOT NULL AND "endedAt" IS NULL\)/,
    );
  });

  it('uses a database-clock trigger that cannot double-count overlapping checkpoints', () => {
    expect(utcSql).toContain('CREATE OR REPLACE FUNCTION msaidizi_accrue_task_wall_time()');
    expect(utcSql).toMatch(
      /checkpoint_time TIMESTAMP\(3\) :=\s*\(clock_timestamp\(\) AT TIME ZONE 'UTC'\)::TIMESTAMP\(3\)/,
    );
    expect(utcSql).not.toContain('clock_timestamp()::TIMESTAMP(3)');
    expect(sql).not.toContain('clock_timestamp()::TIMESTAMP(3)');
    expect(utcSql).toContain('checkpoint_time - OLD."wallTimeCheckpointAt"');
    expect(utcSql).toContain(
      'NEW."consumedWallTimeMs" := OLD."consumedWallTimeMs" + elapsed_delta_ms',
    );
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON "msaidizi_tasks"');
    expect(utcSql).not.toMatch(/NEW\."consumedWallTimeMs"\s*:=\s*NEW\."consumedWallTimeMs"/);
  });

  it('keeps pause and cancellation on the original first-start hard clock', () => {
    expect(sql).toContain('NEW."startedAt" IS NOT NULL AND NEW."endedAt" IS NULL');
    expect(sql).not.toMatch(/NEW\."status"\s*=\s*'RUNNING'/);
  });

  it('freezes terminal intervals and resumes from the persisted value when reopened', () => {
    expect(sql).not.toContain('checkpoint_time - OLD."endedAt"');
    expect(sql).toContain(
      "RAISE EXCEPTION 'Msaidizi task cannot be inserted in a terminal runtime state'",
    );
  });

  it('rejects forged backdated or future starts on INSERT', () => {
    expect(utcSql).toContain('NEW."startedAt" < NEW."createdAt"');
    expect(utcSql).toContain(`NEW."startedAt" > checkpoint_time + INTERVAL '5 minutes'`);
    expect(utcSql).toContain(
      "RAISE EXCEPTION 'Msaidizi task initial start timestamp is outside its valid window'",
    );
  });

  it('normalizes task and step defaults and every runtime guard to UTC', () => {
    expect(utcSql.match(/CURRENT_TIMESTAMP AT TIME ZONE 'UTC'/g)).toHaveLength(2);
    expect(utcSql.match(/clock_timestamp\(\) AT TIME ZONE 'UTC'/g)?.length).toBeGreaterThanOrEqual(
      3,
    );
    expect(utcSql).toContain('BEFORE INSERT OR UPDATE ON "msaidizi_task_steps"');
    expect(utcSql).toContain("IF TG_OP = 'INSERT' THEN");
    expect(deadlineSql.match(/clock_timestamp\(\) AT TIME ZONE 'UTC'/g)).toHaveLength(2);
    expect(deadlineSql).not.toMatch(/startedAt"\s*>\s*clock_timestamp\(\)/);
    expect(
      schema.match(/@default\(dbgenerated\("\(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)"\)\)/g),
    ).toHaveLength(2);
  });

  it('ships an executable restart/pause/terminal/import regression', () => {
    expect(regression).toContain('EXECUTE FUNCTION msaidizi_accrue_task_wall_time()');
    expect(regression).toContain('$pause_and_cancel_accrue$');
    expect(regression).toContain('$terminal_gap_is_frozen$');
    expect(regression).toContain('$missing_checkpoint_rejected$');
    expect(regression).toContain('$terminal_insert_rejected$');
    expect(regression).toContain('$forged_start_rejected$');
    expect(regression).toContain("SET LOCAL TIME ZONE 'Africa/Nairobi'");
    expect(regression).toContain('$utc_direct_running_insert$');
    expect(regression).toContain('$utc_defaults_and_step_starts$');
    expect(regression).toContain('$step_start_guards$');
    expect(regression).toContain('$real_task_utc_accounting$');
    expect(regression).toContain('$real_step_utc_start$');
    expect(regression).toContain('ROLLBACK;');
  });
});
