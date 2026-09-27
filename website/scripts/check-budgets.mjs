#!/usr/bin/env node
/**
 * Bundle and HTML budgets (architecture §7), measured from the Next build
 * output: for every prerendered page under .next/server/app, the scripts,
 * stylesheets and preloaded fonts its HTML asks the browser for on first load.
 *
 *   shared first-load JS (on every page)   <= 122 kB gzip (why not 110: scripts/lib/budgets.mjs)
 *   route JS (on top of the shared set)    <=  15 kB gzip
 *     pages with the enquiry form, and /company-profile   <= 25 kB
 *   first-load JS (shared + route)         <= 125 kB gzip
 *     pages with the enquiry form, and /company-profile   <= 135 kB
 *   CSS per page                           <=  30 kB gzip
 *   preloaded fonts per page               <= 2 files, <= 100 kB
 *   HTML per page                          <=  40 kB gzip (90 kB /company-profile)
 *   every sitemap URL is prerendered (otherwise it escapes these budgets)
 *
 * Usage: node scripts/check-budgets.mjs [--report-only] [--dist .next] [--json out.json]
 *   --report-only  print everything, exit 0 on budget violations (`npm run budget` enforces)
 * Exit codes: 0 ok (or report-only), 1 over budget, 2 no/broken build output.
 * On GitHub Actions the table is also appended to the job summary.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPageAssets, gzipSize, gzipSizeOfFile, listBuiltHtml, parseCheckerArgs } from './lib/build-output.mjs';
import { BUDGETS, UNMEASURED_ROUTES, evaluateBudgets, formatBudgetMarkdown, formatBudgetTable } from './lib/budgets.mjs';
import { SITEMAP_PATHS } from './lib/routes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseCheckerArgs(process.argv.slice(2));
if (args.unknown.length) {
  console.error(`[budget] Unknown argument(s): ${args.unknown.join(' ')}`);
  process.exit(2);
}
const dist = path.resolve(root, args.dist ?? '.next');

const built = listBuiltHtml(dist).filter(({ route }) => !UNMEASURED_ROUTES.includes(route));
if (!built.length) {
  console.error(`[budget] No prerendered HTML under ${path.join(dist, 'server', 'app')}. Run \`npm run build\` first.`);
  process.exit(2);
}

/** @type {Record<string, number>} */
const sizes = {};
const missing = [];
const pages = built.map(({ file, route }) => {
  const buf = readFileSync(file);
  const assets = extractPageAssets(buf.toString('utf8'));
  const measure = (rel, gzip) => {
    if (rel in sizes) return;
    const full = path.join(dist, rel);
    if (!existsSync(full)) {
      missing.push(`${route}: ${rel}`);
      sizes[rel] = 0;
      return;
    }
    sizes[rel] = gzip ? gzipSizeOfFile(full) : statSync(full).size;
  };
  for (const rel of [...assets.scripts, ...assets.stylesheets]) measure(rel, true);
  for (const rel of assets.fonts) measure(rel, false); // woff2 is already compressed
  return { route, ...assets, htmlGzip: gzipSize(buf) };
});

if (missing.length) {
  console.error(`[budget] The build output is inconsistent: pages reference assets that do not exist:\n  ${missing.join('\n  ')}`);
  process.exit(2);
}

const report = evaluateBudgets({ pages, sizes, budgets: BUDGETS, expectedRoutes: SITEMAP_PATHS });
const buildIdFile = path.join(dist, 'BUILD_ID');
const buildId = existsSync(buildIdFile) ? readFileSync(buildIdFile, 'utf8').trim() : 'unknown';

console.log(`[budget] ${path.relative(root, dist) || dist} (BUILD_ID ${buildId}), ${pages.length} prerendered pages\n`);
console.log(formatBudgetTable(report));

if (args.json) {
  const out = path.resolve(root, args.json);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify({ buildId, reportOnly: args.reportOnly, budgets: BUDGETS, ...report }, null, 2)}\n`,
  );
  console.log(`\n[budget] JSON report written to ${path.relative(root, out)}`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, formatBudgetMarkdown(report, { reportOnly: args.reportOnly }));
  } catch {
    /* the summary is a convenience */
  }
}

if (!report.violations.length) {
  console.log('\n[budget] All budgets met.');
  process.exit(0);
}
console.log(`\n[budget] ${report.violations.length} violation(s):`);
for (const v of report.violations) console.log(`  - ${v.message}`);
if (args.reportOnly) {
  console.log('[budget] --report-only: not failing.');
  process.exit(0);
}
process.exit(1);
