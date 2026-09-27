#!/usr/bin/env node
/**
 * Summarises a Lighthouse CI run (the lhr-*.json reports `lhci autorun`
 * leaves in .lighthouseci/) against the budgets in lighthouserc.json: the
 * median run per URL (by performance score, as lhci's median-run), its LCP,
 * CLS, TBT and category scores, and every budget it misses. On GitHub
 * Actions the table goes to the job summary and each miss becomes a
 * `::warning::` annotation, so a miss is visible on the run even while the
 * Lighthouse job is non-blocking.
 *
 *   node scripts/lighthouse-summary.mjs [--dir .lighthouseci]
 *
 * Always exits 0: `lhci autorun` is the gate; this only reports.
 */
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirArg = process.argv.indexOf('--dir');
const dir = path.resolve(root, dirArg > -1 ? (process.argv[dirArg + 1] ?? '.lighthouseci') : '.lighthouseci');

const config = JSON.parse(readFileSync(path.join(root, 'lighthouserc.json'), 'utf8'));
const assertions = config.ci?.assert?.assertions ?? {};
const limit = (id, key) => assertions[id]?.[1]?.[key];

if (!existsSync(dir)) {
  console.log(`[lighthouse] No reports in ${path.relative(root, dir)}.`);
  process.exit(0);
}
const reports = readdirSync(dir)
  .filter((file) => /^lhr-.*\.json$/.test(file))
  .map((file) => JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
if (!reports.length) {
  console.log(`[lighthouse] No lhr-*.json reports in ${path.relative(root, dir)}.`);
  process.exit(0);
}

/** @type {Map<string, any[]>} */
const byUrl = new Map();
for (const lhr of reports) {
  const url = new URL(lhr.requestedUrl).pathname;
  byUrl.set(url, [...(byUrl.get(url) ?? []), lhr]);
}

const lines = [
  '### Lighthouse (mobile, median run)',
  '',
  '| URL | LCP | CLS | TBT | Perf | A11y | SEO | Misses |',
  '|---|---|---|---|---|---|---|---|',
];
const warnings = [];
for (const [url, runs] of byUrl) {
  const sorted = [...runs].sort((a, b) => (a.categories.performance.score ?? 0) - (b.categories.performance.score ?? 0));
  const lhr = sorted[Math.floor(sorted.length / 2)];
  const audit = (id) => lhr.audits[id]?.numericValue ?? NaN;
  const score = (id) => lhr.categories[id]?.score ?? NaN;
  const lcp = audit('largest-contentful-paint');
  const cls = audit('cumulative-layout-shift');
  const tbt = audit('total-blocking-time');
  const misses = [];
  const over = (value, id, label, unit = '') => {
    const max = limit(id, 'maxNumericValue');
    if (max !== undefined && value > max) misses.push(`${label} ${value.toFixed(unit ? 0 : 3)}${unit} > ${max}${unit}`);
  };
  const under = (value, id, label) => {
    const min = limit(id, 'minScore');
    if (min !== undefined && value < min) misses.push(`${label} ${value} < ${min}`);
  };
  over(lcp, 'largest-contentful-paint', 'LCP', ' ms');
  over(cls, 'cumulative-layout-shift', 'CLS');
  over(tbt, 'total-blocking-time', 'TBT', ' ms');
  under(score('performance'), 'categories:performance', 'Performance');
  under(score('accessibility'), 'categories:accessibility', 'Accessibility');
  under(score('seo'), 'categories:seo', 'SEO');
  lines.push(
    `| \`${url}\` | ${Math.round(lcp)} ms | ${cls.toFixed(3)} | ${Math.round(tbt)} ms | ${score('performance')} | ${score('accessibility')} | ${score('seo')} | ${misses.join('; ') || 'none'} |`,
  );
  for (const miss of misses) warnings.push(`${url}: ${miss}`);
}
lines.push('', `${warnings.length} budget miss(es) across ${byUrl.size} URL(s).`, '');

console.log(lines.join('\n'));
if (process.env.GITHUB_ACTIONS) {
  for (const warning of warnings) console.log(`::warning title=Lighthouse budget::${warning}`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
  } catch {
    /* the summary is a convenience */
  }
}
