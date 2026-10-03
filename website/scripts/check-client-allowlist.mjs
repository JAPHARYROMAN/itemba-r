#!/usr/bin/env node
/**
 * Fails when a module under src/ declares `'use client'` outside the
 * allowlist (architecture §3): src/islands/**, the frozen legacy client files
 * (ConversionTracker, CompanyProfilePrintScope), and the error boundaries
 * Next.js requires to be client components (app error.tsx, global-error.tsx).
 * Only a real directive counts; a mention in a comment or string does not.
 *
 * Usage: node scripts/check-client-allowlist.mjs [--report-only] [--root <website dir>] [--json out.json]
 *   --report-only  print findings, exit 0 (until Phase D removes the legacy components)
 * Exit codes: 0 clean (or report-only), 1 findings, 2 no src/ directory.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCheckerArgs } from './lib/build-output.mjs';
import { SOURCE_FILE, hasUseClientDirective, isClientAllowed } from './lib/client-directive.mjs';

const args = parseCheckerArgs(process.argv.slice(2));
if (args.unknown.length || args.dist) {
  console.error(`[client] Unknown argument(s): ${[...args.unknown, ...(args.dist ? ['--dist'] : [])].join(' ')}`);
  process.exit(2);
}
const root = args.root
  ? path.resolve(args.root)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
if (!existsSync(srcDir)) {
  console.error(`[client] No src/ directory under ${root}.`);
  process.exit(2);
}

/** @returns {string[]} website-relative POSIX paths */
function listSources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSources(full));
    else if (entry.isFile() && SOURCE_FILE.test(entry.name)) out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}

const clientFiles = listSources(srcDir)
  .filter((rel) => hasUseClientDirective(readFileSync(path.join(root, rel), 'utf8')))
  .sort();
const allowed = clientFiles.filter((rel) => isClientAllowed(rel));
const violations = clientFiles.filter((rel) => !isClientAllowed(rel));

if (args.json) {
  const out = path.resolve(root, args.json);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ clientFiles, allowed, violations }, null, 2)}\n`);
}

console.log(`[client] ${clientFiles.length} client module(s) under src/; ${allowed.length} allowed.`);
for (const rel of allowed) console.log(`    ok  ${rel}`);
if (!violations.length) {
  console.log('[client] Every client component is an island or on the allowlist.');
  process.exit(0);
}
console.log(`[client] ${violations.length} 'use client' module(s) outside src/islands/ and the allowlist:`);
for (const rel of violations) console.log(`  - ${rel}`);
console.log('[client] Make it a server component, or move the interactive part into src/islands/.');
if (args.reportOnly) {
  console.log('[client] --report-only: not failing (this check becomes blocking in Phase D).');
  process.exit(0);
}
process.exit(1);
