/*
 * Party linkage pre-flight (W6). Read-only.
 *
 * Lists every soft supplierId / customerId that points at a master which does not exist
 * (or exists in another company), so the owner can fix them before the `party_relations`
 * migration adds real foreign keys. Nothing is written to the database.
 *
 * Usage:  node scripts/party-orphans.cjs [--csv path] [--json]
 * Reads DATABASE_URL from backend/.env (or the environment).
 */
const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');

// table, column, master table, optional company column on the referencing row, whether the
// column is required in the schema (a required orphan must be fixed by hand; a nullable one
// can be set to NULL by the relations migration and is listed for information).
const CHECKS = [
  {
    table: 'goods_received_notes',
    column: 'supplierId',
    master: 'suppliers',
    company: 'companyId',
    required: true,
  },
  {
    table: 'supplier_invoices',
    column: 'supplierId',
    master: 'suppliers',
    company: 'companyId',
    required: true,
  },
  {
    table: 'supplier_invoices',
    column: 'payableId',
    master: 'payables',
    company: 'companyId',
    required: false,
  },
  {
    table: 'rfq_suppliers',
    column: 'supplierId',
    master: 'suppliers',
    company: null,
    required: true,
  },
  {
    table: 'supplier_quotations',
    column: 'supplierId',
    master: 'suppliers',
    company: 'companyId',
    required: true,
  },
  {
    table: 'bid_comparison_lines',
    column: 'supplierId',
    master: 'suppliers',
    company: null,
    required: true,
  },
  {
    table: 'bid_comparisons',
    column: 'recommendedSupplierId',
    master: 'suppliers',
    company: null,
    required: false,
  },
  {
    table: 'request_for_quotations',
    column: 'awardedSupplierId',
    master: 'suppliers',
    company: 'companyId',
    required: false,
  },
  {
    table: 'purchase_requisition_lines',
    column: 'preferredSupplierId',
    master: 'suppliers',
    company: null,
    required: false,
  },
  {
    table: 'supplier_performance_profiles',
    column: 'supplierId',
    master: 'suppliers',
    company: 'companyId',
    required: true,
  },
  {
    table: 'supplier_statement_runs',
    column: 'supplierId',
    master: 'suppliers',
    company: 'companyId',
    required: true,
    sentinel: 'ALL',
  },
  {
    table: 'customer_credit_profiles',
    column: 'customerId',
    master: 'customers',
    company: 'companyId',
    required: true,
  },
  {
    table: 'customer_segment_memberships',
    column: 'customerId',
    master: 'customers',
    company: null,
    required: true,
  },
  {
    table: 'customer_statement_runs',
    column: 'customerId',
    master: 'customers',
    company: 'companyId',
    required: true,
    sentinel: 'ALL',
  },
];

function q(id) {
  return `"${id.replace(/"/g, '""')}"`;
}

async function columnExists(db, table, column) {
  const rows = await db.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    table,
    column,
  );
  return rows.length > 0;
}

async function main() {
  const args = process.argv.slice(2);
  const csvIndex = args.indexOf('--csv');
  const csvPath = csvIndex >= 0 ? args[csvIndex + 1] : null;
  const asJson = args.includes('--json');
  const db = new PrismaClient();
  const results = [];
  try {
    for (const c of CHECKS) {
      if (!(await columnExists(db, c.table, c.column))) {
        results.push({
          ...c,
          status: 'column missing',
          missing: null,
          crossCompany: null,
          sentinelRows: null,
        });
        continue;
      }
      const sentinelFilter = c.sentinel ? ` AND r.${q(c.column)} <> '${c.sentinel}'` : '';
      const [missing] = await db.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS n FROM ${q(c.table)} r
         WHERE r.${q(c.column)} IS NOT NULL${sentinelFilter}
           AND NOT EXISTS (SELECT 1 FROM ${q(c.master)} m WHERE m."id" = r.${q(c.column)})`,
      );
      let crossCompany = null;
      if (c.company) {
        const [row] = await db.$queryRawUnsafe(
          `SELECT COUNT(*)::int AS n FROM ${q(c.table)} r
           JOIN ${q(c.master)} m ON m."id" = r.${q(c.column)}
           WHERE m."companyId" IS DISTINCT FROM r.${q(c.company)}`,
        );
        crossCompany = row.n;
      }
      let sentinelRows = null;
      if (c.sentinel) {
        const [row] = await db.$queryRawUnsafe(
          `SELECT COUNT(*)::int AS n FROM ${q(c.table)} r WHERE r.${q(c.column)} = '${c.sentinel}'`,
        );
        sentinelRows = row.n;
      }
      const blocking = c.required && (missing.n > 0 || (crossCompany ?? 0) > 0);
      results.push({
        ...c,
        status: blocking ? 'BLOCKING' : missing.n || crossCompany || sentinelRows ? 'review' : 'ok',
        missing: missing.n,
        crossCompany,
        sentinelRows,
      });
    }
  } finally {
    await db.$disconnect();
  }

  const rows = results.map((r) => ({
    table: r.table,
    column: r.column,
    master: r.master,
    required: r.required,
    status: r.status,
    missingMaster: r.missing,
    crossCompany: r.crossCompany,
    sentinelRows: r.sentinelRows,
  }));
  if (asJson) console.log(JSON.stringify(rows, null, 2));
  else console.table(rows);
  if (csvPath) {
    const header = Object.keys(rows[0]).join(',');
    const body = rows
      .map((r) =>
        Object.values(r)
          .map((v) => (v === null ? '' : String(v)))
          .join(','),
      )
      .join('\n');
    fs.mkdirSync(path.dirname(csvPath), { recursive: true });
    fs.writeFileSync(csvPath, `${header}\n${body}\n`);
    console.log(`CSV written to ${csvPath}`);
  }
  const blocking = rows.filter((r) => r.status === 'BLOCKING');
  if (blocking.length) {
    console.error(
      `party-orphans: ${blocking.length} required column(s) have orphans. Fix them before applying party_relations.`,
    );
    process.exitCode = 2;
  } else console.log('party-orphans: no blocking orphans.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
