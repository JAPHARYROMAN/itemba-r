# Fonts

These fonts are Inter 4.1 by The Inter Project Authors, used under the SIL Open Font License 1.1 (see `OFL.txt`). They come from the official release, <https://github.com/rsms/inter/releases/tag/v4.1> (`Inter-4.1.zip`, sha256 `9883fdd4…b11e`), and were cut down with fontTools 4.60.1.

| File | Source in the release | Use |
|---|---|---|
| `InterVariable-latin.woff2` | `web/InterVariable.woff2`, instanced to axes `opsz` 14–32 and `wght` 400–900 | Site typeface, through `next/font/local` in `src/design/fonts.ts`. It is the only preloaded font (34 KB). |
| `og/Inter-Regular.ttf` | `extras/ttf/Inter-Regular.ttf` | OG cards (satori needs static TTF) |
| `og/Inter-SemiBold.ttf` | `extras/ttf/Inter-SemiBold.ttf` | OG cards: eyebrows |
| `og/InterDisplay-SemiBold.ttf` | `extras/ttf/InterDisplay-SemiBold.ttf` | OG cards: headlines |

The site font is on the critical path of every page, so it carries only what the site sets:

- Weights 400 to 900. Body copy is 400, headlines and labels 600, and the print documents (and so the four profile PDFs) use 700, 800 and 900. Nothing uses a weight under 400.
- Both axes stay variable, so `font-optical-sizing: auto` (set in `src/styles/base.css`) still switches to the display cut at large sizes.
- The glyphs are Basic Latin plus the punctuation and symbols the copy uses: the no-break space, `© ® ° · ×`, the dashes, quotes, bullets and ellipsis (including the non-breaking hyphen that `keepCompounds` sets), `‹ ›`, the fraction slash, the euro sign, trade mark, the arrows `← ↑ → ↓ ↖ ↗ ↘ ↙`, minus and `✓`. There are no accented letters, because the copy has none. If a visitor types a character outside the subset (in a name in the enquiry form, say), that glyph renders in the metric-matched Arial fallback. `tests/unit/design-tokens.test.ts` fails if the copy uses a character outside the subset.
- The layout features are the ones the site uses: kerning, tabular and proportional figures (`tnum`, `pnum`), case-sensitive forms (`case`), contextual alternates (`calt`) and `locl`. The fraction, numerator and denominator forms are left out.

```sh
UNI="U+0000-007E,U+00A0,U+00A9,U+00AE,U+00B0,U+00B7,U+00D7,U+2002-200B,U+2010-2027,U+202F,U+2030,U+2032-2033,U+2039-203A,U+2044,U+2060,U+20AC,U+2122,U+2190-2193,U+2196-2199,U+2212,U+2215,U+2713,U+2715,U+FEFF,U+FFFD"
fonttools varLib.instancer web/InterVariable.woff2 wght=400:900 -o InterVariable-400-900.ttf
pyftsubset InterVariable-400-900.ttf --unicodes="$UNI" \
  --layout-features='calt,ccmp,kern,locl,mark,mkmk,case,tnum,pnum,rvrn' \
  --flavor=woff2 --no-hinting --output-file=InterVariable-latin.woff2
```

The OG fonts keep the earlier, wider Latin subset. Browsers never download them.

```sh
UNI_OG="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2196-2199,U+2212,U+2215,U+2713,U+2715,U+FEFF,U+FFFD"
pyftsubset extras/ttf/<Name>.ttf --unicodes="$UNI_OG" --no-hinting --output-file=og/<Name>.ttf
```

The site font is a PDF input (`scripts/lib/pdf-inputs.mjs`), because the profile PDFs are set in it. Replacing it means running `npm run pdf` and then `npm run pdf:lock`.
