/**
 * Built-HTML scan: server-rendered markup must never carry an inline
 * `opacity: 0` (architecture §3 and §7). Content hidden that way is invisible
 * without JavaScript and delays LCP; entrance effects belong in CSS
 * (`data-reveal` under `animation-timeline: view()`), never in the HTML.
 * Pure; unit-tested in tests/unit/build-checks.test.ts.
 */
import { iterateStartTags } from './build-output.mjs';

/**
 * Splits a style attribute into declarations, respecting quotes and parens
 * (so `url("a;b")` stays in one piece).
 * @param {string} style
 * @returns {string[]}
 */
export function splitDeclarations(style) {
  const out = [];
  let depth = 0;
  /** @type {string | null} */
  let quote = null;
  let start = 0;
  for (let i = 0; i < style.length; i += 1) {
    const c = style[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) {
      out.push(style.slice(start, i));
      start = i + 1;
    }
  }
  out.push(style.slice(start));
  return out.map((d) => d.trim()).filter(Boolean);
}

/**
 * True for any spelling of a zero opacity: `0`, `0.0`, `.0`, `-0`, `0%`,
 * optionally `!important`. Non-literal values (`var(...)`, `calc(...)`) are
 * not treated as zero.
 * @param {string} value
 */
export function isZeroOpacity(value) {
  const v = value
    .replace(/!\s*important\s*$/i, '')
    .trim()
    .toLowerCase();
  return /^[+-]?(?:0+(?:\.0*)?|\.0+)%?$/.test(v);
}

/**
 * Every start tag whose inline style sets opacity to zero. Script and style
 * contents (the RSC payload, CSS keyframes) are not markup and are skipped.
 * @param {string} html
 * @returns {{ tag: string, style: string, offset: number, snippet: string }[]}
 */
export function findInlineZeroOpacity(html) {
  const hits = [];
  for (const tag of iterateStartTags(html)) {
    const style = tag.attrs.style;
    if (!style) continue;
    const zero = splitDeclarations(style).some((decl) => {
      const colon = decl.indexOf(':');
      if (colon === -1) return false;
      return decl.slice(0, colon).trim().toLowerCase() === 'opacity' && isZeroOpacity(decl.slice(colon + 1));
    });
    if (zero) {
      const raw = html.slice(tag.start, tag.end);
      hits.push({
        tag: tag.name,
        style,
        offset: tag.start,
        snippet: raw.length > 180 ? `${raw.slice(0, 177)}...` : raw,
      });
    }
  }
  return hits;
}
