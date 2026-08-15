#!/usr/bin/env node
/**
 * BACKFILL — counter-sale delivery notes for historical Mobile POS Lite sales.
 *
 * Implements the operator half of `docs/pos-reform/spec-counter-delivery.md` §4.
 * The spec decided: **yes, backfill** — and decided it is driven through the
 * manager-authorised endpoint `POST /mobile-pos-lite/counter-delivery-backfill`,
 * NOT through a SQL migration and NOT through raw writes. This script therefore
 * never writes a `delivery_notes` row itself. It:
 *
 *   1. refuses to run at all unless the database-level idempotency guarantee is
 *      already in place (§4.3 layer three), unless DeliveryNotesService is still
 *      free of any inventory effect (§0), and — for --apply — unless the office's
 *      delivery worklists already exclude counter notes (§5.2),
 *   2. computes the affected population independently, in read-only SQL, so the
 *      operator can see exactly what would change BEFORE anything changes,
 *   3. drives the endpoint in capped batches when — and only when — explicitly
 *      told to (`--apply --confirm`),
 *   4. re-runs the same snapshot afterwards and FAILS LOUDLY if stock moved,
 *      if invented delivery evidence appeared, or if any note that already
 *      existed when the run started was re-keyed or deleted,
 *   5. prints a run-scoped, copy-pasteable revert.
 *
 * ---------------------------------------------------------------------------
 * THE POPULATION THIS SCRIPT CLAIMS, AND WHY THE CLAIM IS TRUE
 * ---------------------------------------------------------------------------
 * It claims: *these sales orders record goods that physically left a counter in
 * the customer's hands, and no delivery note has ever been issued for them.*
 *
 *   so."mobilePosTerminalId" IS NOT NULL
 *       The ONLY qualifier for POS origin, and the only one that is
 *       server-derived. The terminal id is stamped by the server from the
 *       activated terminal session; a rep cannot type it, and it cannot be
 *       forged from a request body. A notes marker could be typed by a human,
 *       and a CASH payment method or a "counter" sales type can equally belong
 *       to a desktop order — neither is proof. This column is.
 *
 *   so."status" IN ('CONFIRMED','PARTIALLY_PAID','PAID')
 *       `SalesOrdersService.confirm()` IS the counter event: it is what issues
 *       the SALE_ISSUE inventory movements and takes the payment, and on the
 *       POS path it runs at the instant the customer pays and walks out. So a
 *       row in one of these states is a row whose stock has already left.
 *       DRAFT never charged anybody and never moved goods. CANCELLED/VOIDED
 *       means the counter reversed it. Neither gets a note, ever.
 *       CREDIT counter sales ARE included: the goods still walked out, only the
 *       money is owed, and those are precisely the orders where fulfillment
 *       tracking matters most.
 *
 *   so."deletedAt" IS NULL AND the order has at least one line
 *       A soft-deleted or empty order describes no goods.
 *
 *   NOT EXISTS (delivery_notes dn WHERE dn."counterSaleOrderId" = so."id"
 *                                   AND dn."companyId" = so."companyId")
 *       Never touch an order that already carries an auto-issued note. This
 *       mirrors the endpoint's own selection filter exactly
 *       (`deliveryNotes: { none: { counterSaleOrderId: { not: null } } }`), so
 *       the count here is the work the endpoint would actually do.
 *       CONSEQUENCE WORTH KNOWING: an order whose note is stranded at DRAFT or
 *       DISPATCHED by a mid-chain failure is excluded by that same filter — on
 *       both sides. `recordCounterDelivery` can resume such a note, but the
 *       backfill never selects the order, so a further run does NOT heal it.
 *       The run reports stranded notes rather than promising to fix them.
 *       Deliberately NOT filtered on dn."deletedAt": a soft-deleted counter
 *       note still owns its key and still means "this order was already
 *       backfilled once" (see REVERT).
 *
 * NOTHING IS INVENTED. The endpoint writes deliveryDate = the order's own
 * orderDate, deliveredById = the order's createdById (the rep who actually rang
 * it), receivedByName = the order's own customerName snapshot, and leaves
 * driverName, vehicleNumber, deliveryAddress and receivedByPhone NULL — there
 * was no driver, no vehicle, no address and no phone, and writing one would be
 * forging delivery evidence. This script ASSERTS that afterwards (see
 * `diffSnapshots`) and fails the run if any of those four is ever populated.
 *
 * ---------------------------------------------------------------------------
 * THE GUARDS, AND WHAT EACH ONE CAN ACTUALLY PROVE
 * ---------------------------------------------------------------------------
 * Every guard below is SCOPED to the population this run can touch, and the
 * scope is fixed at the run's own start timestamp. That is deliberate, and it
 * is the difference between a guard and an alarm bell.
 *
 * An earlier version of this script counted whole tables — every SALE_ISSUE
 * movement in the company, every live delivery note. On a trading shop those
 * counters move because a customer in the next room bought something, and the
 * script answered with its loudest possible line: "STOCK MOVED … STOP and
 * investigate before selling again", exit 1, from a DRY RUN that had written
 * nothing. **A false alarm that says stop selling is worse than no alarm** — it
 * is believed exactly once, and ignored every time after that, including the
 * one time it is real. So each guard now counts only rows that this run could
 * plausibly be responsible for:
 *
 *   guardNoteStock          movements of ANY type written against a counter-sale
 *                           delivery note. MUST BE 0, before and after, always.
 *                           Absolute, not a delta — nothing sold at the counter
 *                           meanwhile can enter this count, because a sale's
 *                           movements reference the SalesOrder, never a note.
 *                           This is the direct statement of the one rule that
 *                           makes the whole change safe.
 *   guardPosOrderStock      SALE_ISSUE count + quantity for POS orders that
 *                           ALREADY EXISTED when this run started. MUST NOT
 *                           MOVE. A sale rung during the run belongs to an
 *                           order created during the run, so it is outside the
 *                           scope and cannot move this number.
 *   notesCensus             delivery notes split by (desk vs counter) × (live vs
 *                           deleted) × (existed at run start vs created since).
 *                           The guards read only the "existed at run start"
 *                           buckets: a note that predates the run must not gain
 *                           a counterSaleOrderId (re-keying) and a counter note
 *                           that was live must not vanish. Notes created WHILE
 *                           the run went on are the live counter path selling,
 *                           and are reported as an observation, never an alarm.
 *   guardInventedEvidence   counter notes carrying a driver, vehicle, address or
 *                           phone, split the same way. Pre-existing ones refuse
 *                           --apply in PREFLIGHT, where the operator can still
 *                           act on the advice; new ones fail the run.
 *
 * WHAT THE GUARDS STILL CANNOT PROVE, stated here rather than papered over:
 *
 *   - Postgres stamps `createdAt` at TRANSACTION START. A sale whose own
 *     transaction opened a moment before this run began and committed while it
 *     ran lands inside the "already existed" scope. That is a window of one
 *     sale transaction, not the whole run, and when guardPosOrderStock fires it
 *     names this as the first thing to rule out.
 *   - A desk-created note going away mid-run is reported as a WARNING, not a
 *     failure. Neither this script nor the endpoint has any path that deletes or
 *     edits a desk note, so the cause is almost certainly an office user — but
 *     nothing here can prove that either way, and the output says so.
 *   - The DRY RUN issues no write request of any kind. It therefore cannot
 *     claim, and no longer claims, anything about rows created while it ran.
 *   - The source-level preflights (stock effects, worklist filters) read THIS
 *     CHECKOUT, not the server at --api-url. They are stated that way.
 *
 * ---------------------------------------------------------------------------
 * RE-RUNNABLE, INTERRUPTIBLE
 * ---------------------------------------------------------------------------
 * Three independent layers, the last of which is the database:
 *   1. the NOT EXISTS filter above excludes anything already noted;
 *   2. the endpoint's own findFirst pre-check excludes it again;
 *   3. `delivery_notes_companyId_counterSaleOrderId_key` (migration
 *      20260815120000_delivery_note_counter_sale_key) rejects a second note at
 *      the database if both reads lose a race.
 * Layer 3 is the decider. A read-then-write existence check CANNOT decide a
 * create race — Postgres stamps createdAt at transaction start, so two racers
 * can each read a set in which they won; migration 20260813120000 exists
 * because that exact bug received one lorry twice. This script REFUSES TO
 * APPLY ANYTHING unless it can see that unique index in the live catalog.
 *
 * Because the guarantee is in the database and each batch is its own request,
 * the run is safe to kill at any moment: Ctrl-C between batches, a dropped
 * connection, a container restart mid-batch — re-run the exact same command and
 * it resumes with the orders that are still outstanding. A second complete run
 * reports `created: 0`.
 *
 * ---------------------------------------------------------------------------
 * REVERSIBLE
 * ---------------------------------------------------------------------------
 * Every note produced by this path is identifiable two ways: it carries a
 * non-NULL `counterSaleOrderId`, and a backfilled one says so in `notes`
 * ("Recorded by backfill on <date>"). The revert this script prints uses BOTH —
 * the run's start timestamp and that marker — so it undoes this run and nothing
 * else. The timestamp alone is not enough on a shop that is trading: the live
 * counter path is writing its own notes at the same time, and a revert bounded
 * only by time would soft-delete real collections along with the backfill.
 * See `buildRevertSql()` and the REVERT block it prints.
 *
 * ---------------------------------------------------------------------------
 * USAGE — dry run first, always
 * ---------------------------------------------------------------------------
 *   # 1. DRY RUN (default; issues no write request of any kind)
 *   node scripts/backfill-counter-sale-delivery-notes.mjs \
 *        --env-file .env.production --backend-container itemba_r_backend
 *
 *   # 2. same, narrowed to one company, showing every affected order
 *   node scripts/backfill-counter-sale-delivery-notes.mjs \
 *        --company-id <uuid> --list 500
 *
 *   # 3. APPLY (requires BOTH flags; anything less is a dry run)
 *   ITEMBA_API_TOKEN=<manager token> \
 *   node scripts/backfill-counter-sale-delivery-notes.mjs --apply --confirm
 *
 *   # 4. verify only, after the fact
 *   node scripts/backfill-counter-sale-delivery-notes.mjs --verify-only
 *
 * On a multi-company database, pass --company-id. Without it the SQL here counts
 * and lists EVERY company on the database, while the endpoint only ever
 * processes the companies the manager's token can reach — so the two disagree
 * and a finished run reads as an unfinished one. The script says so when it
 * sees more than one company in the population.
 *
 * The token must belong to a user holding `mobile_pos_lite.manage`; the script
 * proves that in preflight with a read-only call before it writes anything. It
 * never accepts, prompts for, or transmits a password.
 *
 * Exit codes: 0 the run finished and every guard passed · 1 the run did not
 * finish cleanly — either a guard failed or a batch did (see the FAILED lines;
 * a failed batch is INCOMPLETE, not damage) · 2 refused before writing anything
 * (missing guarantee, missing token, API unreachable, endpoint not deployed,
 * pre-existing damage the operator must look at first).
 *
 * TRADING HOURS. The Kaunta pilot trades live, so this matters:
 *   - `--verify-only` and the default DRY RUN are safe to run mid-trade. They
 *     write nothing, every guard is scoped to rows that existed before the run
 *     started, and ordinary selling can no longer raise an alarm. Reads are two
 *     aggregate passes over four tables.
 *   - `--apply` should still be run OUTSIDE trading hours, and on a restored
 *     copy of production on staging first. Not because a guard would misfire,
 *     but because it drives up to `--max-batches × 500` document-writing
 *     requests through the same chain the counter uses, and a counter that is
 *     queuing behind a backfill is a counter with a queue in front of it.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Contract with the rest of the change ────────────────────────────────────

/** The manager-authorised endpoint from spec §4.1. Overridable with --endpoint. */
export const DEFAULT_ENDPOINT = '/mobile-pos-lite/counter-delivery-backfill';

/**
 * Read-only probe used to prove the token carries `mobile_pos_lite.manage`
 * before anything is written. Same permission the backfill route requires.
 */
export const PERMISSION_PROBE_ENDPOINT = '/mobile-pos-lite/terminals';

/** The database-level idempotency guarantee. No index, no apply. */
export const REQUIRED_UNIQUE_INDEX = 'delivery_notes_companyId_counterSaleOrderId_key';
export const REQUIRED_COLUMN = { table: 'delivery_notes', column: 'counterSaleOrderId' };

/** Per-request cap in the endpoint (spec §4.2 `take: 500`). */
export const BATCH_SIZE = 500;

/**
 * Source-level guard for the one risk that would make this whole change
 * dangerous. `DeliveryNotesService` must have NO inventory effects — the sale
 * already issued the SALE_ISSUE movements, and a delivery note that also
 * touched stock would decrement it twice, mid-trade, unrecoverably.
 * Asserted here AND in backfill-counter-sale-delivery-notes.test.mjs.
 */
export const DELIVERY_NOTES_SERVICE_PATH =
  'backend/src/modules/delivery-notes/delivery-notes.service.ts';
export const STOCK_EFFECT_PATTERNS = [
  /inventoryMovement/,
  /inventoryBalance/,
  /productBatch/,
  /stockLedger/,
];

/**
 * The office's delivery worklists. A counter sale is a collection, not a
 * dispatch, so every aggregate/list query over delivery notes in these services
 * must carry `counterSaleOrderId: null`. Without that, backfilling N counter
 * notes drops N phantom deliveries onto the office's screens — the "recent
 * deliveries" panel and the "open notes missing driver/vehicle" data-quality
 * worklist are the two that bite hardest, because a counter note has no driver
 * and no vehicle by design.
 *
 * Queries that reach ONE note by id (findUnique/findOne) are deliberately not
 * checked: a counter note must stay visible where the order is the subject.
 */
export const WORKLIST_SERVICE_PATHS = [
  'backend/src/modules/westsides-dashboard/westsides-dashboard.service.ts',
  'backend/src/modules/westsides-reports/westsides-reports.service.ts',
];
const WORKLIST_QUERY_METHODS = ['groupBy', 'count', 'findMany', 'aggregate'];

// ── Population, expressed once so the count and the list cannot drift ────────

/**
 * The WHERE body of spec §4.2, verbatim. `so` is the sales_orders alias.
 * Exported so the test can assert every qualifier is present and that no
 * qualifier this script does not claim has crept in.
 */
export const POPULATION_WHERE = `
      so."mobilePosTerminalId" IS NOT NULL
  AND so."status" IN ('CONFIRMED','PARTIALLY_PAID','PAID')
  AND so."deletedAt" IS NULL
  AND EXISTS (SELECT 1 FROM "sales_order_lines" sol WHERE sol."salesOrderId" = so."id")
  AND NOT EXISTS (
        SELECT 1 FROM "delivery_notes" dn
         WHERE dn."counterSaleOrderId" = so."id"
           AND dn."companyId" = so."companyId")`;

/**
 * Build the population queries. `companyId` is bound as a positional parameter,
 * never interpolated — the value arrives from the command line.
 */
export function buildPopulationQuery({ companyId = null, limit = null } = {}) {
  const params = [];
  let where = POPULATION_WHERE;
  if (companyId) {
    params.push(companyId);
    where += `\n  AND so."companyId" = $${params.length}`;
  }

  const countSql = `SELECT count(*)::bigint AS "count" FROM "sales_orders" so WHERE ${where}`;

  let listSql = `
    SELECT so."id",
           so."salesOrderNumber",
           so."companyId",
           so."status"::text        AS "status",
           so."orderDate",
           t."terminalCode",
           (SELECT count(*)::int FROM "sales_order_lines" sol
             WHERE sol."salesOrderId" = so."id") AS "lineCount"
      FROM "sales_orders" so
      LEFT JOIN "mobile_pos_terminals" t ON t."id" = so."mobilePosTerminalId"
     WHERE ${where}
     ORDER BY so."orderDate" ASC, so."id" ASC`;
  if (limit !== null) {
    params.push(Number(limit));
    listSql += `\n     LIMIT $${params.length}`;
  }

  return { countSql, listSql, params };
}

/**
 * The before/after snapshot. Every entry is read-only, and every entry that a
 * guard reads is SCOPED — see the header, "THE GUARDS, AND WHAT EACH ONE CAN
 * ACTUALLY PROVE". The scope is fixed once, at `runStartedAt`, and the SAME
 * queries are used for the BEFORE and the AFTER pass, so the two are comparing
 * identical populations rather than two different snapshots of a moving shop.
 *
 * Nothing here counts a whole table. A counter that a customer in the next room
 * can move is not evidence about this run.
 */
export function buildSnapshotQueries({ companyId = null, runStartedAt = new Date() } = {}) {
  const since = new Date(runStartedAt).toISOString();

  // Each query owns its parameter list; `bind` returns the positional marker so
  // no caller-supplied value is ever interpolated into SQL.
  const query = (build) => {
    const params = [];
    const bind = (value) => {
      params.push(value);
      return `$${params.length}`;
    };
    return { sql: build(bind), params };
  };
  const company = (bind, alias) => (companyId ? ` AND ${alias}."companyId" = ${bind(companyId)}` : '');

  return {
    // Layer 1 of the schema guarantee — its absence blocks --apply.
    guarantee: {
      sql: `
        SELECT
          (SELECT count(*)::int FROM information_schema.columns
            WHERE table_name = '${REQUIRED_COLUMN.table}'
              AND column_name = '${REQUIRED_COLUMN.column}')            AS "columnPresent",
          (SELECT count(*)::int FROM pg_indexes
            WHERE tablename = '${REQUIRED_COLUMN.table}'
              AND indexname = '${REQUIRED_UNIQUE_INDEX}')               AS "indexPresent"`,
      params: [],
    },

    // The orders still reading "Delivered: PENDING" for want of a note.
    //   count    — everything outstanding, the operator's working figure.
    //   preRun   — the ones that already existed when this run started. THAT is
    //              the work this run was asked to do, and the only figure from
    //              which "cleared" and "still outstanding" can honestly be
    //              computed on a shop that is still selling.
    //   companies— how many tenants those orders span. More than one, with no
    //              --company-id, means this SQL is wider than the endpoint.
    population: query(
      (bind) => `
        SELECT count(*)::bigint                                              AS "count",
               count(DISTINCT so."companyId")::int                           AS "companies",
               count(*) FILTER (WHERE so."createdAt" < ${bind(since)}::timestamp)::bigint AS "preRun"
          FROM "sales_orders" so
         WHERE ${POPULATION_WHERE}${company(bind, 'so')}`,
    ),

    // Auto-issued notes, live and by state. Display only — no guard reads this,
    // because on a trading shop the live counter path moves it every few minutes.
    counterNotes: query(
      (bind) => `
        SELECT dn."status"::text AS "status",
               (dn."deletedAt" IS NULL) AS "live",
               count(*)::bigint AS "count"
          FROM "delivery_notes" dn
         WHERE dn."counterSaleOrderId" IS NOT NULL${company(bind, 'dn')}
         GROUP BY 1, 2
         ORDER BY 1, 2`,
    ),

    // Every delivery note, cut three ways: desk vs counter, live vs soft-deleted,
    // and — the axis that makes the guards true — existed at run start vs created
    // since. The guards read only the "existed at run start" buckets:
    //   · a note that predates the run must not GAIN a counterSaleOrderId
    //     (the backfill creates notes; it must never adopt one), and
    //   · a counter note that was live must not vanish.
    // Both are immune to concurrent trading: a sale rung mid-run creates a row
    // in the "since" buckets, which no guard reads.
    notesCensus: query(
      (bind) => `
        SELECT (dn."counterSaleOrderId" IS NULL) AS "desk",
               (dn."deletedAt" IS NULL)          AS "live",
               (dn."createdAt" < ${bind(since)}::timestamp) AS "preRun",
               count(*)::bigint AS "count"
          FROM "delivery_notes" dn
         WHERE TRUE${company(bind, 'dn')}
         GROUP BY 1, 2, 3`,
    ),

    // MUST stay 0. Any non-zero value is forged delivery evidence. Split by
    // run start so a pre-existing one is refused in PREFLIGHT — where the
    // advice "investigate before running" can still be acted on — and a new one
    // fails the run it actually belongs to.
    guardInventedEvidence: query(
      (bind) => `
        SELECT (dn."createdAt" < ${bind(since)}::timestamp) AS "preRun",
               count(*)::bigint AS "count"
          FROM "delivery_notes" dn
         WHERE dn."counterSaleOrderId" IS NOT NULL${company(bind, 'dn')}
           AND (dn."driverName" IS NOT NULL
             OR dn."vehicleNumber" IS NOT NULL
             OR dn."deliveryAddress" IS NOT NULL
             OR dn."receivedByPhone" IS NOT NULL)
         GROUP BY 1`,
    ),

    // THE rule, stated directly and absolutely: MUST BE 0.
    // An inventory movement of ANY type whose reference is a counter-sale
    // delivery note. A sale's own SALE_ISSUE movements reference the SalesOrder
    // (sales-orders.service.ts: referenceType 'SalesOrder'), never a note, so
    // ordinary trading cannot put a single row in here. Not a delta — a delta
    // would still pass a database that already had this wrong.
    guardNoteStock: query(
      (bind) => `
        SELECT count(*)::bigint AS "count"
          FROM "inventory_movements" im
         WHERE im."referenceId" IS NOT NULL${company(bind, 'im')}
           AND EXISTS (
                 SELECT 1 FROM "delivery_notes" dn
                  WHERE dn."id" = im."referenceId"
                    AND dn."counterSaleOrderId" IS NOT NULL)`,
    ),

    // MUST NOT MOVE — and now it can only be moved by the run.
    // SALE_ISSUE movements belonging to POS-originated orders that ALREADY
    // EXISTED when this run started. `mobilePosTerminalId` and `createdAt` are
    // both immutable after creation, so this scope is the same set in the
    // BEFORE and AFTER passes; a counter sale rung while the script runs belongs
    // to an order created after the cutoff and is invisible to it.
    // `sinceRunStart` is the diagnostic that tells the operator whether a change
    // is a fresh insert or a mutation of history.
    guardPosOrderStock: query((bind) => {
      const cutoff = `${bind(since)}::timestamp`;
      return `
        SELECT count(*)::bigint                                              AS "movements",
               COALESCE(sum(im."quantity"), 0)::text                         AS "quantity",
               count(*) FILTER (WHERE im."createdAt" >= ${cutoff})::bigint   AS "sinceRunStart"
          FROM "inventory_movements" im
         WHERE im."movementType" = 'SALE_ISSUE'
           AND im."referenceType" = 'SalesOrder'
           AND im."referenceId" IS NOT NULL${company(bind, 'im')}
           AND EXISTS (
                 SELECT 1 FROM "sales_orders" so
                  WHERE so."id" = im."referenceId"
                    AND so."mobilePosTerminalId" IS NOT NULL
                    AND so."createdAt" < ${cutoff})`;
    }),
  };
}

// ── Snapshot arithmetic (pure — this is what the test drives) ────────────────

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}

/** Postgres booleans arrive as booleans, but survive a JSON hop as strings. */
const isTrue = (value) => value === true || value === 'true' || value === 't';

/** Total live auto-issued notes, and how many of them are not yet DELIVERED. */
export function summariseCounterNotes(rows = []) {
  let live = 0;
  let liveNotDelivered = 0;
  let deleted = 0;
  const byStatus = {};
  for (const row of rows) {
    const count = toNumber(row.count);
    const status = String(row.status);
    if (isTrue(row.live)) {
      live += count;
      byStatus[status] = (byStatus[status] ?? 0) + count;
      if (status !== 'DELIVERED') liveNotDelivered += count;
    } else {
      deleted += count;
    }
  }
  return { live, liveNotDelivered, deleted, byStatus };
}

/**
 * Split the delivery-note census into the buckets the guards read (everything
 * `preRun*`, which this run's own start timestamp freezes) and the buckets they
 * deliberately do not (everything `*SinceRunStart`, which is the shop trading).
 */
export function summariseNoteCensus(rows = []) {
  const out = {
    preRunCounter: 0,
    preRunCounterLive: 0,
    preRunDesk: 0,
    preRunDeskLive: 0,
    counterSinceRunStart: 0,
    deskSinceRunStart: 0,
  };
  for (const row of rows) {
    const count = toNumber(row.count);
    const desk = isTrue(row.desk);
    const live = isTrue(row.live);
    if (isTrue(row.preRun)) {
      if (desk) {
        out.preRunDesk += count;
        if (live) out.preRunDeskLive += count;
      } else {
        out.preRunCounter += count;
        if (live) out.preRunCounterLive += count;
      }
    } else if (desk) {
      out.deskSinceRunStart += count;
    } else {
      out.counterSinceRunStart += count;
    }
  }
  return out;
}

/** Invented-evidence counts, split at the run's start for the same reason. */
export function summariseInventedEvidence(rows = []) {
  let preRun = 0;
  let sinceRunStart = 0;
  for (const row of rows) {
    if (isTrue(row.preRun)) preRun += toNumber(row.count);
    else sinceRunStart += toNumber(row.count);
  }
  return { preRun, sinceRunStart };
}

/** Flatten a raw snapshot into the scalars the diff reasons about. */
export function readSnapshot(raw) {
  const notes = summariseCounterNotes(raw.counterNotes ?? []);
  const census = summariseNoteCensus(raw.notesCensus ?? []);
  const invented = summariseInventedEvidence(raw.guardInventedEvidence ?? []);
  const population = raw.population?.[0] ?? {};
  const posStock = raw.guardPosOrderStock?.[0] ?? {};
  return {
    // Operational figures — unscoped on purpose, and no guard reads them.
    population: toNumber(population.count),
    populationCompanies: toNumber(population.companies),
    counterNotesLive: notes.live,
    counterNotesLiveNotDelivered: notes.liveNotDelivered,
    counterNotesDeleted: notes.deleted,
    counterNotesByStatus: notes.byStatus,

    // Scoped figures — the ones the guards are allowed to reason about.
    populationPreRun: toNumber(population.preRun),
    preRunCounterNotes: census.preRunCounter,
    preRunCounterNotesLive: census.preRunCounterLive,
    preRunDeskNotesLive: census.preRunDeskLive,
    counterNotesSinceRunStart: census.counterSinceRunStart,
    inventedEvidencePreRun: invented.preRun,
    inventedEvidenceSinceRunStart: invented.sinceRunStart,
    noteStockMovements: toNumber(raw.guardNoteStock?.[0]?.count),
    posOrderSaleIssueMovements: toNumber(posStock.movements),
    // Kept as a string: Decimal(18,4) sums do not survive a float round-trip.
    posOrderSaleIssueQuantity: String(posStock.quantity ?? '0'),
    posOrderSaleIssueSinceRunStart: toNumber(posStock.sinceRunStart),
  };
}

/**
 * The verification of spec §4.3, as assertions. Returns
 * `{ failures, warnings, observations }`:
 *
 *   failures     — something happened that must never happen. Exit 1.
 *   warnings     — something worth an operator's eye that this run cannot
 *                  attribute to itself, and says so.
 *   observations — true statements about a shop that kept trading. Never an
 *                  alarm, because the run did not cause them.
 *
 * EVERY comparison below is between two readings of the SAME frozen population
 * — rows that existed when the run started. Ordinary trading creates rows
 * outside that population and therefore cannot produce a single line here.
 *
 * `applied` distinguishes a dry run — which issues no write request at all, and
 * so may not claim anything about rows created while it ran — from a real run.
 * `reported` is the endpoint's own batch report, the only honest source for
 * "what THIS run created".
 */
export function diffSnapshots(before, after, { applied = false, reported = null } = {}) {
  const failures = [];
  const warnings = [];
  const observations = [];

  // ── NON-NEGOTIABLE: a delivery note has no inventory effect ───────────────
  // Absolute, and unscoped only because it needs no scope: a sale's SALE_ISSUE
  // movements reference the SalesOrder, never a note, so nothing sold at the
  // counter meanwhile can put a row into this count.
  if (after.noteStockMovements > 0) {
    const preExisting = before.noteStockMovements > 0;
    failures.push(
      `STOCK MOVED BY A DELIVERY NOTE: ${after.noteStockMovements} inventory movement(s) are recorded against a ` +
        `counter-sale delivery note` +
        (preExisting ? ` (${before.noteStockMovements} of them already before this run started)` : '') +
        '. The sale already issued its SALE_ISSUE movements; a note that also moves stock decrements it twice. ' +
        'This count contains only movements written against counter-sale notes, so trading cannot explain it. ' +
        'STOP and investigate before selling again.',
    );
  }

  // The same rule from the other side: the orders under repair must not have
  // issued any further stock. Scoped to POS orders that existed at run start.
  if (
    after.posOrderSaleIssueMovements !== before.posOrderSaleIssueMovements ||
    after.posOrderSaleIssueQuantity !== before.posOrderSaleIssueQuantity
  ) {
    failures.push(
      `STOCK MOVED FOR ORDERS UNDER REPAIR: SALE_ISSUE for POS orders that already existed when this run started ` +
        `changed ${before.posOrderSaleIssueMovements} movement(s) / ${before.posOrderSaleIssueQuantity} -> ` +
        `${after.posOrderSaleIssueMovements} / ${after.posOrderSaleIssueQuantity}` +
        (after.posOrderSaleIssueSinceRunStart > 0
          ? ` (${after.posOrderSaleIssueSinceRunStart} of those movements were written after the run started)`
          : ' (no movement in this scope was written after the run started, so history itself was edited)') +
        '. Orders created after the run started are excluded, so a sale rung at the counter meanwhile cannot ' +
        'explain this — UNLESS that sale\'s own transaction opened before the "started" timestamp above and ' +
        'committed while the run went on. Rule that one out first; if it does not explain the change, STOP and ' +
        'investigate before selling again.',
    );
  }

  // ── BLAST RADIUS: rows that already existed are not this run's to move ────
  // The backfill CREATES notes. It must never adopt one that already existed.
  if (after.preRunCounterNotes > before.preRunCounterNotes) {
    failures.push(
      `NOTE RE-KEYED: ${after.preRunCounterNotes - before.preRunCounterNotes} delivery note(s) that existed before ` +
        'this run started now carry a counterSaleOrderId. The backfill only ever creates a new note; adopting an ' +
        'existing one would silently re-label a real dispatch as a counter collection. Investigate before trusting ' +
        'any counter-sale note.',
    );
  }
  if (after.preRunCounterNotesLive < before.preRunCounterNotesLive) {
    failures.push(
      `NOTES DISAPPEARED: ${before.preRunCounterNotesLive - after.preRunCounterNotesLive} counter-sale note(s) that ` +
        'were live when this run started have been soft-deleted. The backfill only ever adds.',
    );
  }
  if (after.preRunDeskNotesLive < before.preRunDeskNotesLive) {
    // Deliberately a warning. Neither this script nor the endpoint has any path
    // that deletes or edits a desk note, so the cause is almost certainly a
    // person in the office — but nothing here can prove that, and pretending
    // otherwise is how a guard becomes noise.
    warnings.push(
      `${before.preRunDeskNotesLive - after.preRunDeskNotesLive} desk-created delivery note(s) that were live when ` +
        'this run started are no longer live. Neither this script nor the backfill endpoint has any code path that ' +
        'deletes or edits a desk note, so this is almost certainly an office user working while the run was in ' +
        'progress — confirm that with them. Nothing measured here can prove it either way.',
    );
  }

  // ── NEVER INVENT DELIVERY EVIDENCE ────────────────────────────────────────
  // Pre-existing damage is also refused in PREFLIGHT, before --apply writes
  // anything — which is the only place where "investigate first" is advice the
  // operator can still act on.
  if (before.inventedEvidencePreRun > 0) {
    failures.push(
      `PRE-EXISTING INVENTED EVIDENCE: ${before.inventedEvidencePreRun} counter-sale note(s) that predate this run ` +
        'carry a driver, vehicle, address or phone. A counter sale has none of those, and this run did not write ' +
        'them. Investigate those notes before backfilling anything further; --apply is refused while it is true.',
    );
  }
  if (after.inventedEvidenceSinceRunStart > 0) {
    failures.push(
      `INVENTED EVIDENCE: ${after.inventedEvidenceSinceRunStart} counter-sale note(s) created since this run ` +
        'started carry a driver, vehicle, address or phone. A counter sale has none of those. ' +
        (applied
          ? 'Revert this run with the SQL printed below, then investigate.'
          : 'This run issued no write request, so these came from the live counter path — investigate that.'),
    );
  }

  // ── PROGRESS ──────────────────────────────────────────────────────────────
  if (after.counterNotesLiveNotDelivered > 0) {
    warnings.push(
      `${after.counterNotesLiveNotDelivered} counter-sale note(s) are live but not DELIVERED (stranded mid-chain, ` +
        'from this path or the live one). They are excluded from every office worklist by design, so nothing is ' +
        'flooded — but RE-RUNNING WILL NOT HEAL THEM: the order already carries a counter note, so neither this ' +
        'script nor the endpoint selects it again. A stranded note is finished by the office on the note itself, ' +
        'or by a replay of that sale, which a historical order never does.',
    );
  }

  if (!applied) {
    // A dry run makes no POST. It cannot have created anything, so it does not
    // get to have an opinion about rows that appeared while it ran.
    if (after.counterNotesSinceRunStart > 0) {
      observations.push(
        `${after.counterNotesSinceRunStart} counter-sale note(s) were created while this ran. This run issued no ` +
          'write request of any kind — that is the live counter path recording sales as they happen.',
      );
    }
    if (after.population !== before.population) {
      observations.push(
        `Orders awaiting a counter-sale note moved ${before.population} -> ${after.population} while this ran. ` +
          'Expected on a shop that is still selling; nothing here was written.',
      );
    }
    return { failures, warnings, observations };
  }

  // An applied run. "What this run did" comes from the endpoint's own report;
  // the snapshot can only say what the whole database did meanwhile.
  const createdHere = reported ? toNumber(reported.created) + toNumber(reported.resumed) : null;
  if (createdHere !== null && after.counterNotesSinceRunStart > createdHere) {
    observations.push(
      `${after.counterNotesSinceRunStart} counter-sale note(s) appeared while this ran; the endpoint reports ${createdHere} ` +
        'of them. The remainder is the live counter path selling at the same time.',
    );
  }

  const outstanding = after.populationPreRun;
  if (outstanding > 0) {
    if (reported && toNumber(reported.batches) > 0 && createdHere === 0) {
      warnings.push(
        `${outstanding} order(s) from the population this run started with are still outstanding, and the last ` +
          'pass reported no progress at all — re-running the same command will not clear them. Likely: they belong ' +
          'to companies this token cannot reach (re-run with --company-id for one you can), or every attempt is ' +
          'failing, in which case the per-order reasons are in the batch lines above.',
      );
    } else {
      warnings.push(
        `${outstanding} order(s) from the population this run started with are still outstanding. This invocation ` +
          'is capped (--max-batches × the endpoint page size) — re-run the same command to continue.',
      );
    }
  }
  return { failures, warnings, observations };
}

// ── Revert ──────────────────────────────────────────────────────────────────

/**
 * The run-scoped revert. Soft delete only — exactly what
 * `DeliveryNotesService.remove()` does, and every read path filters
 * `deletedAt: null`, so the sales orders simply return to "Delivered: PENDING".
 *
 * NEVER hard-delete, and never touch inventory_movements: these notes wrote none.
 */
export function buildRevertSql(runStartedAt) {
  const since = new Date(runStartedAt).toISOString();
  return `-- REVERT this run only (soft delete; reversible again by the UNDO below).
--
-- TWO conditions make this run-scoped, and BOTH are load-bearing on a shop that
-- kept trading: the timestamp keeps it to this run, and the backfill marker
-- keeps it to notes THIS PATH wrote. The timestamp alone would also delete the
-- notes the live counter path issued while the backfill ran — real collections,
-- sent back to "Delivered: PENDING" for no reason.
UPDATE "delivery_notes"
   SET "deletedAt" = now()
 WHERE "counterSaleOrderId" IS NOT NULL
   AND "deletedAt" IS NULL
   AND "createdAt" >= '${since}'
   AND "notes" LIKE '%Recorded by backfill on%';

-- UNDO THE REVERT (the notes are still there; the marker is untouched):
-- UPDATE "delivery_notes" SET "deletedAt" = NULL
--  WHERE "counterSaleOrderId" IS NOT NULL AND "createdAt" >= '${since}'
--    AND "notes" LIKE '%Recorded by backfill on%';
--
-- NOTE: re-running the backfill after a revert will NOT recreate these notes.
-- A soft-deleted note still owns its (companyId, counterSaleOrderId) key, so the
-- unique index and the NOT EXISTS filter both still see it. That is deliberate:
-- un-revert with the statement above rather than creating a second note.
--
-- To revert EVERY backfilled note, from this run and any earlier one, drop the
-- "createdAt" line. To revert the live path as well — every auto-issued counter
-- note there has ever been, spec §6 revert level 3 — drop the "notes" line too,
-- and understand that it un-delivers counter sales that were never this script's
-- to touch.`;
}

// ── Database access ─────────────────────────────────────────────────────────

/**
 * Run a map of read-only queries and return `{ name: rows }`.
 *
 * Two runners, matching how the rest of scripts/ reaches a deployed database:
 *  - `docker` (default): `docker exec <container> node -e ...`, so the query
 *    runs where DATABASE_URL and the generated client already live.
 *  - `local`: in-process against DATABASE_URL, for a restored staging copy.
 *
 * Everything goes through `$queryRawUnsafe` with positional parameters. No
 * caller-supplied value is ever interpolated into SQL.
 */
/**
 * The database's own clock, through the same runner the snapshots use.
 *
 * Returned as a Date so every existing caller keeps working, but its VALUE is
 * the database's `now()`, which is the only clock the `createdAt` columns the
 * guards compare against are stamped from.
 */
async function readDatabaseNow(options) {
  const out = await runQueries({ now: { sql: 'SELECT now() AS now', params: [] } }, options);
  const value = out.now?.[0]?.now;
  if (!value) throw new Error('could not read the database clock (SELECT now() returned nothing)');
  return new Date(value);
}

async function runQueries(queries, options) {
  const payload = JSON.stringify(
    Object.fromEntries(Object.entries(queries).map(([name, q]) => [name, { sql: q.sql, params: q.params ?? [] }])),
  );

  if (options.runner === 'local') {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    try {
      const out = {};
      for (const [name, q] of Object.entries(JSON.parse(payload))) {
        out[name] = await prisma.$queryRawUnsafe(q.sql, ...q.params);
      }
      return JSON.parse(JSON.stringify(out, bigintReplacer));
    } finally {
      await prisma.$disconnect();
    }
  }

  const script = `
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const queries = ${JSON.stringify(payload)};
(async () => {
  const parsed = JSON.parse(queries);
  const out = {};
  for (const name of Object.keys(parsed)) {
    out[name] = await prisma.$queryRawUnsafe(parsed[name].sql, ...parsed[name].params);
  }
  console.log(JSON.stringify(out, (key, value) => (typeof value === 'bigint' ? value.toString() : value)));
})()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
`;
  const result = spawnSync('docker', ['exec', options.backendContainer, 'node', '-e', script], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`Unable to run docker exec ${options.backendContainer}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`docker exec ${options.backendContainer} failed with exit code ${result.status}`);
  }
  const line = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!line) throw new Error('Snapshot query returned no output');
  return JSON.parse(line);
}

function bigintReplacer(_key, value) {
  return typeof value === 'bigint' ? value.toString() : value;
}

// ── HTTP ────────────────────────────────────────────────────────────────────

async function apiRequest(path, { method = 'GET', token, apiUrl, timeoutMs = 120_000 }) {
  const url = path.startsWith('http') ? path : `${apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: response.status, ok: response.ok, body, text };
  } finally {
    clearTimeout(timer);
  }
}

function unwrap(body) {
  return body && body.success === true && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

/** A count flag must be a real positive integer — never a silent NaN. */
function positiveInteger(flag, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

export function parseArgs(argv) {
  const parsed = {
    envFile: null,
    apiUrl: null,
    backendContainer: null,
    runner: 'docker',
    companyId: null,
    endpoint: DEFAULT_ENDPOINT,
    list: 50,
    maxBatches: 20,
    apply: false,
    confirm: false,
    verifyOnly: false,
    help: false,
  };
  const takesValue = new Set([
    '--env-file',
    '--api-url',
    '--backend-container',
    '--runner',
    '--company-id',
    '--endpoint',
    '--list',
    '--max-batches',
  ]);
  const assign = (flag, value) => {
    switch (flag) {
      case '--env-file':
        parsed.envFile = value;
        break;
      case '--api-url':
        parsed.apiUrl = value;
        break;
      case '--backend-container':
        parsed.backendContainer = value;
        break;
      case '--runner':
        if (value !== 'docker' && value !== 'local') {
          throw new Error(`--runner must be "docker" or "local", got "${value}"`);
        }
        parsed.runner = value;
        break;
      case '--company-id':
        parsed.companyId = value;
        break;
      case '--endpoint':
        parsed.endpoint = value;
        break;
      case '--list':
        parsed.list = positiveInteger(flag, value);
        break;
      case '--max-batches':
        parsed.maxBatches = positiveInteger(flag, value);
        break;
      default:
        throw new Error(`Unhandled flag ${flag}`);
    }
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const eq = arg.indexOf('=');
    if (eq !== -1 && takesValue.has(arg.slice(0, eq))) {
      assign(arg.slice(0, eq), arg.slice(eq + 1));
      continue;
    }
    if (takesValue.has(arg)) {
      assign(arg, argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--apply') {
      parsed.apply = true;
      continue;
    }
    if (arg === '--confirm') {
      parsed.confirm = true;
      continue;
    }
    if (arg === '--verify-only') {
      parsed.verifyOnly = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  // The interlock: --apply alone is NOT enough. Anything short of both flags is
  // a dry run, so a mistyped production command reads instead of writes.
  parsed.willWrite = parsed.apply && parsed.confirm && !parsed.verifyOnly;
  return parsed;
}

/**
 * The command the dry run tells the operator to run next, built from the flags
 * they already typed. Mode flags are stripped and re-added exactly once, so the
 * printed line is a command that actually applies — never `--apply --apply`,
 * and never `--verify-only --apply --confirm`, which would quietly read again.
 */
export function applyCommand(argv) {
  const modeFlags = new Set(['--apply', '--confirm', '--verify-only']);
  return [...argv.filter((arg) => !modeFlags.has(arg)), '--apply', '--confirm'];
}

function loadEnv(file) {
  const values = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    values[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return values;
}

function normalizeUrl(value) {
  return String(value).replace(/\/+$/, '');
}

// ── Reporting ───────────────────────────────────────────────────────────────

function printSnapshot(label, snapshot) {
  console.log(`  ${label}`);
  console.log(
    `    orders still awaiting a counter-sale note : ${snapshot.population}` +
      (snapshot.populationPreRun !== snapshot.population
        ? `  (${snapshot.populationPreRun} of them predate this run — that is the work it was asked to do)`
        : ''),
  );
  console.log(`    live auto-issued counter notes            : ${snapshot.counterNotesLive}`);
  if (snapshot.counterNotesLive > 0) {
    const byStatus = Object.entries(snapshot.counterNotesByStatus)
      .map(([status, count]) => `${status}=${count}`)
      .join(' ');
    console.log(`      by status                               : ${byStatus}`);
  }
  if (snapshot.counterNotesDeleted > 0) {
    console.log(`    soft-deleted counter notes (reverted)     : ${snapshot.counterNotesDeleted}`);
  }
  // Everything below is scoped at the run's start — see the header. The labels
  // say so, because a number whose scope is a guess is not evidence.
  console.log(`    desk-created notes live at run start      : ${snapshot.preRunDeskNotesLive}`);
  console.log(`    counter notes live at run start           : ${snapshot.preRunCounterNotesLive}`);
  console.log(
    `    counter notes with invented evidence      : ${snapshot.inventedEvidencePreRun} from before this run, ` +
      `${snapshot.inventedEvidenceSinceRunStart} since it started (both MUST be 0)`,
  );
  console.log(`    stock movements against counter notes     : ${snapshot.noteStockMovements} (MUST be 0)`);
  console.log(
    `    SALE_ISSUE for POS orders that predate it : ${snapshot.posOrderSaleIssueMovements} movement(s) / ` +
      `${snapshot.posOrderSaleIssueQuantity}`,
  );
}

function printHelp() {
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const start = source.indexOf('/**');
  const end = source.indexOf('*/', start);
  console.log(
    source
      .slice(start + 3, end)
      .replace(/^\s*\* ?/gm, '')
      .trim(),
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    // A mistyped flag on a production console must read as a plain refusal, not
    // as a stack trace that invites a second, hastier attempt.
    console.error(`backfill-counter-sale-delivery-notes: ${error.message}`);
    console.error('Run with --help for usage. Nothing was read and nothing was written.');
    return 2;
  }
  if (options.help) {
    printHelp();
    return 0;
  }

  const envFilePath = options.envFile ? resolve(rootDir, options.envFile) : null;
  const env =
    envFilePath && existsSync(envFilePath) ? { ...loadEnv(envFilePath), ...process.env } : { ...process.env };

  const runtime = {
    runner: options.runner,
    backendContainer:
      options.backendContainer ?? env.COUNTER_DELIVERY_BACKEND_CONTAINER ?? 'itemba_r_backend',
  };
  const apiUrl = normalizeUrl(
    options.apiUrl ?? env.COUNTER_DELIVERY_API_URL ?? env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001/api/v1',
  );
  const token = env.ITEMBA_API_TOKEN ?? null;
  // THE RUN CUTOFF COMES FROM THE DATABASE, never from this machine.
  //
  // Every guard below compares it against `createdAt`, which Postgres stamps
  // from its OWN clock. Reading it from the script host instead makes the two
  // disagree by whatever the hosts have drifted — routine with `--runner local`
  // against a remote database, or a laptop resumed from sleep — and that skew
  // does two bad things at once. It widens the ~1s straddle the header
  // discloses into a minutes-wide window in which ordinary trading trips
  // "STOCK MOVED ... STOP and investigate before selling again" on a run that
  // wrote nothing; and it shifts the run-scoped REVERT's lower bound, so notes
  // this run really did create fall outside the statement the operator was told
  // undoes it, and quietly survive a revert believed to be complete.
  const runStartedAt = await readDatabaseNow(runtime);

  const mode = options.verifyOnly ? 'VERIFY-ONLY' : options.willWrite ? 'APPLY' : 'DRY RUN';
  console.log('');
  console.log('counter-sale delivery-note backfill — spec docs/pos-reform/spec-counter-delivery.md §4');
  console.log(`  mode      : ${mode}`);
  console.log(`  database  : ${runtime.runner === 'local' ? 'local DATABASE_URL' : `docker exec ${runtime.backendContainer}`}`);
  console.log(`  api       : ${apiUrl}`);
  console.log(`  company   : ${options.companyId ?? 'all companies the token can reach'}`);
  console.log(`  started   : ${runStartedAt.toISOString()}  (the DATABASE's clock — every guard and the revert are bounded by it)`);
  console.log('');

  // ── PREFLIGHT ─────────────────────────────────────────────────────────────
  console.log('PREFLIGHT');

  // 1. The safety fact, checked at source. If DeliveryNotesService ever grows a
  //    stock effect, creating a note for a POS sale would decrement stock a
  //    second time. Refuse to go anywhere near production in that world.
  const servicePath = resolve(rootDir, DELIVERY_NOTES_SERVICE_PATH);
  if (!existsSync(servicePath)) {
    console.error(`  FAILED  cannot find ${DELIVERY_NOTES_SERVICE_PATH} — run this from the repo root.`);
    return 2;
  }
  const stockHits = findStockEffects(readFileSync(servicePath, 'utf8'));
  if (stockHits.length > 0) {
    console.error(
      `  FAILED  ${DELIVERY_NOTES_SERVICE_PATH} now references ${stockHits.join(', ')}. ` +
        'A delivery note with an inventory effect would decrement stock TWICE for every ' +
        'counter sale. Refusing to run. Fix the service before backfilling anything.',
    );
    return 2;
  }
  // Honest about its reach: this reads the working tree, not the running server.
  console.log(
    `  ok      delivery-notes service has no inventory effects (no double stock)\n` +
      `          — read from ${DELIVERY_NOTES_SERVICE_PATH} in this checkout, NOT from the build serving\n` +
      `            ${apiUrl}. Confirm the deployed backend is this revision before --apply.`,
  );

  // 2. The office's worklists must already exclude counter notes. Backfilling
  //    into an unprotected dashboard drops N phantom "outstanding deliveries"
  //    onto the office's screens the moment it runs.
  const unprotected = [];
  for (const relativePath of WORKLIST_SERVICE_PATHS) {
    const path = resolve(rootDir, relativePath);
    if (!existsSync(path)) continue;
    for (const hit of findUnprotectedDeliveryQueries(readFileSync(path, 'utf8'))) {
      unprotected.push(`${relativePath}:${hit.line} (${hit.method})`);
    }
  }
  if (unprotected.length > 0) {
    const detail = unprotected.map((entry) => `            ${entry}`).join('\n');
    if (options.willWrite) {
      console.error(
        `  FAILED  ${unprotected.length} delivery-note worklist query(ies) do not filter counterSaleOrderId:\n` +
          `${detail}\n` +
          '          Backfilling now would list every counter sale on the office\'s delivery worklists as an\n' +
          '          outstanding delivery — with no driver and no vehicle, so they would also land on the\n' +
          '          "missing details" data-quality list. Land spec §5.2 first. Nothing was written.',
      );
      return 2;
    }
    console.log(
      `  WARN    ${unprotected.length} delivery-note worklist query(ies) do not yet filter counterSaleOrderId:\n` +
        `${detail}\n` +
        '          Dry run is still safe. --apply is blocked until spec §5.2 lands.',
    );
  } else {
    console.log(
      '  ok      office delivery worklists exclude counter-sale notes (spec §5.2)\n' +
        '          — again read from this checkout, not from the deployed build. A server running an older\n' +
        '            release would still flood the office; check what is deployed before --apply.',
    );
  }

  // 3. The database-level idempotency guarantee.
  //    Every snapshot query is scoped at runStartedAt, and BEFORE and AFTER use
  //    this same object, so the two passes compare identical populations.
  const snapshotQueries = buildSnapshotQueries({ companyId: options.companyId, runStartedAt });
  let rawBefore;
  try {
    rawBefore = await runQueries(snapshotQueries, runtime);
  } catch (error) {
    console.error(`  FAILED  could not read the database: ${error.message}`);
    return 2;
  }
  const guarantee = rawBefore.guarantee?.[0] ?? {};
  if (toNumber(guarantee.columnPresent) === 0 || toNumber(guarantee.indexPresent) === 0) {
    console.error(
      `  FAILED  the database is missing ${REQUIRED_COLUMN.table}."${REQUIRED_COLUMN.column}" and/or the unique ` +
        `index ${REQUIRED_UNIQUE_INDEX}.\n` +
        '          That index IS the idempotency guarantee — without it a replay or a create race can write a\n' +
        '          second delivery note for one sale, and a read-then-write check cannot decide the race.\n' +
        '          Deploy migration 20260815120000_delivery_note_counter_sale_key first.',
    );
    return 2;
  }
  console.log(`  ok      ${REQUIRED_UNIQUE_INDEX} present (database-level idempotency guarantee)`);

  const before = readSnapshot(rawBefore);

  // 4. Damage that predates this run. Both of these used to surface only in the
  //    AFTER verification, i.e. AFTER --apply had already written — where the
  //    advice "investigate before running" is advice nobody can follow. They
  //    belong here, while refusing is still possible.
  const preExisting = [];
  if (before.noteStockMovements > 0) {
    preExisting.push(
      `${before.noteStockMovements} inventory movement(s) are already recorded against a counter-sale delivery ` +
        'note. A delivery note must have no inventory effect; something already moved stock through one.',
    );
  }
  if (before.inventedEvidencePreRun > 0) {
    preExisting.push(
      `${before.inventedEvidencePreRun} existing counter-sale note(s) carry a driver, vehicle, address or phone. ` +
        'A counter sale has none of those — that is forged delivery evidence, and it predates this run.',
    );
  }
  if (preExisting.length > 0) {
    const detail = preExisting.map((entry) => `            ${entry}`).join('\n');
    if (options.willWrite) {
      console.error(`  FAILED  pre-existing damage; refusing to add to it:\n${detail}\n` + '          Nothing was written.');
      return 2;
    }
    console.log(`  WARN    pre-existing damage, not caused by this run:\n${detail}\n` + '          --apply is refused while this is true.');
  } else {
    console.log('  ok      no counter-sale note has ever moved stock or carried invented delivery evidence');
  }

  // 5. Scope honesty. The SQL above reads the whole database unless --company-id
  //    was given; the endpoint only ever processes the companies the manager's
  //    token can reach (spec §4.2, CompanyScopeService). When those two differ,
  //    a finished run reads as an unfinished one and invites re-runs forever.
  if (!options.companyId && before.populationCompanies > 1) {
    console.log(
      `  WARN    the outstanding orders span ${before.populationCompanies} companies, and no --company-id was given.\n` +
        '          These counts and the list below cover every company on this database; the endpoint will only\n' +
        '          process the ones the token can reach. Re-run with --company-id <uuid> to make the two agree.',
    );
  }

  // 6. Credentials and permission — only when we intend to write.
  if (options.willWrite) {
    if (!token) {
      console.error(
        '  FAILED  no ITEMBA_API_TOKEN in the environment. The backfill runs through the manager-authorised\n' +
          '          endpoint and needs a bearer token for a user holding mobile_pos_lite.manage.\n' +
          '          This script never accepts a password.',
      );
      return 2;
    }
    let probe;
    try {
      probe = await apiRequest(PERMISSION_PROBE_ENDPOINT, { token, apiUrl, timeoutMs: 30_000 });
    } catch (error) {
      // Unreachable API. A plain refusal, not a stack trace — the same reason
      // parseArgs failures are caught above: a wall of undici frames on a
      // production console invites a second, hastier attempt.
      console.error(
        `  FAILED  cannot reach ${apiUrl}: ${error.name === 'AbortError' ? 'timed out' : error.message}.\n` +
          '          Check --api-url and that the backend is up. Nothing was read from it and nothing was written.',
      );
      return 2;
    }
    if (probe.status === 401) {
      console.error('  FAILED  ITEMBA_API_TOKEN was rejected (401). Get a fresh token.');
      return 2;
    }
    if (probe.status === 403) {
      console.error('  FAILED  the token lacks mobile_pos_lite.manage (403). Use a manager token.');
      return 2;
    }
    if (!probe.ok) {
      console.error(`  FAILED  permission probe ${PERMISSION_PROBE_ENDPOINT} returned ${probe.status}.`);
      return 2;
    }
    console.log('  ok      token authenticated and holds mobile_pos_lite.manage');
  }
  console.log('');

  // ── BEFORE ────────────────────────────────────────────────────────────────
  console.log('BEFORE');
  printSnapshot('counts', before);
  console.log('');

  // ── WHAT WOULD CHANGE ─────────────────────────────────────────────────────
  const { listSql, params } = buildPopulationQuery({
    companyId: options.companyId,
    limit: Number.isFinite(options.list) && options.list > 0 ? options.list : null,
  });
  const listed = (await runQueries({ rows: { sql: listSql, params } }, runtime)).rows ?? [];

  const scopeNote = options.companyId ? 'in this company' : 'on this database';
  console.log(options.verifyOnly ? 'OUTSTANDING' : 'WOULD CHANGE');
  if (before.population === 0) {
    console.log(`  nothing — every POS counter sale ${scopeNote} already carries its delivery note.`);
  } else {
    const cap = options.maxBatches * BATCH_SIZE;
    console.log(
      `  ${before.population} sales order(s) ${scopeNote} would each receive exactly ONE delivery note, driven to DELIVERED.`,
    );
    if (before.population > cap) {
      console.log(`  This invocation can process at most ${cap} of them (--max-batches ${options.maxBatches} × ${BATCH_SIZE}); re-run for the rest.`);
    }
    // Stated as the expectation it is. The script cannot see inside the server;
    // what it CAN do is check afterwards, and the guards below do exactly that.
    console.log('  Expected: no stock movement, no GL posting, no money — a document only.');
    console.log('  That expectation is not assumed: the AFTER guards re-read the database and fail the run if it broke.');
    console.log('');
    console.log('  order              status          date        terminal   lines');
    for (const row of listed) {
      const date = new Date(row.orderDate).toISOString().slice(0, 10);
      console.log(
        `  ${String(row.salesOrderNumber).padEnd(18)} ${String(row.status).padEnd(15)} ${date}  ` +
          `${String(row.terminalCode ?? '-').padEnd(10)} ${row.lineCount}`,
      );
    }
    if (listed.length < before.population) {
      console.log(`  … and ${before.population - listed.length} more (raise --list to see them all).`);
    }
  }
  console.log('');

  // ── APPLY ─────────────────────────────────────────────────────────────────
  // Three separate facts, because conflating them is how a run lies about
  // itself: `attemptedWrite` — a POST left this process, so notes MAY exist
  // even if the answer never came back; `applied` — a batch was acknowledged;
  // `batchFailed` — the run stopped short of finishing what it was asked to do.
  let attemptedWrite = false;
  let applied = false;
  let batchFailed = false;
  const batches = [];
  if (options.verifyOnly) {
    console.log('VERIFY-ONLY — no endpoint call made.');
    console.log('');
  } else if (!options.willWrite) {
    console.log('DRY RUN — no write request of any kind was issued.');
    console.log('  Re-run with BOTH --apply and --confirm to make the change:');
    console.log(
      `    ITEMBA_API_TOKEN=<manager token> node scripts/backfill-counter-sale-delivery-notes.mjs ` +
        `${applyCommand(process.argv.slice(2)).join(' ')}`,
    );
    console.log('');
  } else if (before.population === 0) {
    console.log('APPLY — skipped, the population is already empty.');
    console.log('');
  } else {
    console.log('APPLY');
    const query = options.companyId ? `?companyId=${encodeURIComponent(options.companyId)}` : '';
    let cappedOut = true;
    for (let batch = 1; batch <= options.maxBatches; batch += 1) {
      let response;
      attemptedWrite = true;
      try {
        response = await apiRequest(`${options.endpoint}${query}`, { method: 'POST', token, apiUrl });
      } catch (error) {
        // A dropped connection or the request timeout must NOT escape main():
        // the operator would lose the AFTER counts, every guard, and — at the
        // exact moment they most need it — the run-scoped revert. Whatever the
        // server already committed stands, and re-running resumes it.
        console.error(`  FAILED  batch ${batch}: ${error.name === 'AbortError' ? 'timed out' : error.message}.`);
        console.error(
          '  The server may still have committed this batch. Verification and the revert SQL below cover\n' +
            '  everything written so far; re-running the same command resumes safely.',
        );
        batchFailed = true;
        cappedOut = false;
        break;
      }
      if (response.status === 404) {
        console.error(
          `  FAILED  POST ${apiUrl}${options.endpoint} returned 404. Either the backfill endpoint is not deployed\n` +
            '          on this server (spec §4.1 / build order §8 step 7), or --api-url / --endpoint point somewhere\n' +
            '          else. Check what the server actually serves.',
        );
        if (batch > 1) {
          // A 404 on a LATER batch is a rolling deploy or a changed --api-url,
          // not an undeployed route: earlier batches already committed real
          // documents. Falling through to verification and the revert is the
          // whole point — `return 2` here would tell the operator "nothing was
          // written" while several hundred notes stood, at exactly the moment
          // they need the revert SQL.
          console.error(
            `  Batches 1-${batch - 1} already committed and stand. Verification and the revert SQL below\n` +
              '  cover everything written so far; re-running the same command resumes safely.',
          );
        }
        batchFailed = true;
        cappedOut = false;
        break;
      }
      if (!response.ok) {
        console.error(`  FAILED  batch ${batch}: HTTP ${response.status} ${response.text?.slice(0, 300) ?? ''}`);
        console.error('  Safe to stop here — every batch already committed stands, and re-running resumes.');
        batchFailed = true;
        cappedOut = false;
        break;
      }
      const report = unwrap(response.body) ?? {};
      batches.push(report);
      applied = true;
      console.log(
        `  batch ${batch}: scanned=${report.scanned ?? '?'} created=${report.created ?? 0} ` +
          `resumed=${report.resumed ?? 0} skipped=${report.skipped ?? 0} failed=${report.failed ?? 0}`,
      );
      for (const failure of report.failures ?? []) {
        console.log(`    failure ${failure.salesOrderNumber ?? failure.salesOrderId}: ${failure.reason}`);
      }
      // Stop when the endpoint stops making progress: either the population is
      // exhausted, or every remaining order is failing and another pass would
      // only repeat the same failures. A short page also means the end — but
      // only when the endpoint actually reported a page size; an absent
      // `scanned` must not be read as zero and end the run after one batch.
      const progressed = toNumber(report.created) + toNumber(report.resumed);
      const scanned = report.scanned === undefined || report.scanned === null ? null : toNumber(report.scanned);
      if (progressed === 0 || (scanned !== null && scanned < BATCH_SIZE)) {
        cappedOut = false;
        break;
      }
    }
    if (cappedOut) {
      console.log(`  stopped at the --max-batches cap (${options.maxBatches}). Re-run the same command to continue.`);
    }
    console.log('');
  }

  // ── AFTER ─────────────────────────────────────────────────────────────────
  // Guarded for the same reason the batch loop is: this is the one read that
  // happens AFTER writes may have committed, so letting it escape main() would
  // discard the AFTER counts, all four guards, and the run-scoped revert — the
  // operator left holding real documents and no statement to undo them.
  let after = null;
  try {
    after = readSnapshot(await runQueries(snapshotQueries, runtime));
    console.log('AFTER');
    printSnapshot('counts', after);
    console.log('');
  } catch (error) {
    console.error(`  FAILED  the AFTER snapshot could not be read: ${error.message}`);
    console.error(
      '  The guards below cannot run, so nothing here vouches for stock. Anything already committed\n' +
        '  stands and the revert SQL still covers it; re-running the same command is safe and will\n' +
        '  re-verify from a clean read.',
    );
  }

  // What THIS run did comes from the endpoint's own report. The snapshot can
  // only say what the whole database did meanwhile, and on a trading shop those
  // are two different numbers — reporting the second as the first is a lie the
  // operator has no way to catch.
  const reported = batches.reduce(
    (total, report) => ({
      batches: total.batches + 1,
      scanned: total.scanned + toNumber(report.scanned),
      created: total.created + toNumber(report.created),
      resumed: total.resumed + toNumber(report.resumed),
      skipped: total.skipped + toNumber(report.skipped),
      failed: total.failed + toNumber(report.failed),
    }),
    { batches: 0, scanned: 0, created: 0, resumed: 0, skipped: 0, failed: 0 },
  );

  const signed = (value) => (value >= 0 ? `+${value}` : `${value}`);
  // `after` is null only when the snapshot read above failed. The DELTA and the
  // guards need it; the REVERT block below deliberately does not, so an
  // operator holding committed writes still gets the statement that undoes
  // them. `failures` stays empty in that case — nothing was checked, so nothing
  // may be claimed either way, and `batchFailed`/the read error carry the exit.
  let failures = [];
  if (after) {
  const clearedPreRun = before.populationPreRun - after.populationPreRun;
  console.log(
    attemptedWrite ? 'DELTA (what this run did)' : 'DELTA (this run wrote nothing — what the database did meanwhile)',
  );
  if (applied) {
    console.log(`  notes created by the endpoint       : ${signed(reported.created)}  (resumed ${reported.resumed}, skipped ${reported.skipped}, failed ${reported.failed})`);
    console.log(`  orders cleared from its own backlog : ${signed(clearedPreRun)} of ${before.populationPreRun}`);
  } else if (attemptedWrite) {
    // A request went out and no answer came back. Saying "+0" here would be a
    // guess dressed as a count; the AFTER snapshot is what actually knows.
    console.log(`  notes created by the endpoint       : unknown — the request left, the answer did not come back`);
    console.log(`  orders cleared from its own backlog : ${signed(clearedPreRun)} of ${before.populationPreRun} (measured, not reported)`);
  } else {
    console.log(`  notes created by this run           : +0  (it issued no write request)`);
  }
  if (after.counterNotesSinceRunStart > 0) {
    console.log(
      `  counter notes created while it ran  : +${after.counterNotesSinceRunStart} from all sources` +
        (applied ? ` (${reported.created} of them this run's)` : attemptedWrite ? '' : ' (the live counter path, selling)'),
    );
  }
  console.log(`  stock moved by a counter note       : ${after.noteStockMovements} (MUST be 0)`);
  console.log(
    `  SALE_ISSUE for pre-run POS orders   : ` +
      `${signed(after.posOrderSaleIssueMovements - before.posOrderSaleIssueMovements)} movement(s) (MUST be 0)`,
  );
  console.log(
    `  notes that predate it, re-keyed     : ${signed(after.preRunCounterNotes - before.preRunCounterNotes)} (MUST be 0)`,
  );
  console.log(
    `  desk notes that predate it, live    : ${signed(after.preRunDeskNotesLive - before.preRunDeskNotesLive)} (this run has no path that changes this)`,
  );
  console.log('');

  const diff = diffSnapshots(before, after, {
    // A POST that left this process may have committed, whether or not its
    // answer arrived. Verify as if it did.
    applied: attemptedWrite,
    reported: applied ? reported : null,
  });
  failures = diff.failures;
  for (const observation of diff.observations) console.log(`  note    ${observation}`);
  for (const warning of diff.warnings) console.log(`  WARN    ${warning}`);
  for (const failure of failures) console.error(`  FAILED  ${failure}`);
  console.log('');
  }

  if (attemptedWrite) {
    console.log('REVERT (this run only)');
    console.log(
      buildRevertSql(runStartedAt)
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n'),
    );
    console.log('');
  }

  if (failures.length > 0) {
    console.error('backfill-counter-sale-delivery-notes: FAILED');
    return 1;
  }
  if (batchFailed) {
    // Every guard passed, so nothing is damaged — but the run stopped short of
    // what it was asked to do, and reporting OK would send the operator away
    // believing history was repaired when it was only partly repaired.
    console.error(
      'backfill-counter-sale-delivery-notes: INCOMPLETE — a batch failed (see above). Nothing is damaged; the\n' +
        'guards all passed and whatever committed stands. Re-run the same command to finish.',
    );
    return 1;
  }
  console.log(`backfill-counter-sale-delivery-notes: OK (${mode})`);
  return 0;
}

/** Which forbidden stock symbols a source file mentions. Empty means safe. */
export function findStockEffects(source) {
  return STOCK_EFFECT_PATTERNS.filter((pattern) => pattern.test(source)).map((pattern) => pattern.source);
}

/** Read a balanced (…) or {…} block, given the index of its opening delimiter. */
function extractBalanced(source, openIndex, open = '(', close = ')') {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  return source.slice(openIndex + 1);
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

/**
 * Identifiers bound to an object literal that filters `counterSaleOrderId`.
 * The discriminator is rarely written inline at the call site — the house style
 * is a shared `const NOT_A_COUNTER_SALE = { counterSaleOrderId: null }` spread
 * into each `where`, or a `const where = { …, counterSaleOrderId: null }` built
 * a few lines above the query. Both count as protection.
 */
function collectProtectiveTokens(source) {
  const declaration = /(?:^|\n)([ \t]*)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*\{/g;
  const tokens = [];
  let match;
  while ((match = declaration.exec(source)) !== null) {
    const braceIndex = declaration.lastIndex - 1;
    if (!/counterSaleOrderId/.test(extractBalanced(source, braceIndex, '{', '}'))) continue;
    tokens.push({
      name: match[2],
      // A module-scope constant protects every call site in the file; a local
      // one only protects the query it was built for, just below it.
      moduleScope: match[1].length === 0,
      line: lineOf(source, match.index + 1),
    });
  }
  return tokens;
}

/**
 * Worklist-aggregate delivery-note queries that do NOT filter on
 * `counterSaleOrderId`. Each one is a screen or report that would list
 * auto-issued counter notes as outstanding delivery work.
 *
 * Known limitation: a locally-declared protective object is matched by name
 * within `localScopeLines` of the call. Two same-named `where` objects in one
 * file, only one of which carries the discriminator, would read as protected.
 * The backend spec's own CD-13/CD-15 assertions are the precise check; this is
 * the operator-side stop that keeps a backfill from flooding the office.
 */
export function findUnprotectedDeliveryQueries(source, { localScopeLines = 60 } = {}) {
  const tokens = collectProtectiveTokens(source);
  const pattern = new RegExp(`prisma\\.deliveryNote\\.(${WORKLIST_QUERY_METHODS.join('|')})\\s*\\(`, 'g');
  const unprotected = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const args = extractBalanced(source, pattern.lastIndex - 1);
    if (/counterSaleOrderId/.test(args)) continue;

    const line = lineOf(source, match.index);
    const protectedByToken = tokens.some(
      (token) =>
        new RegExp(`\\b${token.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(args) &&
        (token.moduleScope || (token.line <= line && line - token.line <= localScopeLines)),
    );
    if (!protectedByToken) unprotected.push({ method: match[1], line });
  }
  return unprotected;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.stack ?? error.message);
      process.exitCode = 1;
    });
}
