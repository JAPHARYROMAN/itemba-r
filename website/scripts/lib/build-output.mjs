/**
 * Readers for the Next build output (`.next/`), shared by the build-output
 * checkers (check-budgets.mjs, check-html.mjs). The parsing helpers are pure
 * and unit-tested in tests/unit/build-checks.test.ts; only listBuiltHtml and
 * gzipSizeOfFile touch the filesystem.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Gzip size as Next's own build output reports it (gzip level 9).
 * @param {string | Uint8Array} data
 * @returns {number}
 */
export function gzipSize(data) {
  return gzipSync(data, { level: 9 }).length;
}

/** @param {string} file */
export function gzipSizeOfFile(file) {
  return gzipSize(readFileSync(file));
}

/**
 * Route for a prerendered HTML file under `.next/server/app`, e.g.
 * `index.html` -> `/`, `about.html` -> `/about`,
 * `companies/westsides-company.html` -> `/companies/westsides-company`.
 * @param {string} relPath path relative to `.next/server/app` (either slash)
 * @returns {string}
 */
export function routeFromHtmlPath(relPath) {
  const posix = relPath.split(path.sep).join('/').replace(/\\/g, '/').replace(/^\.?\//, '');
  const withoutExt = posix.replace(/\.html$/i, '');
  if (withoutExt === 'index') return '/';
  return `/${withoutExt.replace(/\/index$/, '')}`;
}

/**
 * Every prerendered page under `<distDir>/server/app`, sorted by route.
 * @param {string} distDir the `.next` directory
 * @returns {{ file: string, rel: string, route: string }[]}
 */
export function listBuiltHtml(distDir) {
  const appDir = path.join(distDir, 'server', 'app');
  if (!existsSync(appDir)) return [];
  /** @type {{ file: string, rel: string, route: string }[]} */
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.html')) {
        const rel = path.relative(appDir, full).split(path.sep).join('/');
        out.push({ file: full, rel, route: routeFromHtmlPath(rel) });
      }
    }
  };
  walk(appDir);
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

const TAG_NAME = /<([a-zA-Z][a-zA-Z0-9:-]*)/y;
const ATTR_NAME = /[^\s"'>/=]+/y;
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noembed', 'noframes', 'iframe']);

/**
 * Minimal HTML entity decoding for attribute values (what React and Next emit).
 * @param {string} value
 */
export function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|quot|apos|amp|lt|gt|nbsp);/gi, (m, ent) => {
    const e = ent.toLowerCase();
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'nbsp') return '\u00a0';
    const code = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

/**
 * Walks the start tags of an HTML document without a DOM. Quoted attribute
 * values may contain `>`; comments are skipped; the contents of raw-text
 * elements (script, style, textarea, ...) are skipped, so an RSC payload that
 * mentions `style` or `opacity` is never mistaken for markup.
 *
 * @param {string} html
 * @returns {Generator<{ name: string, attrs: Record<string, string>, start: number, end: number }>}
 */
export function* iterateStartTags(html) {
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) return;
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      i = close === -1 ? n : close + 3;
      continue;
    }
    TAG_NAME.lastIndex = lt;
    const m = TAG_NAME.exec(html);
    if (!m) {
      i = lt + 1;
      continue;
    }
    const name = m[1].toLowerCase();
    /** @type {Record<string, string>} */
    const attrs = {};
    let j = lt + m[0].length;
    while (j < n) {
      const c = html[j];
      if (c === '>') {
        j += 1;
        break;
      }
      if (c === '/' || c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f') {
        j += 1;
        continue;
      }
      ATTR_NAME.lastIndex = j;
      const a = ATTR_NAME.exec(html);
      if (!a) {
        j += 1;
        continue;
      }
      const attrName = a[0].toLowerCase();
      j += a[0].length;
      while (j < n && /\s/.test(html[j])) j += 1;
      let value = '';
      if (html[j] === '=') {
        j += 1;
        while (j < n && /\s/.test(html[j])) j += 1;
        const q = html[j];
        if (q === '"' || q === "'") {
          const close = html.indexOf(q, j + 1);
          const end = close === -1 ? n : close;
          value = html.slice(j + 1, end);
          j = end + 1;
        } else {
          const start = j;
          while (j < n && !/[\s>]/.test(html[j])) j += 1;
          value = html.slice(start, j);
        }
      }
      if (!(attrName in attrs)) attrs[attrName] = decodeEntities(value);
    }
    yield { name, attrs, start: lt, end: j };
    if (RAW_TEXT.has(name)) {
      const closer = new RegExp(`</${name}[\\s/>]`, 'gi');
      closer.lastIndex = j;
      const close = closer.exec(html);
      i = close ? close.index : n;
    } else {
      i = j;
    }
  }
}

/**
 * `/_next/static/chunks/app/%5Bslug%5D/page-1.js?dpl=x` -> `static/chunks/app/[slug]/page-1.js`
 * (relative to `.next`). Returns null for anything that is not a Next static asset.
 * @param {string} url
 */
export function staticAssetPath(url) {
  const clean = url.split('#')[0].split('?')[0];
  const at = clean.indexOf('/_next/static/');
  if (at === -1) return null;
  let rel = clean.slice(at + '/_next/'.length);
  try {
    rel = decodeURIComponent(rel);
  } catch {
    /* keep as-is */
  }
  return rel;
}

/**
 * The first-load assets a prerendered page asks the browser for:
 * module scripts (noModule polyfills excluded, as modern browsers skip them),
 * stylesheets, and preloaded fonts, all as `.next`-relative paths and
 * de-duplicated in document order. `hasEnquiryForm` follows the golden
 * snapshot's convention: an explicit `data-enquiry-router` marker, else any
 * `<form>` (the enquiry form is the only form on the site).
 *
 * @param {string} html
 * @returns {{ scripts: string[], stylesheets: string[], fonts: string[], hasEnquiryForm: boolean }}
 */
export function extractPageAssets(html) {
  const scripts = new Set();
  const stylesheets = new Set();
  const fonts = new Set();
  let hasEnquiryForm = false;
  for (const tag of iterateStartTags(html)) {
    const { name, attrs } = tag;
    if ('data-enquiry-router' in attrs || name === 'form') hasEnquiryForm = true;
    if (name === 'script' && attrs.src && !('nomodule' in attrs)) {
      const rel = staticAssetPath(attrs.src);
      if (rel && rel.endsWith('.js')) scripts.add(rel);
    } else if (name === 'link' && attrs.href) {
      const rel = staticAssetPath(attrs.href);
      if (!rel) continue;
      const relTokens = (attrs.rel || '').toLowerCase().split(/\s+/);
      if (relTokens.includes('stylesheet') && rel.endsWith('.css')) stylesheets.add(rel);
      else if (relTokens.includes('preload') && (attrs.as || '').toLowerCase() === 'font') fonts.add(rel);
      else if (relTokens.includes('preload') && (attrs.as || '').toLowerCase() === 'script' && rel.endsWith('.js')) {
        // A preloaded script is fetched on first load exactly like a script tag.
        scripts.add(rel);
      }
    }
  }
  return { scripts: [...scripts], stylesheets: [...stylesheets], fonts: [...fonts], hasEnquiryForm };
}

/**
 * Parses command-line flags shared by the checkers:
 * `--report-only`, `--dist <dir>`, `--json <file>`, `--root <dir>`.
 * @param {string[]} argv
 */
export function parseCheckerArgs(argv) {
  /** @type {{ reportOnly: boolean, dist: string | null, json: string | null, root: string | null, unknown: string[] }} */
  const out = { reportOnly: false, dist: null, json: null, root: null, unknown: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null];
    const value = () => inline ?? argv[++i] ?? null;
    if (flag === '--report-only') out.reportOnly = true;
    else if (flag === '--dist') out.dist = value();
    else if (flag === '--json') out.json = value();
    else if (flag === '--root') out.root = value();
    else out.unknown.push(arg);
  }
  return out;
}
