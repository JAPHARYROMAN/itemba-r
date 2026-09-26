/**
 * Server-first rule (architecture §3): client components live only in
 * `src/islands/`, plus the frozen legacy client files that can never be
 * edited or moved, plus the special files Next.js itself requires to be
 * Client Components. Pure; unit-tested in tests/unit/build-checks.test.ts.
 */

export const ISLANDS_DIR = 'src/islands/';

/** Byte-for-byte frozen files that are (and must stay) client components. */
export const FROZEN_CLIENT_FILES = Object.freeze([
  'src/components/ConversionTracker.tsx',
  'src/components/CompanyProfilePrintScope.tsx',
]);

/**
 * `error.tsx` (any segment) and `global-error.tsx` must carry the directive
 * in the file itself: Next rejects a server `error.tsx`, even one that only
 * re-exports an island.
 */
export const FRAMEWORK_CLIENT_FILE = /^src\/app\/(?:.+\/)?error\.(?:tsx|ts|jsx|js)$|^src\/app\/global-error\.(?:tsx|ts|jsx|js)$/;

export const SOURCE_FILE = /\.(?:tsx|ts|jsx|js|mjs|cjs|mts|cts)$/;

/**
 * @param {string} relPath path relative to the website root, either slash
 * @returns {boolean}
 */
export function isClientAllowed(relPath) {
  const p = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  return p.startsWith(ISLANDS_DIR) || FROZEN_CLIENT_FILES.includes(p) || FRAMEWORK_CLIENT_FILE.test(p);
}

const LINE_BREAK = /[\n\r\u2028\u2029]/;
/** Characters that let an expression continue onto the next line (no ASI). */
const CONTINUATION = new Set(['.', '[', '(', '+', '-', '*', '/', '%', ',', '?', ':', '=', '<', '>', '&', '|', '^', '`']);

/**
 * @param {string} s
 * @param {number} i
 */
function skipTrivia(s, i) {
  let sawNewline = false;
  while (i < s.length) {
    const c = s[i];
    if (LINE_BREAK.test(c)) {
      sawNewline = true;
      i += 1;
    } else if (c === ' ' || c === '\t' || c === '\v' || c === '\f' || c === '\u00a0' || c === '\ufeff') {
      i += 1;
    } else if (s.startsWith('//', i)) {
      const nl = s.indexOf('\n', i);
      i = nl === -1 ? s.length : nl;
    } else if (s.startsWith('/*', i)) {
      const end = s.indexOf('*/', i + 2);
      if (end === -1) return { i: s.length, sawNewline };
      if (LINE_BREAK.test(s.slice(i, end))) sawNewline = true;
      i = end + 2;
    } else break;
  }
  return { i, sawNewline };
}

/**
 * True when the module's directive prologue contains `'use client'` (either
 * quote style, with or without a semicolon, after any comments, a BOM, a
 * hashbang or other directives such as `'use strict'`). A mention anywhere
 * else (a comment, a string later in the file) is not a directive.
 * @param {string} source
 * @returns {boolean}
 */
export function hasUseClientDirective(source) {
  let i = 0;
  if (source.startsWith('\ufeff')) i = 1;
  if (source.startsWith('#!', i)) {
    const nl = source.indexOf('\n', i);
    if (nl === -1) return false;
    i = nl;
  }
  for (;;) {
    i = skipTrivia(source, i).i;
    const quote = source[i];
    if (quote !== '"' && quote !== "'") return false;
    let j = i + 1;
    while (j < source.length && source[j] !== quote) {
      if (source[j] === '\\') j += 1;
      else if (LINE_BREAK.test(source[j])) return false;
      j += 1;
    }
    if (j >= source.length) return false;
    const raw = source.slice(i + 1, j);
    const after = skipTrivia(source, j + 1);
    const next = source[after.i];
    let end = after.i;
    let statement = false;
    if (next === ';') {
      statement = true;
      end += 1;
    } else if (next === undefined || next === '}') {
      statement = true;
    } else if (after.sawNewline && !CONTINUATION.has(next)) {
      statement = true; // automatic semicolon insertion
    }
    if (!statement) return false; // e.g. `'use client'.length`: an expression, and the prologue ends
    if (raw === 'use client') return true;
    i = end;
  }
}
