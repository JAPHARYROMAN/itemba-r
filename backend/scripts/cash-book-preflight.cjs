/*
 * Cash book pre-flight (W4 / decision D3). Read-only.
 *
 * Before CASH_BOOK_UNIFIED is switched on, every ERP cash account that payments use must be
 * connected to a Cash Desk account (CashDeskAccount.erpCashAccountId). This lists:
 *   1. active ERP cash accounts used by payments, collections, expenses, refunds or sales in
 *      the last 365 days that have no Cash Desk connection (BLOCKING);
 *   2. connected pairs whose ERP currentBalance and Cash Desk balance differ (review).
 *
 * Usage: node scripts/cash-book-preflight.cjs [--days 365] [--json]
 */
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');

async function main() {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) : 365;
  const asJson = args.includes('--json');
  const db = new PrismaClient();
  try {
    const since = new Date(Date.now() - days * 86400000);
    const used = await db.$queryRawUnsafe(
      `WITH used AS (
         SELECT "cashAccountId" AS id, 'expenses' AS source FROM "expenses" WHERE "paidAt" >= $1 AND "cashAccountId" IS NOT NULL
         UNION ALL SELECT "cashAccountId", 'refunds' FROM "refunds" WHERE "postedAt" >= $1
         UNION ALL SELECT "cashAccountId", 'customer_payments' FROM "customer_payments" WHERE "paymentDate" >= $1 AND "cashAccountId" IS NOT NULL
         UNION ALL SELECT "cashAccountId", 'supplier_payments' FROM "supplier_payments" WHERE "paymentDate" >= $1 AND "cashAccountId" IS NOT NULL
         UNION ALL SELECT "cashAccountId", 'sales_orders' FROM "sales_orders" WHERE "createdAt" >= $1 AND "cashAccountId" IS NOT NULL
       )
       SELECT ca."id", ca."accountName", ca."companyId", ca."currency", ca."accountType",
              COUNT(u.id)::int AS uses, STRING_AGG(DISTINCT u.source, ',') AS sources,
              (d."id" IS NOT NULL) AS connected
       FROM "cash_accounts" ca
       LEFT JOIN used u ON u.id = ca."id"
       LEFT JOIN "cash_desk_accounts" d ON d."erpCashAccountId" = ca."id"
       WHERE ca."deletedAt" IS NULL AND ca."isActive" = true
       GROUP BY ca."id", d."id"
       ORDER BY connected, uses DESC, ca."accountName"`,
      since,
    );
    const pairs = await db.$queryRawUnsafe(
      `SELECT d."id" AS "cashDeskAccountId", d."name", d."currency", d."balance"::text AS "cashDeskBalance",
              ca."accountName", ca."currentBalance"::text AS "erpBalance",
              (ca."currentBalance" - d."balance")::text AS "difference"
       FROM "cash_desk_accounts" d JOIN "cash_accounts" ca ON ca."id" = d."erpCashAccountId"
       ORDER BY ABS(ca."currentBalance" - d."balance") DESC, d."name"`,
    );
    const blocking = used.filter((r) => !r.connected && r.uses > 0);
    const out = {
      sinceDays: days,
      unconnectedUsed: blocking,
      unconnectedIdle: used.filter((r) => !r.connected && r.uses === 0),
      connectedPairs: pairs,
      pairsOutOfStep: pairs.filter((p) => Number(p.difference) !== 0),
    };
    if (asJson) console.log(JSON.stringify(out, null, 2));
    else {
      console.log(
        `ERP cash accounts used in the last ${days} days with NO Cash Desk connection (blocking):`,
      );
      console.table(
        blocking.map((r) => ({
          account: r.accountName,
          company: r.companyId,
          currency: r.currency,
          type: r.accountType,
          uses: r.uses,
          sources: r.sources,
        })),
      );
      console.log('Connected pairs (ERP balance vs Cash Desk balance):');
      console.table(
        pairs.map((p) => ({
          deskAccount: p.name,
          erpAccount: p.accountName,
          currency: p.currency,
          erp: p.erpBalance,
          desk: p.cashDeskBalance,
          difference: p.difference,
        })),
      );
    }
    if (blocking.length) {
      console.error(
        `cash-book-preflight: ${blocking.length} used ERP cash account(s) have no Cash Desk connection. Connect them (Cash Desk → Accounts) before enabling CASH_BOOK_UNIFIED.`,
      );
      process.exitCode = 2;
    } else console.log('cash-book-preflight: every used ERP cash account is connected.');
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
