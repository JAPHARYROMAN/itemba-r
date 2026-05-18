#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetDirs = [
  'backend/src/modules/accounting-engine',
  'backend/src/modules/accounting-locks',
  'backend/src/modules/posting-runs',
  'backend/src/modules/period-close',
  'backend/src/modules/bank-reconciliations',
  'backend/src/modules/audit-adjustments',
  'backend/src/modules/three-way-matching',
  'backend/src/modules/analytics-snapshot-runs',
  'backend/src/modules/kpi-snapshots',
  'backend/src/modules/data-isolation-issues',
];

const unsafeRequestPatterns = [
  /@Query\(\)\s+\w+\s*:\s*any/,
  /@Body\(\)\s+\w+\s*:\s*any/,
  /\b(dto|body|query|user)\s*:\s*any\b/,
  /\basync\s+\w+\([^)]*\b(dto|body|query|user)\s*:\s*any\b/,
];

const failures = [];

for (const targetDir of targetDirs) {
  for (const file of walk(resolve(rootDir, targetDir))) {
    if (!file.endsWith('.ts') || file.endsWith('.spec.ts')) continue;
    const text = readFileSync(file, 'utf8');
    const rel = file.slice(rootDir.length + 1).replaceAll('\\', '/');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (unsafeRequestPatterns.some((pattern) => pattern.test(line))) {
        failures.push(`${rel}:${index + 1}: ${line.trim()}`);
      }
    });
  }
}

if (failures.length > 0) {
  console.error(['validate-dto-contract: unsafe request any usage found', ...failures].join('\n'));
  process.exit(1);
}

console.log('validate-dto-contract: OK');

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) yield* walk(path);
    else yield path;
  }
}
