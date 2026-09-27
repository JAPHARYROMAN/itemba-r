/**
 * Performance budgets of the rebuilt site (architecture §7), evaluated from
 * what each prerendered page actually asks the browser for on first load.
 * Pure: the caller supplies per-page asset lists and a size table.
 *
 * Units: 1 kB = 1000 bytes, the same unit `next build` prints. JS and CSS are
 * measured gzipped (level 9, as Next does); fonts are woff2 (already
 * compressed) and measured raw; HTML is measured gzipped.
 */

export const KB = 1000;

export const BUDGETS = Object.freeze({
  /**
   * JS every page loads (the intersection of all pages' scripts).
   *
   * The plan's 110 kB is below what Next 15.5 itself ships to every page of
   * this site before any of its own code: the framework runtime (react-dom,
   * the app router, webpack, main-app: 102.6 kB) plus next/link (3.4 kB;
   * client-side navigation, which the page_view contract needs) and the
   * next/image client (5.2 kB; every page imports the photo kit) is
   * 111.2 kB. On top of that every page carries the site's own shared code:
   * the layout islands (global nav, quick-contact route gate,
   * ConversionTracker, the frozen Analytics' next/script) and the two error
   * boundaries Next loads with the root, 8.7 kB at the Phase D integration
   * (down from 13.3 kB). So the shared line is 122 kB, and the plan's
   * per-page totals (110 + 15 and 110 + 25 kB) are enforced as first-load
   * budgets below instead.
   */
  sharedJs: 122 * KB,
  /** JS a page loads on top of the shared set. */
  routeJs: 15 * KB,
  /** Route JS allowance on pages with the EnquiryRouter and on /company-profile. */
  routeJsLarge: 25 * KB,
  /** All the JS a page loads first (shared + route): the plan's 110 + 15 kB. */
  firstLoadJs: 125 * KB,
  /** First-load JS on pages with the EnquiryRouter and on /company-profile: the plan's 110 + 25 kB. */
  firstLoadJsLarge: 135 * KB,
  /** Stylesheets a page loads. */
  css: 30 * KB,
  /** Preloaded font files per page, and their total bytes. */
  fontFiles: 2,
  fontBytes: 100 * KB,
  /** Prerendered HTML document. */
  html: 40 * KB,
  htmlLarge: 90 * KB,
});

/**
 * Prerendered routes that never ship as pages, so they are not measured:
 * /__kit, the UI-kit catalogue, is a 404 in production builds (its HTML is
 * an error shell with none of the layout's scripts, which would shrink the
 * "shared" set, the scripts every page loads, to the framework alone).
 */
export const UNMEASURED_ROUTES = Object.freeze(['/__kit']);

/** Routes that always get the larger route-JS allowance. */
export const LARGE_JS_ROUTES = Object.freeze(['/company-profile']);
/** Routes that get the larger HTML allowance (the print documents live in the page). */
export const LARGE_HTML_ROUTES = Object.freeze(['/company-profile']);

/**
 * @typedef {{
 *   route: string,
 *   scripts: string[],
 *   stylesheets: string[],
 *   fonts: string[],
 *   hasEnquiryForm: boolean,
 *   htmlGzip: number,
 * }} PageInput
 *
 * @typedef {{ metric: string, route: string | null, actual: number, limit: number, message: string }} Violation
 *
 * @typedef {{
 *   route: string,
 *   hasEnquiryForm: boolean,
 *   routeJs: number, routeJsLimit: number, routeFiles: { file: string, bytes: number }[],
 *   firstLoadJs: number, firstLoadJsLimit: number,
 *   css: number, cssLimit: number,
 *   fontFiles: number, fontBytes: number,
 *   html: number, htmlLimit: number,
 * }} RouteRow
 */

/** @param {number} bytes */
export function formatKb(bytes) {
  return `${(bytes / KB).toFixed(1)} kB`;
}

/** @param {number[]} values */
const sum = (values) => values.reduce((total, v) => total + v, 0);

/**
 * @param {{
 *   pages: PageInput[],
 *   sizes: Record<string, number>,
 *   budgets?: typeof BUDGETS,
 *   expectedRoutes?: readonly string[],
 * }} input expectedRoutes: routes that must have been measured (a route
 *   rendered dynamically has no prerendered HTML and would escape the budgets).
 */
export function evaluateBudgets({ pages, sizes, budgets = BUDGETS, expectedRoutes = [] }) {
  if (!pages.length) throw new Error('evaluateBudgets: no prerendered pages to measure.');
  /** @param {string} file */
  const sizeOf = (file) => {
    const bytes = sizes[file];
    if (typeof bytes !== 'number') throw new Error(`evaluateBudgets: no size recorded for ${file}`);
    return bytes;
  };

  // Shared first-load JS: the scripts present on every page, in first-page order.
  const sharedSet = new Set(pages[0].scripts);
  for (const page of pages.slice(1)) {
    const own = new Set(page.scripts);
    for (const file of [...sharedSet]) if (!own.has(file)) sharedSet.delete(file);
  }
  const sharedFiles = pages[0].scripts.filter((f) => sharedSet.has(f)).map((file) => ({ file, bytes: sizeOf(file) }));
  const sharedJs = sum(sharedFiles.map((f) => f.bytes));

  /** @type {Violation[]} */
  const violations = [];
  const measured = new Set(pages.map((p) => p.route));
  for (const route of expectedRoutes) {
    if (!measured.has(route)) {
      violations.push({
        metric: 'coverage',
        route,
        actual: 0,
        limit: 0,
        message: `${route}: no prerendered HTML, so its budgets were not measured (rendered dynamically?)`,
      });
    }
  }
  if (sharedJs > budgets.sharedJs) {
    violations.push({
      metric: 'shared-js',
      route: null,
      actual: sharedJs,
      limit: budgets.sharedJs,
      message: `Shared first-load JS ${formatKb(sharedJs)} exceeds ${formatKb(budgets.sharedJs)}`,
    });
  }

  /** @type {RouteRow[]} */
  const rows = pages.map((page) => {
    const routeFiles = page.scripts.filter((f) => !sharedSet.has(f)).map((file) => ({ file, bytes: sizeOf(file) }));
    const routeJs = sum(routeFiles.map((f) => f.bytes));
    const large = page.hasEnquiryForm || LARGE_JS_ROUTES.includes(page.route);
    return {
      route: page.route,
      hasEnquiryForm: page.hasEnquiryForm,
      routeJs,
      routeJsLimit: large ? budgets.routeJsLarge : budgets.routeJs,
      routeFiles,
      firstLoadJs: sharedJs + routeJs,
      firstLoadJsLimit: large ? budgets.firstLoadJsLarge : budgets.firstLoadJs,
      css: sum(page.stylesheets.map(sizeOf)),
      cssLimit: budgets.css,
      fontFiles: page.fonts.length,
      fontBytes: sum(page.fonts.map(sizeOf)),
      html: page.htmlGzip,
      htmlLimit: LARGE_HTML_ROUTES.includes(page.route) ? budgets.htmlLarge : budgets.html,
    };
  });

  for (const row of rows) {
    if (row.routeJs > row.routeJsLimit) {
      violations.push({
        metric: 'route-js',
        route: row.route,
        actual: row.routeJs,
        limit: row.routeJsLimit,
        message: `${row.route}: route JS ${formatKb(row.routeJs)} exceeds ${formatKb(row.routeJsLimit)}`,
      });
    }
    if (row.firstLoadJs > row.firstLoadJsLimit) {
      violations.push({
        metric: 'first-load-js',
        route: row.route,
        actual: row.firstLoadJs,
        limit: row.firstLoadJsLimit,
        message: `${row.route}: first-load JS ${formatKb(row.firstLoadJs)} exceeds ${formatKb(row.firstLoadJsLimit)}`,
      });
    }
    if (row.css > row.cssLimit) {
      violations.push({
        metric: 'css',
        route: row.route,
        actual: row.css,
        limit: row.cssLimit,
        message: `${row.route}: CSS ${formatKb(row.css)} exceeds ${formatKb(row.cssLimit)}`,
      });
    }
    if (row.fontFiles > budgets.fontFiles) {
      violations.push({
        metric: 'font-files',
        route: row.route,
        actual: row.fontFiles,
        limit: budgets.fontFiles,
        message: `${row.route}: ${row.fontFiles} preloaded font files exceed ${budgets.fontFiles}`,
      });
    }
    if (row.fontBytes > budgets.fontBytes) {
      violations.push({
        metric: 'font-bytes',
        route: row.route,
        actual: row.fontBytes,
        limit: budgets.fontBytes,
        message: `${row.route}: preloaded fonts ${formatKb(row.fontBytes)} exceed ${formatKb(budgets.fontBytes)}`,
      });
    }
    if (row.html > row.htmlLimit) {
      violations.push({
        metric: 'html',
        route: row.route,
        actual: row.html,
        limit: row.htmlLimit,
        message: `${row.route}: HTML ${formatKb(row.html)} exceeds ${formatKb(row.htmlLimit)}`,
      });
    }
  }

  return { sharedJs: { bytes: sharedJs, limit: budgets.sharedJs, files: sharedFiles }, rows, violations };
}

/**
 * Plain-text report for the terminal.
 * @param {ReturnType<typeof evaluateBudgets>} report
 */
export function formatBudgetTable(report) {
  const flag = (actual, limit) => (actual > limit ? ' !' : '  ');
  const pad = (s, w) => String(s).padEnd(w);
  const lpad = (s, w) => String(s).padStart(w);
  const width = Math.max(28, ...report.rows.map((r) => r.route.length + 2));
  const lines = [];
  lines.push(
    `Shared first-load JS: ${formatKb(report.sharedJs.bytes)} / ${formatKb(report.sharedJs.limit)}${flag(report.sharedJs.bytes, report.sharedJs.limit)}`,
  );
  for (const f of report.sharedJs.files) lines.push(`    ${lpad(formatKb(f.bytes), 9)}  ${f.file}`);
  lines.push('');
  lines.push(
    `${pad('Route', width)}${lpad('route JS', 22)}${lpad('first load', 24)}${lpad('CSS', 22)}${lpad('HTML', 22)}${lpad('fonts', 14)}`,
  );
  for (const r of report.rows) {
    const cell = (actual, limit) => `${formatKb(actual)} / ${formatKb(limit)}${flag(actual, limit)}`;
    lines.push(
      `${pad(r.route + (r.hasEnquiryForm ? ' *' : ''), width)}${lpad(cell(r.routeJs, r.routeJsLimit), 22)}${lpad(cell(r.firstLoadJs, r.firstLoadJsLimit), 24)}${lpad(cell(r.css, r.cssLimit), 22)}${lpad(cell(r.html, r.htmlLimit), 22)}${lpad(`${r.fontFiles} / ${formatKb(r.fontBytes)}`, 14)}`,
    );
  }
  lines.push('');
  lines.push('* page carries the enquiry form (route JS 25 kB, first load 135 kB). ! = over budget. 1 kB = 1000 B, gzip level 9.');
  return lines.join('\n');
}

/**
 * GitHub step-summary Markdown.
 * @param {ReturnType<typeof evaluateBudgets>} report
 * @param {{ reportOnly: boolean }} options
 */
export function formatBudgetMarkdown(report, { reportOnly }) {
  const mark = (actual, limit) => (actual > limit ? '**over**' : 'ok');
  const lines = [
    `### Website budgets${reportOnly ? ' (report-only)' : ''}`,
    '',
    `Shared first-load JS: **${formatKb(report.sharedJs.bytes)}** / ${formatKb(report.sharedJs.limit)} ${mark(report.sharedJs.bytes, report.sharedJs.limit)}`,
    '',
    '| Route | Route JS | First load | CSS | HTML | Fonts |',
    '|---|---|---|---|---|---|',
  ];
  for (const r of report.rows) {
    lines.push(
      `| \`${r.route}\`${r.hasEnquiryForm ? ' (form)' : ''} | ${formatKb(r.routeJs)} / ${formatKb(r.routeJsLimit)} ${mark(r.routeJs, r.routeJsLimit)} | ${formatKb(r.firstLoadJs)} / ${formatKb(r.firstLoadJsLimit)} ${mark(r.firstLoadJs, r.firstLoadJsLimit)} | ${formatKb(r.css)} / ${formatKb(r.cssLimit)} ${mark(r.css, r.cssLimit)} | ${formatKb(r.html)} / ${formatKb(r.htmlLimit)} ${mark(r.html, r.htmlLimit)} | ${r.fontFiles} / ${formatKb(r.fontBytes)} |`,
    );
  }
  lines.push('', `${report.violations.length} violation(s).`, '');
  return lines.join('\n');
}
