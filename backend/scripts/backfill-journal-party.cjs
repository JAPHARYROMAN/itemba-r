/*
 * Party linkage, Phase 3 (PR-1): the general ledger knows the party.
 *
 * Fills partyType / supplierId / customerId on existing accounts payable and accounts
 * receivable control lines from the document their journal references. Dry run by default:
 * it only counts. Pass --apply to write. Idempotent: only lines still at partyType 'NONE'
 * on a company's AP or AR control account are considered, and a line is tagged only when
 * its journal's referenced document names the party in the same company. Amounts, accounts
 * and journals are never touched; lines it cannot explain are listed as findings.
 *
 * Usage:  node scripts/backfill-journal-party.cjs [--apply] [--company <id>]
 * Reads DATABASE_URL from backend/.env (or the environment).
 */
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const companyArg = process.argv.indexOf('--company');
const ONLY_COMPANY = companyArg > -1 ? process.argv[companyArg + 1] : null;

// Mirrors AccountResolverService: accountSubType first, conventional codes as fallback.
const ROLES = {
  AP: { subtype: 'ap_control', codes: ['2000', '2010', '2100'], kind: 'supplier' },
  AR: { subtype: 'ar_control', codes: ['1100', '1110'], kind: 'customer' },
};

// referenceType → how to reach the party. `join` reaches a desk party's canonical master.
const SOURCES = [
  { referenceType: 'Payable', table: 'payables', column: 'supplierId', kind: 'supplier' },
  {
    referenceType: 'SupplierPayment',
    table: 'supplier_payments',
    column: 'supplierId',
    kind: 'supplier',
  },
  {
    referenceType: 'SupplierInvoice',
    table: 'supplier_invoices',
    column: 'supplierId',
    kind: 'supplier',
  },
  {
    referenceType: 'PurchaseOrder',
    table: 'purchase_orders',
    column: 'supplierId',
    kind: 'supplier',
  },
  {
    referenceType: 'GoodsReceivedNote',
    table: 'goods_received_notes',
    column: 'supplierId',
    kind: 'supplier',
  },
  { referenceType: 'Expense', table: 'expenses', column: 'supplierId', kind: 'supplier' },
  { referenceType: 'Receivable', table: 'receivables', column: 'customerId', kind: 'customer' },
  {
    referenceType: 'CustomerPayment',
    table: 'customer_payments',
    column: 'customerId',
    kind: 'customer',
  },
  { referenceType: 'SalesOrder', table: 'sales_orders', column: 'customerId', kind: 'customer' },
  { referenceType: 'CreditNote', table: 'credit_notes', column: 'customerId', kind: 'customer' },
  { referenceType: 'Refund', table: 'refunds', column: 'customerId', kind: 'customer' },
  {
    referenceType: 'DeskPurchase',
    table: 'invoice_desk_invoices',
    kind: 'supplier',
    join: { table: 'invoice_desk_suppliers', via: 'supplierId', column: 'canonicalSupplierId' },
  },
  {
    referenceType: 'DeskSale',
    table: 'sales_desk_sales',
    kind: 'customer',
    join: { table: 'sales_desk_customers', via: 'customerId', column: 'canonicalCustomerId' },
  },
];

async function controlAccounts(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id", "companyId", LOWER("accountSubType") AS subtype, "accountCode"
       FROM "chart_of_accounts"
      WHERE "deletedAt" IS NULL AND "isActive" = true
        AND (LOWER("accountSubType") IN ('ap_control', 'ar_control')
             OR "accountCode" IN ('2000', '2010', '2100', '1100', '1110'))`,
  );
  const byCompany = new Map();
  for (const row of rows) {
    const entry = byCompany.get(row.companyId) ?? {
      AP: { subtype: [], codes: [] },
      AR: { subtype: [], codes: [] },
    };
    for (const role of ['AP', 'AR']) {
      if (row.subtype === ROLES[role].subtype) entry[role].subtype.push(row.id);
      else if (ROLES[role].codes.includes(row.accountCode))
        entry[role].codes.push({ id: row.id, code: row.accountCode });
    }
    byCompany.set(row.companyId, entry);
  }
  const resolved = { AP: [], AR: [] };
  for (const [companyId, entry] of byCompany) {
    if (ONLY_COMPANY && companyId !== ONLY_COMPANY) continue;
    for (const role of ['AP', 'AR']) {
      if (entry[role].subtype.length) resolved[role].push(...entry[role].subtype);
      else {
        const first = ROLES[role].codes
          .map((code) => entry[role].codes.find((c) => c.code === code))
          .find(Boolean);
        if (first) resolved[role].push(first.id);
      }
    }
  }
  return resolved;
}

function partySql(source) {
  const partyExpr = source.join ? `m."${source.join.column}"` : `d."${source.column}"`;
  const joinSql = source.join
    ? `JOIN "${source.join.table}" m ON m."id" = d."${source.join.via}"`
    : '';
  return { partyExpr, joinSql };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const control = await controlAccounts(prisma);
    console.log(
      `Control accounts: AP ${control.AP.length}, AR ${control.AR.length}${ONLY_COMPANY ? ` (company ${ONLY_COMPANY})` : ''}`,
    );
    let total = 0;
    for (const source of SOURCES) {
      const role = source.kind === 'supplier' ? 'AP' : 'AR';
      const accountIds = control[role];
      if (!accountIds.length) continue;
      const { partyExpr, joinSql } = partySql(source);
      const partyColumn = source.kind === 'supplier' ? 'supplierId' : 'customerId';
      const partyType = source.kind === 'supplier' ? 'SUPPLIER' : 'CUSTOMER';
      const from = `FROM "journal_entries" j
             JOIN "${source.table}" d ON d."id" = j."referenceId" ${joinSql}
            WHERE l."journalEntryId" = j."id"
              AND j."referenceType" = $1
              AND l."partyType" = 'NONE'
              AND l."accountId" = ANY($2::text[])
              AND ${partyExpr} IS NOT NULL
              AND d."companyId" = l."companyId"`;
      const count = await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM "journal_entry_lines" l WHERE EXISTS (SELECT 1 ${from})`,
        source.referenceType,
        accountIds,
      );
      const n = count[0]?.n ?? 0;
      total += n;
      if (APPLY && n > 0) {
        const updated = await prisma.$executeRawUnsafe(
          `UPDATE "journal_entry_lines" l
              SET "partyType" = '${partyType}', "${partyColumn}" = ${partyExpr}
             ${from}`,
          source.referenceType,
          accountIds,
        );
        console.log(`${source.referenceType.padEnd(18)} tagged ${updated}`);
      } else console.log(`${source.referenceType.padEnd(18)} ${n} line(s) would be tagged`);
    }
    const untagged = await prisma.$queryRawUnsafe(
      `SELECT j."referenceType", count(*)::int AS n
         FROM "journal_entry_lines" l JOIN "journal_entries" j ON j."id" = l."journalEntryId"
        WHERE l."partyType" = 'NONE' AND l."accountId" = ANY($1::text[])
        GROUP BY j."referenceType" ORDER BY n DESC LIMIT 20`,
      [...control.AP, ...control.AR],
    );
    console.log(
      `\n${APPLY ? 'Tagged' : 'Would tag'} ${total} control line(s). Control lines still without a party (findings):`,
    );
    for (const row of untagged)
      console.log(`  ${String(row.referenceType ?? '(no reference)').padEnd(28)} ${row.n}`);
    if (!untagged.length) console.log('  none');
    if (!APPLY) console.log('\nDry run. Re-run with --apply to write.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
