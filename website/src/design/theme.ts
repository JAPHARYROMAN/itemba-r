/**
 * Turns src/design/tokens.ts into the Tailwind theme and the CSS variables
 * written by the Tailwind plugin (tailwind.config.ts).
 *
 * Colour variables hold bare RGB channels ("29 29 31"), so Tailwind can add
 * opacity: `rgb(var(--fg) / <alpha-value>)`.
 *
 * - `:root` holds the light tone, the group-gold accent, and the layout
 *   variables.
 * - `[data-tone="light|alt|cinema"]` re-maps the semantic colours for
 *   everything inside it. base.css paints each tone element with its own
 *   surface and text colour.
 * - `[data-accent="group|mwanjalisi|westsides|enterprises"]` swaps the
 *   accent swatch. The tone decides which slot of the swatch is the text
 *   colour, so put `data-accent` on a tone element or on an ancestor of tone
 *   elements. Outside any tone element, text keeps the tone it inherited,
 *   which is always AA-safe.
 *
 * Relative imports only: jiti loads this file for tailwind.config.ts, and it
 * does not resolve the `@/` alias.
 */
import {
  accents,
  breakpoints,
  chrome,
  containers,
  fontFamily,
  gutter,
  materials,
  motion,
  radii,
  sectionSpace,
  shadows,
  surfaces,
  toneNames,
  tones,
  typeScale,
  zIndex,
  type AccentName,
  type Tone,
} from './tokens';

type CssDeclarations = Record<string, string>;
export type CssRules = Record<string, CssDeclarations | Record<string, CssDeclarations>>;

/** "#1d1d1f" → "29 29 31". Accepts #rgb and #rrggbb only (tokens are opaque). */
export function hexToChannels(hex: string): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Design tokens must be opaque #rgb or #rrggbb hex, got "${hex}"`);
  let digits = match[1]!;
  if (digits.length === 3) digits = [...digits].map((d) => d + d).join('');
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)).join(' ');
}

/** Semantic colour variable for each tone key (the Tailwind colour names follow them). */
export const semanticVariables = {
  surface: '--surface',
  surfaceAlt: '--surface-alt',
  fg: '--fg',
  fgMuted: '--fg-muted',
  fgSubtle: '--fg-subtle',
  line: '--line',
  lineStrong: '--line-strong',
  focus: '--focus',
  danger: '--danger',
  success: '--success',
  btn: '--btn',
  btnFg: '--btn-fg',
  btnHover: '--btn-hover',
} as const;

type SemanticKey = keyof typeof semanticVariables;

/** Declarations that set one tone's semantic colours. */
export function toneDeclarations(tone: Tone): CssDeclarations {
  const map = tones[tone];
  const declarations: CssDeclarations = {};
  for (const [key, variable] of Object.entries(semanticVariables) as [SemanticKey, string][]) {
    declarations[variable] = hexToChannels(map[key]);
  }
  declarations['--accent-fg'] = map.accentSlot === 'cinema' ? 'var(--accent-text-cinema)' : 'var(--accent-text)';
  // Group gold as text on this tone whatever the accent, so home's links
  // and eyebrows stay gold inside a company's tile (plan: chevron links are
  // text gold; the company accent colours links on company pages only).
  declarations['--gold-fg'] = map.accentSlot === 'cinema' ? 'var(--color-gold-cinema)' : 'var(--color-gold-text)';
  declarations['color-scheme'] = map.colorScheme;
  return declarations;
}

/** Declarations that swap in one accent swatch. */
export function accentDeclarations(accent: AccentName): CssDeclarations {
  const swatch = accents[accent];
  return {
    '--accent-graphic': hexToChannels(swatch.graphic),
    '--accent-text': hexToChannels(swatch.text),
    '--accent-text-cinema': hexToChannels(swatch.cinema),
    // The graphic accent does not depend on the tone, so it can be set here.
    '--accent': 'var(--accent-graphic)',
  };
}

const px = (value: number) => `${value}px`;
const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Fixed brand colours that never change with the tone. */
export const fixedColorVariables = {
  '--color-cinema': hexToChannels(surfaces.cinema),
  '--color-cinema-raised': hexToChannels(surfaces.cinemaRaised),
  '--color-gold': hexToChannels(accents.group.graphic),
  '--color-gold-text': hexToChannels(accents.group.text),
  '--color-gold-cinema': hexToChannels(accents.group.cinema),
  '--color-mwanjalisi': hexToChannels(accents.mwanjalisi.graphic),
  '--color-mwanjalisi-text': hexToChannels(accents.mwanjalisi.text),
  '--color-mwanjalisi-cinema': hexToChannels(accents.mwanjalisi.cinema),
  '--color-westsides': hexToChannels(accents.westsides.graphic),
  '--color-westsides-text': hexToChannels(accents.westsides.text),
  '--color-westsides-cinema': hexToChannels(accents.westsides.cinema),
  '--color-enterprises': hexToChannels(accents.enterprises.graphic),
  '--color-enterprises-text': hexToChannels(accents.enterprises.text),
  '--color-enterprises-cinema': hexToChannels(accents.enterprises.cinema),
} as const;

/** Every rule the Tailwind plugin adds to the base layer. */
export function baseStyles(): CssRules {
  const [sectionMobile, sectionDesktop] = sectionSpace.default;
  const [tightMobile, tightDesktop] = sectionSpace.tight;
  const [tileMobile, tileDesktop] = radii.tile;

  const rules: CssRules = {
    ':root': {
      ...fixedColorVariables,
      ...accentDeclarations('group'),
      ...toneDeclarations('light'),
      '--material-nav': materials.nav.background,
      '--material-nav-filter': materials.nav.backdropFilter,
      '--material-nav-fallback': materials.nav.fallback,
      '--gutter': px(gutter),
      '--container-measure': px(containers.measure),
      '--container-prose': px(containers.prose),
      '--container-content': px(containers.content),
      '--container-wide': px(containers.wide),
      '--space-section': px(sectionMobile),
      '--space-section-tight': px(tightMobile),
      '--nav-height': px(chrome.nav),
      '--subnav-height': px(chrome.subnav),
      '--quickbar-height': px(chrome.quickBar),
      '--radius-tile': px(tileMobile),
      '--radius-card': px(radii.card),
      '--radius-input': px(radii.input),
      '--radius-pill': px(radii.pill),
      ...Object.fromEntries(Object.entries(zIndex).map(([name, value]) => [`--z-${kebab(name)}`, String(value)])),
      '--ease': motion.ease,
      '--ease-emphasized': motion.easeEmphasized,
      '--duration-fast': `${motion.duration.fast}ms`,
      '--duration-base': `${motion.duration.base}ms`,
      '--duration-slow': `${motion.duration.slow}ms`,
      '--reveal-distance': px(motion.revealDistance),
    },
    [`@media (min-width: ${px(breakpoints.md)})`]: {
      ':root': {
        '--space-section': px(sectionDesktop),
        '--space-section-tight': px(tightDesktop),
        '--radius-tile': px(tileDesktop),
      },
    },
  };

  for (const tone of toneNames) {
    rules[`[data-tone="${tone}"]`] = toneDeclarations(tone);
  }
  for (const accent of Object.keys(accents) as AccentName[]) {
    rules[`[data-accent="${accent}"]`] = accentDeclarations(accent);
  }
  return rules;
}

const rgbVar = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`;

/**
 * Tailwind colours. They replace Tailwind's palette entirely (only
 * transparent, current, white and black are kept), so an undefined colour
 * class generates nothing and the lint rule flags it.
 */
export const colors = {
  transparent: 'transparent',
  current: 'currentColor',
  white: '#ffffff',
  black: '#000000',

  // Semantic colours, re-mapped by data-tone.
  surface: { DEFAULT: rgbVar('--surface'), alt: rgbVar('--surface-alt') },
  fg: { DEFAULT: rgbVar('--fg'), muted: rgbVar('--fg-muted'), subtle: rgbVar('--fg-subtle') },
  line: { DEFAULT: rgbVar('--line'), strong: rgbVar('--line-strong') },
  accent: { DEFAULT: rgbVar('--accent'), fg: rgbVar('--accent-fg') },
  focus: rgbVar('--focus'),
  danger: rgbVar('--danger'),
  success: rgbVar('--success'),
  btn: { DEFAULT: rgbVar('--btn'), fg: rgbVar('--btn-fg'), hover: rgbVar('--btn-hover') },

  // Fixed brand colours: cinema tiles, and each accent (graphic / text / cinema).
  cinema: { DEFAULT: rgbVar('--color-cinema'), raised: rgbVar('--color-cinema-raised') },
  gold: {
    DEFAULT: rgbVar('--color-gold'),
    text: rgbVar('--color-gold-text'),
    cinema: rgbVar('--color-gold-cinema'),
    /** Group gold text for the tone it sits on (text gold on light tones, cinema gold on black). */
    fg: rgbVar('--gold-fg'),
  },
  mwanjalisi: {
    DEFAULT: rgbVar('--color-mwanjalisi'),
    text: rgbVar('--color-mwanjalisi-text'),
    cinema: rgbVar('--color-mwanjalisi-cinema'),
  },
  westsides: {
    DEFAULT: rgbVar('--color-westsides'),
    text: rgbVar('--color-westsides-text'),
    cinema: rgbVar('--color-westsides-cinema'),
  },
  enterprises: {
    DEFAULT: rgbVar('--color-enterprises'),
    text: rgbVar('--color-enterprises-text'),
    cinema: rgbVar('--color-enterprises-cinema'),
  },
} as const;

type TailwindFontSize = [string, { lineHeight: string; letterSpacing: string; fontWeight: string }];

/** `text-display-xl`, `text-h1`, `text-body`…: size, leading, tracking and weight together. */
export const fontSize = Object.fromEntries(
  Object.entries(typeScale).map(([name, style]) => [
    name,
    [style.size, { lineHeight: style.lineHeight, letterSpacing: style.tracking, fontWeight: String(style.weight) }],
  ]),
) as Record<keyof typeof typeScale, TailwindFontSize>;

export const screens = Object.fromEntries(Object.entries(breakpoints).map(([name, value]) => [name, px(value)])) as Record<
  keyof typeof breakpoints,
  string
>;

/** Theme extensions (merged over Tailwind's defaults). */
export const themeExtend = {
  fontSize,
  borderRadius: {
    tile: 'var(--radius-tile)',
    card: 'var(--radius-card)',
    input: 'var(--radius-input)',
    pill: 'var(--radius-pill)',
  },
  maxWidth: {
    measure: 'var(--container-measure)',
    // Deliberately replaces Tailwind's `prose` (65ch) with the 980px container.
    prose: 'var(--container-prose)',
    content: 'var(--container-content)',
    wide: 'var(--container-wide)',
  },
  spacing: {
    gutter: 'var(--gutter)',
    section: 'var(--space-section)',
    'section-tight': 'var(--space-section-tight)',
    nav: 'var(--nav-height)',
    subnav: 'var(--subnav-height)',
    quickbar: 'var(--quickbar-height)',
  },
  zIndex: Object.fromEntries(Object.keys(zIndex).map((name) => [kebab(name), `var(--z-${kebab(name)})`])),
  transitionTimingFunction: { apple: 'var(--ease)', emphasized: 'var(--ease-emphasized)' },
  transitionDuration: {
    fast: 'var(--duration-fast)',
    base: 'var(--duration-base)',
    slow: 'var(--duration-slow)',
  },
  boxShadow: shadows,
} as const;

export const fontFamilies = {
  sans: [...fontFamily.sans],
  mono: [...fontFamily.mono],
};
