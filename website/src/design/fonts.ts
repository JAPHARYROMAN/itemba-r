import localFont from 'next/font/local';

/**
 * Inter variable (OFL), self-hosted and trimmed to what the site sets. See
 * src/assets/fonts/README.md for its provenance and the exact subset.
 * - It has one file with both axes: `wght` 400–900 (body 400, headlines
 *   600, and the print documents' 700–900), and `opsz` 14–32 for the
 *   display cut, which `font-optical-sizing: auto` applies at large sizes
 *   (src/styles/base.css).
 * - Its glyphs are Basic Latin and the punctuation and symbols the copy
 *   uses (tests/unit/design-tokens.test.ts checks the copy against the
 *   subset), with the layout features the site uses (kerning, tabular and
 *   proportional figures, case-sensitive forms). Anything else falls back,
 *   glyph by glyph, to the metric-matched Arial below.
 * - It is the only preloaded font file (34 KB; the budget is 100 KB), and
 *   on the critical path of every page, so every kilobyte counts against
 *   LCP on a slow phone connection.
 * - `adjustFontFallback` sizes an Arial fallback to Inter's metrics, which
 *   keeps the swap from shifting layout.
 * - Exposed as `--font-sans`, which Tailwind's `font-sans` reads.
 */
export const inter = localFont({
  src: '../assets/fonts/InterVariable-latin.woff2',
  weight: '400 900',
  style: 'normal',
  display: 'swap',
  preload: true,
  variable: '--font-sans',
  adjustFontFallback: 'Arial',
});
