#!/usr/bin/env node
/**
 * Scans every prerendered page under .next/server/app for inline
 * `opacity: 0` styles (architecture §3/§7: server HTML never hides content;
 * it would be invisible without JavaScript and would delay LCP). Script and
 * style contents are skipped, so only real markup is judged.
 *
 * Usage: node scripts/check-html.mjs [--report-only] [--dist .next] [--json out.json]
 *   --report-only  print findings, exit 0 (until Phase D)
 * Exit codes: 0 clean (or report-only), 1 findings, 2 no build output.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listBuiltHtml, parseCheckerArgs } from './lib/build-output.mjs';
import { findInlineZeroOpacity } from './lib/html-scan.mjs';

const SHOW_PER_PAGE = 3;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseCheckerArgs(process.argv.slice(2));
if (args.unknown.length) {
  console.error(`[html] Unknown argument(s): ${args.unknown.join(' ')}`);
  process.exit(2);
}
const dist = path.resolve(root, args.dist ?? '.next');

const built = listBuiltHtml(dist);
if (!built.length) {
  console.error(`[html] No prerendered HTML under ${path.join(dist, 'server', 'app')}. Run \`npm run build\` first.`);
  process.exit(2);
}

const findings = built
  .map(({ rel, route, file }) => ({ route, file: rel, hits: findInlineZeroOpacity(readFileSync(file, 'utf8')) }))
  .filter((f) => f.hits.length);
const total = findings.reduce((n, f) => n + f.hits.length, 0);

if (args.json) {
  const out = path.resolve(root, args.json);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ pages: built.length, total, findings }, null, 2)}\n`);
}

if (!total) {
  console.log(`[html] ${built.length} prerendered pages scanned: no inline opacity:0.`);
  process.exit(0);
}

console.log(`[html] Inline opacity:0 in server HTML: ${total} element(s) on ${findings.length} of ${built.length} pages.`);
for (const f of findings) {
  console.log(`  ${f.route} (${f.file}): ${f.hits.length}`);
  for (const hit of f.hits.slice(0, SHOW_PER_PAGE)) console.log(`      ${hit.snippet}`);
  if (f.hits.length > SHOW_PER_PAGE) console.log(`      ... and ${f.hits.length - SHOW_PER_PAGE} more`);
}
console.log('[html] Move entrance effects to CSS (data-reveal); the server must render content visible.');
if (args.reportOnly) {
  console.log('[html] --report-only: not failing (this check becomes blocking in Phase D).');
  process.exit(0);
}
process.exit(1);
