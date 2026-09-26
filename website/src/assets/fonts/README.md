# Fonts

These fonts are Inter 4.1 by The Inter Project Authors, used under the SIL Open Font License 1.1 (see `OFL.txt`). They come from the official release, <https://github.com/rsms/inter/releases/tag/v4.1> (`Inter-4.1.zip`, sha256 `9883fdd4…b11e`), and were subset to Latin with fontTools 4.60.1 `pyftsubset`.

| File | Source in the release | Use |
|---|---|---|
| `InterVariable-latin.woff2` | `web/InterVariable.woff2` (axes `opsz` 14–32, `wght` 100–900) | Site typeface, through `next/font/local` in `src/design/fonts.ts`. It is the only preloaded font. |
| `og/Inter-Regular.ttf` | `extras/ttf/Inter-Regular.ttf` | OG cards (satori needs static TTF) |
| `og/Inter-SemiBold.ttf` | `extras/ttf/Inter-SemiBold.ttf` | OG cards: eyebrows |
| `og/InterDisplay-SemiBold.ttf` | `extras/ttf/InterDisplay-SemiBold.ttf` | OG cards: headlines |

The subset covers Basic Latin, Latin-1, the general punctuation block (dashes, quotes, `‹ ›`, ellipsis), the euro sign, trade mark, minus, arrows `← ↑ → ↓ ↖ ↗ ↘ ↙`, `✓` and `✕`:

```sh
UNI="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2196-2199,U+2212,U+2215,U+2713,U+2715,U+FEFF,U+FFFD"
pyftsubset web/InterVariable.woff2 --unicodes="$UNI" --layout-features+=tnum,case,pnum \
  --flavor=woff2 --no-hinting --output-file=InterVariable-latin.woff2
pyftsubset extras/ttf/<Name>.ttf --unicodes="$UNI" --no-hinting --output-file=og/<Name>.ttf
```

The variable font keeps both axes. `font-optical-sizing: auto` (set in `src/styles/base.css`) switches to the display cut at large sizes. Its layout features are `calt case ccmp dnom frac locl numr pnum tnum` (GSUB) and `kern mark mkmk` (GPOS).
