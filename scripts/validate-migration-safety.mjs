#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = resolve(rootDir, 'database/prisma/migrations');

const legacyDestructiveMigrations = new Set([
  '20260424153733_v2_production_schema',
  '20260424175034_expand_loans_debts_schema',
  '20260430144135_w1_pos_removal_sales_order_enrichment',
  '20260517120000_branch_inventory_without_locations',
]);

const destructivePatterns = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bALTER\s+TABLE\b[\s\S]*?\bDROP\s+COLUMN\b/i,
];

const failures = [];

for (const migrationName of readdirSync(migrationsDir)) {
  const migrationPath = join(migrationsDir, migrationName);
  if (!statSync(migrationPath).isDirectory()) continue;

  const sqlPath = join(migrationPath, 'migration.sql');
  let sql = '';
  try {
    sql = readFileSync(sqlPath, 'utf8');
  } catch {
    continue;
  }

  const destructive = destructivePatterns.some((pattern) => pattern.test(sql));
  if (!destructive || legacyDestructiveMigrations.has(migrationName)) continue;

  const hasApprovalMarker = /--\s*destructive-ok:/i.test(sql);
  const hasArchiveStep = /\bCREATE\s+TABLE\s+"?archive_/i.test(sql) || /\bINSERT\s+INTO\s+"?archive_/i.test(sql);
  if (!hasApprovalMarker || !hasArchiveStep) {
    failures.push(
      `${migrationName}: destructive migrations require a -- destructive-ok: marker and an archive_* copy step`,
    );
  }
}

if (failures.length > 0) {
  console.error(['validate-migration-safety: failed', ...failures].join('\n'));
  process.exit(1);
}

console.log('validate-migration-safety: OK');
