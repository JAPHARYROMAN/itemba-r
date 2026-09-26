import localFont from 'next/font/local';

/**
 * Inter variable (OFL), self-hosted and subset to Latin. See
 * src/assets/fonts/README.md for its provenance.
 * - It has one file with both axes: `wght` 100–900, and `opsz` 14–32 for the
 *   display cut, which `font-optical-sizing: auto` applies at large sizes
 *   (src/styles/base.css).
 * - It is the only preloaded font file (73 KB; the budget is 100 KB).
 * - `adjustFontFallback` sizes an Arial fallback to Inter's metrics, which
 *   keeps the swap from shifting layout.
 * - Exposed as `--font-sans`, which Tailwind's `font-sans` reads.
 */
export const inter = localFont({
  src: '../assets/fonts/InterVariable-latin.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  preload: true,
  variable: '--font-sans',
  adjustFontFallback: 'Arial',
});
