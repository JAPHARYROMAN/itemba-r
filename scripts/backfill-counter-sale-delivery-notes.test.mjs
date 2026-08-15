#!/usr/bin/env node
/**
 * Tests for the counter-sale delivery-note backfill script.
 *
 *   node --test scripts/backfill-counter-sale-delivery-notes.test.mjs
 *
 * These are pure assertions — no database, no container, no network. The
 * load-bearing ones are:
 *
 *   - NO DOUBLE STOCK. The real DeliveryNotesService source is read and
 *     asserted to contain no inventory symbols at all. This is the assertion
 *     that keeps the whole change safe, and it fails the day somebody adds a
 *     stock effect to the delivery-note service — which is the only way
 *     issuing a note for a POS sale could ever decrement stock twice.
 *   - The idempotency guarantee the script demands is the one the migration
 *     actually creates (the two files are cross-checked against each other).
 *   - The population is exactly the one the script's header claims.
 *   - The default mode writes nothing.
 *   - NO FALSE ALARMS. Every guard is scoped to rows that existed when the run
 *     started, so a shop that keeps selling through the run cannot produce a
 *     single FAILED line. This is not politeness: an alarm that says "STOP and
 *     investigate before selling again" is believed exactly once, and a guard
 *     that cries wolf during ordinary trading is a guard that will be ignored
 *     the day it is right. "A shop trading normally" is therefore a first-class
 *     test case here, asserted against every guard at once.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BATCH_SIZE,
  DEFAULT_ENDPOINT,
  DELIVERY_NOTES_SERVICE_PATH,
  PERMISSION_PROBE_ENDPOINT,
  POPULATION_WHERE,
  REQUIRED_COLUMN,
  REQUIRED_UNIQUE_INDEX,
  WORKLIST_SERVICE_PATHS,
  applyCommand,
  buildPopulationQuery,
  buildRevertSql,
  buildSnapshotQueries,
  diffSnapshots,
  findStockEffects,
  findUnprotectedDeliveryQueries,
  parseArgs,
  readSnapshot,
  summariseCounterNotes,
  summariseInventedEvidence,
  summariseNoteCensus,
} from './backfill-counter-sale-delivery-notes.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(resolve(rootDir, relativePath), 'utf8');

/**
 * A snapshot with everything at rest; spread over it to move one dial.
 *
 * Note which fields the guards actually read: every one of them is scoped at
 * the run's own start (`preRun*`, `posOrderSaleIssue*`, `noteStockMovements`).
 * The unscoped fields — `population`, `counterNotesLive`, `*SinceRunStart` —
 * are the operator's working figures, and no guard is allowed to fail on them,
 * because a shop that is still selling moves them every few minutes.
 */
const restingSnapshot = {
  // Unscoped, operational.
  population: 19,
  populationCompanies: 1,
  counterNotesLive: 0,
  counterNotesLiveNotDelivered: 0,
  counterNotesDeleted: 0,
  counterNotesByStatus: {},
  counterNotesSinceRunStart: 0,
  // Scoped at run start — the guards read only these.
  populationPreRun: 19,
  preRunCounterNotes: 0,
  preRunCounterNotesLive: 0,
  preRunDeskNotesLive: 7,
  inventedEvidencePreRun: 0,
  inventedEvidenceSinceRunStart: 0,
  noteStockMovements: 0,
  posOrderSaleIssueMovements: 412,
  posOrderSaleIssueQuantity: '1874.0000',
  posOrderSaleIssueSinceRunStart: 0,
};

// ───────────────────────────────────────────────────────────────────────────
// NO DOUBLE STOCK — the assertion the whole change rests on
// ───────────────────────────────────────────────────────────────────────────

test('DeliveryNotesService has no inventory effects, so a counter note cannot move stock twice', () => {
  const source = read(DELIVERY_NOTES_SERVICE_PATH);
  assert.deepEqual(
    findStockEffects(source),
    [],
    `${DELIVERY_NOTES_SERVICE_PATH} must not touch inventory. The sale already issues SALE_ISSUE ` +
      'movements; a delivery note that also wrote stock would decrement it a second time for every ' +
      'counter sale. If this fails, do NOT ship the counter-delivery change.',
  );
});

test('the stock-effect guard actually detects a stock effect', () => {
  // Guard against the guard silently passing because the patterns stopped
  // matching anything at all.
  assert.deepEqual(findStockEffects('await tx.inventoryMovement.create({});'), ['inventoryMovement']);
  assert.deepEqual(findStockEffects('prisma.inventoryBalance.upsert()'), ['inventoryBalance']);
  assert.deepEqual(findStockEffects('tx.productBatch.update()'), ['productBatch']);
  assert.deepEqual(findStockEffects('stockLedger.append()'), ['stockLedger']);
  assert.deepEqual(findStockEffects('// a note is only a document'), []);
});

test('the backfill script never writes stock, GL or money itself', () => {
  const source = read('scripts/backfill-counter-sale-delivery-notes.mjs');
  // Everything this script does to the database is a read. The only writes in
  // the whole flow happen behind the manager-authorised endpoint.
  for (const forbidden of [
    /\binsert\s+into\b/i,
    /\bupdate\s+"?delivery_notes"?\s+set\b/i,
    /\bdelete\s+from\b/i,
    /journalEntry/,
    /inventoryMovement\.create/,
  ]) {
    const hit = source.match(forbidden);
    // The revert SQL is a printed string, never executed; it is the one place
    // an UPDATE may appear.
    if (hit && !source.slice(Math.max(0, hit.index - 600), hit.index).includes('buildRevertSql')) {
      assert.fail(`backfill script contains a write statement outside buildRevertSql: ${hit[0]}`);
    }
  }
});

// ───────────────────────────────────────────────────────────────────────────
// WORKLIST PROTECTION — a counter sale is a collection, not a dispatch
// ───────────────────────────────────────────────────────────────────────────

test('the worklist guard flags an aggregate delivery-note query with no discriminator', () => {
  const source = `
    const a = await this.prisma.deliveryNote.count({ where: { companyId, status: 'DRAFT' } });
    const b = await this.prisma.deliveryNote.findMany({ where: { companyId, counterSaleOrderId: null } });
  `;
  const unprotected = findUnprotectedDeliveryQueries(source);
  assert.equal(unprotected.length, 1);
  assert.equal(unprotected[0].method, 'count');
});

test('the worklist guard survives nested parentheses in the query body', () => {
  const source = `
    this.prisma.deliveryNote.groupBy({
      by: ['status'],
      where: { companyId, deliveryDate: { lt: startOfDay(new Date()) }, counterSaleOrderId: null },
    });
  `;
  assert.deepEqual(findUnprotectedDeliveryQueries(source), []);
});

test('a shared module-scope discriminator constant counts as protection everywhere', () => {
  // The house style: one `const NOT_A_COUNTER_SALE = { counterSaleOrderId: null }`
  // spread into every office query.
  const source = [
    "const NOT_A_COUNTER_SALE = { counterSaleOrderId: null } as const;",
    '',
    'class S {',
    '  async a() { return this.prisma.deliveryNote.count({ where: { ...NOT_A_COUNTER_SALE, companyId } }); }',
    '  async b() { return this.prisma.deliveryNote.findMany({ where: { companyId } }); }',
    '}',
  ].join('\n');
  const unprotected = findUnprotectedDeliveryQueries(source);
  assert.equal(unprotected.length, 1, 'only the query without the constant is unprotected');
  assert.equal(unprotected[0].method, 'findMany');
});

test('a where object built just above the query counts as protection', () => {
  const source = [
    '    const where: any = { ...companyWhere, counterSaleOrderId: null, deletedAt: null };',
    '    const rows = await this.prisma.deliveryNote.groupBy({ by: ["status"], where });',
  ].join('\n');
  assert.deepEqual(findUnprotectedDeliveryQueries(source), []);
});

test('a local where object far from the query does not protect it', () => {
  const source = [
    '    const where = { counterSaleOrderId: null };',
    ...Array.from({ length: 80 }, () => '    // ...'),
    '    await this.prisma.deliveryNote.count({ where });',
  ].join('\n');
  assert.equal(findUnprotectedDeliveryQueries(source).length, 1);
});

test('the worklist guard ignores single-note lookups, which must stay visible', () => {
  // A counter note must remain reachable where the ORDER is the subject: the
  // sales-order detail, global search, and its own print view.
  const source = `
    this.prisma.deliveryNote.findUnique({ where: { id } });
    this.prisma.deliveryNote.findFirst({ where: { id, companyId } });
  `;
  assert.deepEqual(findUnprotectedDeliveryQueries(source), []);
});

test('the guard checks both office services named by the spec, and passes on the real ones', () => {
  assert.deepEqual(WORKLIST_SERVICE_PATHS, [
    'backend/src/modules/westsides-dashboard/westsides-dashboard.service.ts',
    'backend/src/modules/westsides-reports/westsides-reports.service.ts',
  ]);
  for (const path of WORKLIST_SERVICE_PATHS) {
    const source = read(path);
    assert.ok(source.length > 0, `${path} must exist for the worklist guard to mean anything`);
    // Run the guard over the REAL source, not only synthetic strings. Without
    // this the guard could quietly stop matching real-world code while every
    // hand-written fixture still passed, and the script would keep printing
    // "ok office delivery worklists exclude counter-sale notes" over an office
    // that was in fact unprotected.
    assert.deepEqual(
      findUnprotectedDeliveryQueries(source),
      [],
      `${path} has an aggregate delivery-note query with no counterSaleOrderId discriminator`,
    );
  }
});

test('the guard reports a line number an operator can act on', () => {
  const source = ['const x = 1;', '', 'this.prisma.deliveryNote.aggregate({ where: {} });'].join('\n');
  assert.deepEqual(findUnprotectedDeliveryQueries(source), [{ method: 'aggregate', line: 3 }]);
});

// ───────────────────────────────────────────────────────────────────────────
// IDEMPOTENCY — the guarantee is the database's, and it is the real one
// ───────────────────────────────────────────────────────────────────────────

test('the unique index the script demands is the one the migration creates', () => {
  const migration = read('database/prisma/migrations/20260815120000_delivery_note_counter_sale_key/migration.sql');
  assert.match(migration, new RegExp(`CREATE UNIQUE INDEX "${REQUIRED_UNIQUE_INDEX}"`));
  assert.match(migration, /ADD COLUMN "counterSaleOrderId" TEXT/);
  assert.equal(REQUIRED_COLUMN.table, 'delivery_notes');
  assert.equal(REQUIRED_COLUMN.column, 'counterSaleOrderId');
  // Additive only — the backfill must never be part of a migration.
  assert.doesNotMatch(migration, /\bDROP\b/i);
  assert.doesNotMatch(migration, /\bINSERT\b/i);
});

test('the schema declares the company-scoped unique, matching the idempotency-key pattern', () => {
  const schema = read('database/prisma/schema.prisma');
  assert.match(schema, /@@unique\(\[companyId, counterSaleOrderId\]\)/);
  // Same shape as the pattern this follows (migration 20260813120000).
  assert.match(schema, /@@unique\(\[companyId, idempotencyKey\]\)/);
});

test('the script refuses to apply without the index: the guarantee query looks it up by name', () => {
  const { guarantee } = buildSnapshotQueries();
  assert.match(guarantee.sql, /pg_indexes/);
  assert.match(guarantee.sql, new RegExp(REQUIRED_UNIQUE_INDEX));
  assert.match(guarantee.sql, /information_schema\.columns/);
});

// ───────────────────────────────────────────────────────────────────────────
// SCOPE — exactly the population the header claims, and nothing wider
// ───────────────────────────────────────────────────────────────────────────

test('the population is POS-originated, complete, un-noted sales orders only', () => {
  assert.match(POPULATION_WHERE, /so\."mobilePosTerminalId" IS NOT NULL/);
  assert.match(POPULATION_WHERE, /so\."status" IN \('CONFIRMED','PARTIALLY_PAID','PAID'\)/);
  assert.match(POPULATION_WHERE, /so\."deletedAt" IS NULL/);
  assert.match(POPULATION_WHERE, /EXISTS \(SELECT 1 FROM "sales_order_lines"/);
  assert.match(POPULATION_WHERE, /NOT EXISTS/);
  assert.match(POPULATION_WHERE, /dn\."counterSaleOrderId" = so\."id"/);
  assert.match(POPULATION_WHERE, /dn\."companyId" = so\."companyId"/);
});

test('DRAFT, CANCELLED and VOIDED orders are never given a delivery note', () => {
  for (const status of ['DRAFT', 'CANCELLED', 'VOIDED']) {
    assert.doesNotMatch(
      POPULATION_WHERE,
      new RegExp(`'${status}'`),
      `${status} orders never had goods leave a counter — they must not appear in the population`,
    );
  }
});

test('POS origin is proved by the terminal stamp alone, never by free text or payment method', () => {
  // A notes marker can be typed by a human and a cash sale can be rung from the
  // desktop; only mobilePosTerminalId is server-derived proof. (The literal
  // "delivery_notes" table name is fine — what must never appear is a match
  // against a free-text `notes` column.)
  assert.doesNotMatch(POPULATION_WHERE, /"notes"/i);
  assert.doesNotMatch(POPULATION_WHERE, /\bI?LIKE\b/i);
  assert.doesNotMatch(POPULATION_WHERE, /paymentMethod/i);
  assert.doesNotMatch(POPULATION_WHERE, /salesType/i);
});

test('companyId is bound as a parameter, never interpolated into SQL', () => {
  const evil = "x' OR '1'='1";
  const { countSql, listSql, params } = buildPopulationQuery({ companyId: evil });
  assert.equal(params[0], evil);
  assert.ok(!countSql.includes(evil), 'companyId must not appear inline in the count SQL');
  assert.ok(!listSql.includes(evil), 'companyId must not appear inline in the list SQL');
  assert.match(countSql, /so\."companyId" = \$1/);
});

test('the count and the list share one WHERE body so they cannot drift', () => {
  const { countSql, listSql } = buildPopulationQuery();
  assert.ok(countSql.includes(POPULATION_WHERE));
  assert.ok(listSql.includes(POPULATION_WHERE));
});

test('the list orders oldest-first and caps itself', () => {
  const { listSql, params } = buildPopulationQuery({ limit: 50 });
  assert.match(listSql, /ORDER BY so\."orderDate" ASC/);
  assert.match(listSql, /LIMIT \$1/);
  assert.equal(params[0], 50);
});

test('the endpoint and batch size match the spec', () => {
  assert.equal(DEFAULT_ENDPOINT, '/mobile-pos-lite/counter-delivery-backfill');
  assert.equal(BATCH_SIZE, 500);
});

test('the batch loop stops on the page size the endpoint actually uses', () => {
  // The loop reads `scanned < BATCH_SIZE` as "that was the last page". If the
  // server's cap moved and this constant did not, a full run would stop after
  // one batch and quietly leave the rest of history unrepaired.
  const service = read('backend/src/modules/mobile-pos-lite/mobile-pos-lite.service.ts');
  const match = service.match(/const COUNTER_DELIVERY_BACKFILL_BATCH = (\d+);/);
  assert.ok(match, 'the endpoint must declare its per-request cap as a named constant');
  assert.equal(Number(match[1]), BATCH_SIZE);
});

test('the report fields the loop reads are the ones the endpoint returns', () => {
  // The script drives batches off `created`/`resumed`/`scanned` and prints
  // `failures[].salesOrderNumber`. A rename on either side would leave the loop
  // reading undefined, i.e. "no progress", and stopping after one batch.
  const dto = read('backend/src/modules/mobile-pos-lite/dto/mobile-pos-lite-counter-delivery-backfill.dto.ts');
  for (const field of ['scanned', 'created', 'resumed', 'skipped', 'failed', 'failures']) {
    assert.match(dto, new RegExp(`\\n\\s{2}${field}[?]?:`), `the report must carry ${field}`);
  }
  for (const field of ['salesOrderId', 'salesOrderNumber', 'reason']) {
    assert.match(dto, new RegExp(`\\n\\s{2}${field}:`), `a failure must carry ${field}`);
  }
  // And the route is the one the script posts to, gated where the script's
  // permission probe says it is.
  const controller = read('backend/src/modules/mobile-pos-lite/mobile-pos-lite.controller.ts');
  assert.match(
    controller,
    /@Post\('counter-delivery-backfill'\)\s*\n\s*@RequirePermissions\('mobile_pos_lite\.manage'\)/,
  );
  assert.equal(DEFAULT_ENDPOINT, '/mobile-pos-lite/counter-delivery-backfill');
});

test('the population count separates the work this run was given from what arrived after', () => {
  // "Cleared" and "still outstanding" are computed from the pre-run figure. On
  // a trading shop the unscoped population never reaches zero, so reporting
  // progress against it would show a finished run as an unfinished one.
  const { population } = buildSnapshotQueries({ runStartedAt: new Date('2026-08-15T09:00:00.000Z') });
  assert.ok(population.sql.includes(POPULATION_WHERE), 'one WHERE body, so the count cannot drift from the list');
  assert.match(population.sql, /FILTER \(WHERE so\."createdAt" < \$1::timestamp\)/);
  const snapshot = readSnapshot({ population: [{ count: '21', companies: 2, preRun: '19' }] });
  assert.equal(snapshot.population, 21);
  assert.equal(snapshot.populationPreRun, 19);
  assert.equal(snapshot.populationCompanies, 2);
});

test('the script tells the operator when its SQL is wider than the endpoint', () => {
  // The endpoint is scoped to the manager's companies (spec §4.2); this SQL is
  // scoped to whatever --company-id says, or nothing. When they differ, say so.
  const source = read('scripts/backfill-counter-sale-delivery-notes.mjs');
  assert.match(source, /!options\.companyId && before\.populationCompanies > 1/);
  assert.match(source, /the endpoint will only/);
  assert.match(source, /Re-run with --company-id <uuid> to make the two agree/);
});

// ───────────────────────────────────────────────────────────────────────────
// THE HEADER IS THE OPERATING MANUAL — it must not oversell the guards
// ───────────────────────────────────────────────────────────────────────────

test('the header says which modes are safe during trading hours, and which are not', () => {
  const header = read('scripts/backfill-counter-sale-delivery-notes.mjs').split('*/')[0];
  assert.match(header, /safe to run mid-trade/);
  assert.match(header, /`--apply` should still be run OUTSIDE trading hours/);
});

test('the header states what the guards cannot prove, instead of implying they prove everything', () => {
  const header = read('scripts/backfill-counter-sale-delivery-notes.mjs').split('*/')[0];
  assert.match(header, /WHAT THE GUARDS STILL CANNOT PROVE/);
  // The three admissions that matter, each of which the output repeats in place.
  assert.match(header, /TRANSACTION START/, 'the createdAt race is disclosed, not hidden');
  assert.match(header, /read THIS\n \* {5}CHECKOUT, not the server/, 'source-level preflights say what they read');
  assert.match(header, /DRY RUN issues no write request/);
});

// ───────────────────────────────────────────────────────────────────────────
// DRY RUN FIRST — the default mode must be inert
// ───────────────────────────────────────────────────────────────────────────

test('the default mode is a dry run', () => {
  assert.equal(parseArgs([]).willWrite, false);
});

test('--apply on its own is still a dry run; both flags are required to write', () => {
  assert.equal(parseArgs(['--apply']).willWrite, false);
  assert.equal(parseArgs(['--confirm']).willWrite, false);
  assert.equal(parseArgs(['--apply', '--confirm']).willWrite, true);
});

test('--verify-only can never write, even with both write flags', () => {
  assert.equal(parseArgs(['--apply', '--confirm', '--verify-only']).willWrite, false);
});

test('arguments are parsed in both --flag value and --flag=value form', () => {
  assert.equal(parseArgs(['--company-id', 'abc']).companyId, 'abc');
  assert.equal(parseArgs(['--company-id=abc']).companyId, 'abc');
  assert.equal(parseArgs(['--runner=local']).runner, 'local');
});

test('the command the dry run prints is one that would actually apply', () => {
  // It echoes back the flags the operator typed, so a doubled --apply or a
  // leftover --verify-only would print a command that quietly reads again.
  assert.deepEqual(applyCommand(['--company-id', 'abc']), ['--company-id', 'abc', '--apply', '--confirm']);
  assert.deepEqual(applyCommand(['--apply']), ['--apply', '--confirm']);
  assert.deepEqual(applyCommand(['--verify-only', '--list=200']), ['--list=200', '--apply', '--confirm']);
  assert.equal(parseArgs(applyCommand(['--apply', '--confirm'])).willWrite, true);
});

test('a mistyped flag stops the run instead of being silently ignored', () => {
  assert.throws(() => parseArgs(['--aply', '--confirm']), /Unknown argument: --aply/);
  assert.throws(() => parseArgs(['--runner=sqlite']), /--runner must be/);
  assert.throws(() => parseArgs(['--list=abc']), /--list must be a positive integer/);
  assert.throws(() => parseArgs(['--max-batches=0']), /--max-batches must be a positive integer/);
});

test('the dry run makes no claim about rows it did not write', () => {
  // The dry run issues no POST at all, so counter notes appearing while it runs
  // are the live counter path, not the script. It reports them; it does not
  // accuse itself (or anyone) of anything.
  const before = { ...restingSnapshot };
  const after = { ...restingSnapshot, counterNotesLive: 3, counterNotesSinceRunStart: 3 };
  const { failures, warnings, observations } = diffSnapshots(before, after, { applied: false });
  assert.deepEqual(failures, []);
  assert.deepEqual(warnings, []);
  assert.ok(observations.some((o) => /issued no write request/.test(o)));
});

test('a dry run still fails if a note that predates it was touched', () => {
  // What a dry run CAN assert: the rows that existed when it started are as it
  // found them. Nothing about that claim depends on the shop being closed.
  const before = { ...restingSnapshot, preRunCounterNotesLive: 4, preRunCounterNotes: 4 };
  const after = { ...restingSnapshot, preRunCounterNotesLive: 3, preRunCounterNotes: 4 };
  const { failures } = diffSnapshots(before, after, { applied: false });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /NOTES DISAPPEARED/);
});

// ───────────────────────────────────────────────────────────────────────────
// NO FALSE ALARMS — a shop trading through the run raises nothing
// ───────────────────────────────────────────────────────────────────────────

test('a DRY RUN on a shop that keeps selling raises no failure and no warning', () => {
  // THE REGRESSION THIS SUITE EXISTS FOR. Every unscoped counter moves: three
  // more counter sales are rung (new SALE_ISSUE movements, new counter notes,
  // two more orders in the population), and the office writes a desk note.
  // The old guards read whole tables and answered "STOCK MOVED … STOP and
  // investigate before selling again", exit 1, from a run that wrote nothing.
  const before = { ...restingSnapshot };
  const after = {
    ...restingSnapshot,
    population: 21,
    counterNotesLive: 3,
    counterNotesSinceRunStart: 3,
    // The scoped guards do not move, because none of that traffic is in scope.
  };
  const { failures, warnings, observations } = diffSnapshots(before, after, { applied: false });
  assert.deepEqual(failures, [], 'a customer buying something in the next room must never fail this run');
  assert.deepEqual(warnings, [], 'nor warn — normal trading is not a warning');
  assert.ok(observations.length > 0, 'it is reported, as an observation');
});

test('an APPLIED run on a shop that keeps selling reports only what it did', () => {
  const before = { ...restingSnapshot };
  const after = {
    ...restingSnapshot,
    population: 2, // 19 cleared by the run, 2 rung meanwhile
    populationPreRun: 0,
    counterNotesLive: 22,
    counterNotesSinceRunStart: 22,
    preRunCounterNotes: 0,
    counterNotesByStatus: { DELIVERED: 22 },
  };
  const { failures, warnings, observations } = diffSnapshots(before, after, {
    applied: true,
    reported: { batches: 1, scanned: 19, created: 19, resumed: 0, skipped: 0, failed: 0 },
  });
  assert.deepEqual(failures, []);
  assert.deepEqual(warnings, [], 'the pre-run backlog is clear, so there is nothing to re-run for');
  // 22 notes appeared, the endpoint claims 19 — the difference is the counter.
  assert.ok(observations.some((o) => /the endpoint reports 19 of them/.test(o)));
});

test('the guards that can fail are exactly the scoped ones', () => {
  // Move every UNSCOPED figure as far as a busy trading day could move it, and
  // leave every scoped figure alone. Nothing may fire.
  const before = { ...restingSnapshot };
  const after = {
    ...restingSnapshot,
    population: 400,
    populationCompanies: 3,
    counterNotesLive: 900,
    counterNotesDeleted: 12,
    counterNotesSinceRunStart: 900,
    counterNotesByStatus: { DELIVERED: 900 },
  };
  for (const applied of [false, true]) {
    const { failures } = diffSnapshots(before, after, {
      applied,
      reported: applied ? { batches: 1, scanned: 19, created: 19, resumed: 0, skipped: 0, failed: 0 } : null,
    });
    assert.deepEqual(failures, [], `unscoped movement must not fail the run (applied=${applied})`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// STOCK MUST NOT MOVE TWICE — asserted on the run's own before/after evidence
// ───────────────────────────────────────────────────────────────────────────

test('any inventory movement written against a counter-sale note fails the run', () => {
  // The rule itself, stated absolutely: a delivery note has no stock effect.
  // Not a delta — a delta would pass a database that already had this wrong.
  const before = { ...restingSnapshot };
  const after = { ...restingSnapshot, populationPreRun: 0, counterNotesLive: 19, noteStockMovements: 3 };
  const { failures } = diffSnapshots(before, after, { applied: true });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /STOCK MOVED BY A DELIVERY NOTE: 3 inventory movement/);
  assert.match(failures[0], /STOP and investigate before selling again/);
});

test('the note-stock guard needs no time bound, because trading cannot reach it', () => {
  // A sale's SALE_ISSUE movements reference the SalesOrder, never a note — so
  // this count is unmovable by the counter, and it is asserted at rest, not as
  // a difference between two readings.
  const { guardNoteStock } = buildSnapshotQueries();
  assert.match(guardNoteStock.sql, /FROM "inventory_movements" im/);
  assert.match(guardNoteStock.sql, /dn\."id" = im\."referenceId"/);
  assert.match(guardNoteStock.sql, /dn\."counterSaleOrderId" IS NOT NULL/);
  assert.doesNotMatch(guardNoteStock.sql, /movementType/, 'ANY movement type counts, not only SALE_ISSUE');
  // Already broken before the run is still broken: absolute, not relative.
  const { failures } = diffSnapshots(
    { ...restingSnapshot, noteStockMovements: 2 },
    { ...restingSnapshot, noteStockMovements: 2 },
    { applied: true },
  );
  assert.ok(failures.some((f) => /already before this run started/.test(f)));
});

test('a change in SALE_ISSUE for the orders under repair fails the run', () => {
  const before = { ...restingSnapshot };
  const after = {
    ...restingSnapshot,
    populationPreRun: 0,
    counterNotesLive: 19,
    posOrderSaleIssueMovements: 431,
    posOrderSaleIssueSinceRunStart: 19,
  };
  const { failures } = diffSnapshots(before, after, { applied: true });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /STOCK MOVED FOR ORDERS UNDER REPAIR/);
  assert.match(failures[0], /412 movement\(s\) \/ 1874\.0000 -> 431 \/ 1874\.0000/);
});

test('a change in SALE_ISSUE quantity fails the run even when the row count is unchanged', () => {
  // Guards the case where movements are updated rather than inserted.
  const before = { ...restingSnapshot };
  const after = { ...restingSnapshot, populationPreRun: 0, counterNotesLive: 19, posOrderSaleIssueQuantity: '3748.0000' };
  const { failures } = diffSnapshots(before, after, { applied: true });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /STOCK MOVED FOR ORDERS UNDER REPAIR/);
  // It names the one benign explanation instead of asserting corruption it
  // cannot prove, and tells the operator to rule that out first.
  assert.match(failures[0], /history itself was edited/);
});

test('the stock alarm names the one benign cause it cannot rule out', () => {
  // Postgres stamps createdAt at transaction start, so a sale whose own
  // transaction opened just before the run can land inside the scope. That is a
  // window of one transaction, and the operator is told to check it first
  // rather than being told to stop selling on the strength of it.
  const after = { ...restingSnapshot, posOrderSaleIssueMovements: 413, posOrderSaleIssueSinceRunStart: 1 };
  const { failures } = diffSnapshots({ ...restingSnapshot }, after, { applied: true });
  assert.match(failures[0], /transaction opened before the "started" timestamp/);
  assert.match(failures[0], /1 of those movements were written after the run started/);
});

test('the SALE_ISSUE guard is scoped to POS orders that predate the run', () => {
  const { guardPosOrderStock } = buildSnapshotQueries({ runStartedAt: new Date('2026-08-15T09:00:00.000Z') });
  assert.match(guardPosOrderStock.sql, /"movementType" = 'SALE_ISSUE'/);
  assert.match(guardPosOrderStock.sql, /sum\(im\."quantity"\)/);
  // The scope: POS-originated orders that already existed. Both qualifiers are
  // immutable after creation, so BEFORE and AFTER read the same set.
  assert.match(guardPosOrderStock.sql, /so\."mobilePosTerminalId" IS NOT NULL/);
  assert.match(guardPosOrderStock.sql, /so\."createdAt" < \$1::timestamp/);
  assert.equal(guardPosOrderStock.params[0], '2026-08-15T09:00:00.000Z');
  // Kept as text so a Decimal(18,4) total is compared exactly, not as a float.
  const snapshot = readSnapshot({
    guardPosOrderStock: [{ movements: '412', quantity: '1874.0000', sinceRunStart: '0' }],
  });
  assert.equal(snapshot.posOrderSaleIssueMovements, 412);
  assert.equal(snapshot.posOrderSaleIssueQuantity, '1874.0000');
});

test('no snapshot query counts a whole table', () => {
  // The defect this suite was written against: a guard with no scope is an
  // alarm bell wired to the shop's till. Every guard must be bounded either by
  // the run's start timestamp or by counterSaleOrderId — nothing else.
  const queries = buildSnapshotQueries({ runStartedAt: new Date('2026-08-15T09:00:00.000Z') });
  for (const [name, entry] of Object.entries(queries)) {
    if (name === 'guarantee' || name === 'counterNotes') continue; // catalog probe; display only
    const scoped = entry.params.includes('2026-08-15T09:00:00.000Z') || /counterSaleOrderId/.test(entry.sql);
    assert.ok(scoped, `${name} must be scoped to the run's own population, not to a whole table`);
  }
});

test('a clean applied run reports no failures', () => {
  const before = { ...restingSnapshot };
  const after = {
    ...restingSnapshot,
    population: 0,
    populationPreRun: 0,
    counterNotesLive: 19,
    counterNotesSinceRunStart: 19,
    counterNotesByStatus: { DELIVERED: 19 },
  };
  const { failures } = diffSnapshots(before, after, {
    applied: true,
    reported: { batches: 1, scanned: 19, created: 19, resumed: 0, skipped: 0, failed: 0 },
  });
  assert.deepEqual(failures, []);
});

// ───────────────────────────────────────────────────────────────────────────
// BLAST RADIUS — desk notes and invented evidence
// ───────────────────────────────────────────────────────────────────────────

test('an office user writing a delivery note mid-run is not an alarm', () => {
  // The old guard counted every live desk note, so this exact sequence — an
  // office clerk raising one delivery note while the backfill ran — produced
  // "DESK NOTES DISTURBED", a failure, exit 1. The new census counts only desk
  // notes that were live when the run started, which a new note cannot move.
  const before = { ...restingSnapshot, preRunDeskNotesLive: 7 };
  const after = { ...restingSnapshot, preRunDeskNotesLive: 7, populationPreRun: 0, counterNotesLive: 19 };
  const { failures, warnings } = diffSnapshots(before, after, {
    applied: true,
    reported: { batches: 1, scanned: 19, created: 19, resumed: 0, skipped: 0, failed: 0 },
  });
  assert.deepEqual(failures, []);
  assert.deepEqual(warnings, []);
});

test('a desk note that WAS live and is gone warns, and says what it cannot prove', () => {
  const before = { ...restingSnapshot, preRunDeskNotesLive: 7 };
  const after = { ...restingSnapshot, preRunDeskNotesLive: 6, populationPreRun: 0 };
  const { failures, warnings } = diffSnapshots(before, after, {
    applied: true,
    reported: { batches: 1, scanned: 19, created: 19, resumed: 0, skipped: 0, failed: 0 },
  });
  // Not a failure: this script and the endpoint have no path that deletes a
  // desk note, so blaming the run for it would be a claim, not a finding.
  assert.deepEqual(failures, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /no longer live/);
  assert.match(warnings[0], /Nothing measured here can prove it either way/);
});

test('a note that existed before the run being re-keyed onto a counter sale fails', () => {
  // The one way the backfill could actually damage a desk note: adopt it
  // instead of creating a new one. Scoped to rows that predate the run, so the
  // notes the run legitimately creates cannot trip it.
  const before = { ...restingSnapshot, preRunCounterNotes: 0, preRunDeskNotesLive: 7 };
  const after = { ...restingSnapshot, preRunCounterNotes: 1, preRunDeskNotesLive: 6, populationPreRun: 0 };
  const { failures } = diffSnapshots(before, after, {
    applied: true,
    reported: { batches: 1, scanned: 19, created: 19, resumed: 0, skipped: 0, failed: 0 },
  });
  assert.ok(failures.some((f) => /NOTE RE-KEYED: 1 delivery note/.test(f)));
});

test('a counter note carrying a driver, vehicle, address or phone fails the run', () => {
  const before = { ...restingSnapshot };
  const after = {
    ...restingSnapshot,
    populationPreRun: 0,
    counterNotesLive: 19,
    inventedEvidenceSinceRunStart: 2,
  };
  const { failures } = diffSnapshots(before, after, {
    applied: true,
    reported: { batches: 1, scanned: 19, created: 19, resumed: 0, skipped: 0, failed: 0 },
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /INVENTED EVIDENCE: 2 counter-sale note\(s\) created since this run started/);
  assert.match(failures[0], /Revert this run/);
});

test('the same finding on a dry run does not tell the operator to revert a run that wrote nothing', () => {
  const after = { ...restingSnapshot, inventedEvidenceSinceRunStart: 1 };
  const { failures } = diffSnapshots({ ...restingSnapshot }, after, { applied: false });
  assert.match(failures[0], /issued no write request/);
  assert.doesNotMatch(failures[0], /Revert this run/);
});

test('pre-existing invented evidence is reported as pre-existing, with advice that can be followed', () => {
  const before = { ...restingSnapshot, inventedEvidencePreRun: 1 };
  const after = { ...restingSnapshot, inventedEvidencePreRun: 1 };
  const { failures } = diffSnapshots(before, after, { applied: true });
  const failure = failures.find((f) => /PRE-EXISTING INVENTED EVIDENCE/.test(f));
  assert.ok(failure);
  // The old text said "Investigate before running" — printed after the run had
  // already written. It now says what is actually true and actionable.
  assert.match(failure, /this run did not write them/);
  assert.match(failure, /--apply is refused while it is true/);
  assert.doesNotMatch(failure, /before running/);
});

test('a request that left without an answer is treated as a write that may have landed', () => {
  // A dropped connection or a timeout mid-batch must not be reported as "this
  // run wrote nothing". The notes may exist; the operator needs the AFTER
  // counts, the guards and above all the revert — at exactly the moment the
  // script previously threw a stack trace and skipped all three.
  const source = read('scripts/backfill-counter-sale-delivery-notes.mjs');
  assert.match(source, /let attemptedWrite = false;/);
  assert.match(source, /attemptedWrite = true;\s*\n\s*try \{/, 'the flag is set BEFORE the request, not after it succeeds');
  assert.match(source, /applied: attemptedWrite,/, 'verification runs as if the write landed');
  assert.match(source, /if \(attemptedWrite\) \{\n\s*console\.log\('REVERT/, 'the revert is printed for an unanswered write too');
  // And the run must not sign off as OK when it did not finish.
  assert.match(source, /if \(batchFailed\) \{/);
  assert.match(source, /INCOMPLETE — a batch failed/);
});

test('the script refuses --apply on pre-existing damage, in preflight rather than after the fact', () => {
  const source = read('scripts/backfill-counter-sale-delivery-notes.mjs');
  const preflight = source.slice(source.indexOf("console.log('PREFLIGHT')"), source.indexOf("console.log('BEFORE')"));
  assert.match(preflight, /before\.noteStockMovements > 0/);
  assert.match(preflight, /before\.inventedEvidencePreRun > 0/);
  assert.match(preflight, /refusing to add to it/);
});

test('the invented-evidence guard checks all four fields a counter sale must never carry', () => {
  const { guardInventedEvidence } = buildSnapshotQueries();
  for (const field of ['driverName', 'vehicleNumber', 'deliveryAddress', 'receivedByPhone']) {
    assert.match(guardInventedEvidence.sql, new RegExp(`"${field}" IS NOT NULL`));
  }
});

test('counter notes vanishing fails the run — the backfill only ever adds', () => {
  const before = { ...restingSnapshot, preRunCounterNotesLive: 19, preRunCounterNotes: 19 };
  const after = { ...restingSnapshot, preRunCounterNotesLive: 12, preRunCounterNotes: 19, populationPreRun: 0 };
  const { failures } = diffSnapshots(before, after, { applied: true });
  assert.ok(failures.some((f) => /NOTES DISAPPEARED: 7 counter-sale note/.test(f)));
});

// ───────────────────────────────────────────────────────────────────────────
// RE-RUNNABLE AND INTERRUPTIBLE
// ───────────────────────────────────────────────────────────────────────────

test('a second run over an already-backfilled population is a clean no-op', () => {
  const settled = {
    ...restingSnapshot,
    population: 0,
    populationPreRun: 0,
    counterNotesLive: 19,
    preRunCounterNotes: 19,
    preRunCounterNotesLive: 19,
    counterNotesByStatus: { DELIVERED: 19 },
  };
  const { failures, warnings } = diffSnapshots(settled, settled, {
    applied: true,
    reported: { batches: 1, scanned: 0, created: 0, resumed: 0, skipped: 0, failed: 0 },
  });
  assert.deepEqual(failures, []);
  assert.deepEqual(warnings, []);
});

test('an interrupted run leaves a resumable remainder, reported as a warning not a failure', () => {
  const before = { ...restingSnapshot, population: 900, populationPreRun: 900 };
  const after = { ...restingSnapshot, population: 400, populationPreRun: 400, counterNotesLive: 500 };
  const { failures, warnings } = diffSnapshots(before, after, {
    applied: true,
    reported: { batches: 1, scanned: 500, created: 500, resumed: 0, skipped: 0, failed: 0 },
  });
  assert.deepEqual(failures, []);
  assert.ok(warnings.some((w) => /400 order\(s\).*still outstanding/s.test(w)));
  assert.ok(warnings.some((w) => /re-run the same command to continue/.test(w)));
});

test('a run that made no progress does NOT tell the operator to re-run forever', () => {
  // The endpoint is company-scoped; this SQL is not. Without --company-id on a
  // multi-tenant database the remainder can be orders the token will never
  // reach, and "re-run to continue" is an instruction that cannot be followed.
  const before = { ...restingSnapshot, population: 60, populationPreRun: 60 };
  const after = { ...restingSnapshot, population: 41, populationPreRun: 41 };
  const { warnings } = diffSnapshots(before, after, {
    applied: true,
    reported: { batches: 2, scanned: 41, created: 0, resumed: 0, skipped: 41, failed: 0 },
  });
  const warning = warnings.find((w) => /41 order\(s\)/.test(w));
  assert.ok(warning);
  assert.match(warning, /re-running the same command will not clear them/);
  assert.match(warning, /--company-id/);
});

test('a note stranded mid-chain is reported as healable, not as a failure', () => {
  const before = { ...restingSnapshot };
  const after = {
    ...restingSnapshot,
    population: 0,
    populationPreRun: 0,
    counterNotesLive: 19,
    counterNotesLiveNotDelivered: 1,
    counterNotesByStatus: { DELIVERED: 18, DISPATCHED: 1 },
  };
  const { failures, warnings } = diffSnapshots(before, after, {
    applied: true,
    reported: { batches: 1, scanned: 19, created: 19, resumed: 0, skipped: 0, failed: 0 },
  });
  assert.deepEqual(failures, []);
  const stranded = warnings.find((w) => /stranded/.test(w));
  assert.ok(stranded);
  // And it does NOT promise a re-run will heal it. The endpoint's selection
  // filter excludes any order that already carries a counter note — the same
  // filter this script's population uses — so a stranded note is invisible to
  // every later run. Telling the operator to "re-run to heal them" would be an
  // instruction that quietly does nothing, forever.
  assert.match(stranded, /RE-RUNNING WILL NOT HEAL THEM/);
});

test('the script and the endpoint exclude an already-noted order by the same rule', () => {
  // If these two drifted, the script would count work the endpoint will not do
  // and then report the difference as an unfinished run, forever.
  const service = read('backend/src/modules/mobile-pos-lite/mobile-pos-lite.service.ts');
  assert.match(service, /deliveryNotes: \{ none: \{ counterSaleOrderId: \{ not: null \} \} \}/);
  assert.match(POPULATION_WHERE, /NOT EXISTS/);
  assert.match(POPULATION_WHERE, /dn\."counterSaleOrderId" = so\."id"/);
});

test('counter-note counts separate live rows from reverted (soft-deleted) ones', () => {
  const summary = summariseCounterNotes([
    { status: 'DELIVERED', live: true, count: '17' },
    { status: 'DISPATCHED', live: true, count: '1' },
    { status: 'DELIVERED', live: false, count: '4' },
  ]);
  assert.equal(summary.live, 18);
  assert.equal(summary.liveNotDelivered, 1);
  assert.equal(summary.deleted, 4);
  assert.deepEqual(summary.byStatus, { DELIVERED: 17, DISPATCHED: 1 });
});

test('the note census keeps what predates the run apart from what the shop did during it', () => {
  const census = summariseNoteCensus([
    { desk: true, live: true, preRun: true, count: '7' }, // office, before the run
    { desk: true, live: false, preRun: true, count: '2' }, // office, already deleted
    { desk: false, live: true, preRun: true, count: '19' }, // counter notes already there
    { desk: false, live: true, preRun: false, count: '3' }, // the counter, selling right now
    { desk: true, live: true, preRun: false, count: '1' }, // a clerk, working right now
  ]);
  assert.equal(census.preRunDeskLive, 7);
  assert.equal(census.preRunCounter, 19);
  assert.equal(census.preRunCounterLive, 19);
  // The two buckets no guard is allowed to read.
  assert.equal(census.counterSinceRunStart, 3);
  assert.equal(census.deskSinceRunStart, 1);
});

test('the census tolerates booleans that survived a JSON hop as strings', () => {
  // The docker runner serialises the rows through JSON before this sees them.
  const census = summariseNoteCensus([{ desk: 'false', live: 'true', preRun: 'true', count: '4' }]);
  assert.equal(census.preRunCounterLive, 4);
  assert.equal(summariseInventedEvidence([{ preRun: 'false', count: '2' }]).sinceRunStart, 2);
});

// ───────────────────────────────────────────────────────────────────────────
// REVERSIBLE
// ───────────────────────────────────────────────────────────────────────────

test('the revert is a run-scoped soft delete and nothing else', () => {
  const sql = buildRevertSql(new Date('2026-08-15T18:30:00.000Z'));
  assert.match(sql, /UPDATE "delivery_notes"/);
  assert.match(sql, /SET "deletedAt" = now\(\)/);
  assert.match(sql, /"counterSaleOrderId" IS NOT NULL/);
  assert.match(sql, /"createdAt" >= '2026-08-15T18:30:00\.000Z'/);
  // Never a hard delete, and never anything to do with stock.
  assert.doesNotMatch(sql, /DELETE\s+FROM/i);
  assert.doesNotMatch(sql, /inventory_movements/);
  assert.doesNotMatch(sql, /journal/i);
});

test('the revert does not take the live counter path down with it', () => {
  // A revert bounded only by time catches every counter-sale note created since
  // the run started — including the ones the counter itself wrote while the
  // backfill ran. Those are real collections; un-delivering them would be this
  // script damaging the very sales it exists to record. The backfill marker is
  // in the statement itself, not in a footnote for the operator to remember.
  const sql = buildRevertSql(new Date('2026-08-15T18:30:00.000Z'));
  const statement = sql.slice(sql.indexOf('UPDATE "delivery_notes"')).split(';')[0];
  assert.match(statement, /"notes" LIKE '%Recorded by backfill on%'/);
  assert.match(statement, /"createdAt" >= '2026-08-15T18:30:00\.000Z'/);
});

test('the revert ships with its own undo, and says why a re-run will not recreate the notes', () => {
  const sql = buildRevertSql(new Date('2026-08-15T18:30:00.000Z'));
  assert.match(sql, /UNDO THE REVERT/);
  assert.match(sql, /SET "deletedAt" = NULL/);
  assert.match(sql, /will NOT recreate/);
});

test('backfilled notes stay identifiable as backfilled', () => {
  const sql = buildRevertSql(new Date());
  assert.match(sql, /Recorded by backfill on/);
});

test('the NOT EXISTS guard deliberately ignores deletedAt, so a reverted order is not re-noted', () => {
  // If this filter grew a `dn."deletedAt" IS NULL`, a reverted note would look
  // absent to the query but still own its unique key — every run would then
  // scan it, attempt it, and fail on the index. Keep them consistent.
  assert.doesNotMatch(POPULATION_WHERE, /dn\."deletedAt"/);
});
