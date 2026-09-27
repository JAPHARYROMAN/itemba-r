/**
 * Itemba design tokens: the single source of every colour, type size, radius,
 * container and spacing value on the site.
 *
 * - tailwind.config.ts builds its theme from these values, and its plugin
 *   (src/design/theme.ts) writes them as CSS variables on :root, with the
 *   `data-tone` and `data-accent` re-mapping.
 * - The OG cards, the corridor map and print can import the hex values
 *   directly.
 * - tests/unit/design-tokens.test.ts checks every declared foreground and
 *   background pair and every button variant against WCAG AA.
 *
 * The file is plain data with no imports, so tailwind.config.ts (loaded
 * through jiti), satori and client code can all read it.
 *
 * Direction ("Itemba, the Apple way"): calm light canvases, a few black
 * cinema tiles for photography, ink type, and one group gold used sparingly.
 */

/* ── Surfaces ─────────────────────────────────────────────────────────── */

export const surfaces = {
  /** Page canvas. */
  canvas: '#ffffff',
  /** Alternate tile; alternates with the canvas down a page. */
  alt: '#f5f5f7',
  /** Cinema tile, for photography. Use at most once per two screens. */
  cinema: '#000000',
  /** Raised tile or card inside a cinema tile. */
  cinemaRaised: '#101014',
} as const;

/**
 * Hairlines are decorative separators, so no contrast minimum applies.
 * Anything that marks a control's edge, such as an input border, uses
 * `lineStrong` in the tone map below.
 */
export const hairlines = {
  light: '#d2d2d7',
  cinema: '#424245',
} as const;

/* ── Text ─────────────────────────────────────────────────────────────── */

export const text = {
  light: {
    primary: '#1d1d1f',
    secondary: '#6e6e73',
    /**
     * Tertiary text is 3.62:1 on the canvas and 3.33:1 on the alt tile. It
     * is only for large text (24px and up), icons and control borders, never
     * for body copy, captions or placeholders on a light tone.
     */
    tertiary: '#86868b',
  },
  cinema: {
    primary: '#f5f5f7',
    secondary: '#a1a1a6',
    /** Clears 4.5:1 on both cinema surfaces, so any size may use it there. */
    tertiary: '#86868b',
  },
} as const;

/* ── Group gold and the company accents ───────────────────────────────── */

/**
 * `graphic` is decorative only: hairlines, dots, the crest glow and icons
 * that sit beside a text label. It is not for text or for icons that carry
 * meaning alone; group gold is 2.81:1 on the alt tile.
 * `text` is for text and links on the canvas and alt tiles.
 * `cinema` is for text and links on both cinema surfaces.
 */
export type AccentSwatch = { graphic: string; text: string; cinema: string };

export const gold = {
  graphic: '#c8860a',
  /** 5.64:1 on the canvas, 5.18:1 on the alt tile. */
  text: '#8c5e0a',
  cinema: '#e8b52e',
} as const satisfies AccentSwatch;

/**
 * Company accents, retuned so each one reads as distinct from group gold.
 * The keys are the content `AccentKey`s (src/content/types.ts).
 */
export const companyAccents = {
  mwanjalisi: {
    graphic: '#f08c00',
    /**
     * The plan's #b25e09 is only 4.29:1 on the #f5f5f7 alt tile, so it fails
     * AA for body-size links there. This value keeps the same hue about 4%
     * darker: 5.03:1 on the canvas and 4.62:1 on the alt tile.
     */
    text: '#aa5a08',
    cinema: '#f08c00',
  },
  westsides: {
    graphic: '#0071e3',
    text: '#0066cc',
    /**
     * The graphic blue is 4.47:1 on black, just under AA, so cinema text
     * uses the lighter link blue instead.
     */
    cinema: '#2997ff',
  },
  enterprises: {
    graphic: '#00a36c',
    text: '#0a7a52',
    cinema: '#00a36c',
  },
} as const satisfies Record<string, AccentSwatch>;

export const accents = {
  group: gold,
  ...companyAccents,
} as const satisfies Record<string, AccentSwatch>;

export type AccentName = keyof typeof accents;
export const accentNames = Object.keys(accents) as AccentName[];

/* ── Status and interaction ──────────────────────────────────────────── */

export const status = {
  light: { danger: '#d70015', success: '#1a7f37' },
  cinema: { danger: '#ff453a', success: '#30d158' },
} as const;

/** Focus ring colour; it must clear 3:1 against every surface of its tone. */
export const focus = {
  light: '#0071e3',
  cinema: '#2997ff',
} as const;

/**
 * Buttons are Apple-style pills.
 * - The primary pill is ink with white text on light tones, and white with
 *   ink text on cinema.
 * - The secondary action is a text link with a chevron ("Learn more ›"),
 *   drawn in the tone's accent text colour.
 */
export const buttons = {
  primary: {
    light: { bg: '#1d1d1f', fg: '#ffffff', hover: '#333336' },
    cinema: { bg: '#ffffff', fg: '#1d1d1f', hover: '#e8e8ed' },
  },
} as const;

/**
 * The one allowed material: the translucent global nav. Browsers without
 * backdrop-filter get the solid fallback.
 */
export const materials = {
  nav: {
    background: 'rgba(255, 255, 255, 0.72)',
    backdropFilter: 'saturate(180%) blur(20px)',
    fallback: '#ffffff',
  },
} as const;

/* ── Tones ────────────────────────────────────────────────────────────── */

/**
 * A tone is the set of semantic colours for one kind of tile. A `Section`
 * (or any element that paints a surface) sets `data-tone`, and the CSS
 * variables are re-mapped for everything inside it.
 * - `surface` is the tile's own background.
 * - `surfaceAlt` is the background of a card set inside that tile.
 * Every text role must pass on both surfaces of its tone.
 */
export type Tone = 'light' | 'alt' | 'cinema';
export const toneNames: readonly Tone[] = ['light', 'alt', 'cinema'];

export type ToneColors = {
  surface: string;
  surfaceAlt: string;
  fg: string;
  fgMuted: string;
  fgSubtle: string;
  line: string;
  lineStrong: string;
  focus: string;
  danger: string;
  success: string;
  btn: string;
  btnFg: string;
  btnHover: string;
  /** The accent text slot this tone reads. */
  accentSlot: 'text' | 'cinema';
  colorScheme: 'light' | 'dark';
};

const lightFamily = {
  fg: text.light.primary,
  fgMuted: text.light.secondary,
  fgSubtle: text.light.tertiary,
  line: hairlines.light,
  lineStrong: text.light.tertiary,
  focus: focus.light,
  danger: status.light.danger,
  success: status.light.success,
  btn: buttons.primary.light.bg,
  btnFg: buttons.primary.light.fg,
  btnHover: buttons.primary.light.hover,
  accentSlot: 'text',
  colorScheme: 'light',
} as const;

export const tones = {
  light: { surface: surfaces.canvas, surfaceAlt: surfaces.alt, ...lightFamily },
  alt: { surface: surfaces.alt, surfaceAlt: surfaces.canvas, ...lightFamily },
  cinema: {
    surface: surfaces.cinema,
    surfaceAlt: surfaces.cinemaRaised,
    fg: text.cinema.primary,
    fgMuted: text.cinema.secondary,
    fgSubtle: text.cinema.tertiary,
    line: hairlines.cinema,
    lineStrong: text.light.secondary,
    focus: focus.cinema,
    danger: status.cinema.danger,
    success: status.cinema.success,
    btn: buttons.primary.cinema.bg,
    btnFg: buttons.primary.cinema.fg,
    btnHover: buttons.primary.cinema.hover,
    accentSlot: 'cinema',
    colorScheme: 'dark',
  },
} as const satisfies Record<Tone, ToneColors>;

/** The accent text colour a tone uses for an accent. */
export function accentText(accent: AccentName, tone: Tone): string {
  return accents[accent][tones[tone].accentSlot];
}

/* ── Contrast contract (enforced by tests/unit/design-tokens.test.ts) ──── */

/**
 * The WCAG kind each text role is used for:
 * - `text` needs 4.5:1;
 * - `large-text` (24px and up, or 18.67px bold) needs 3:1.
 * Where a tone gives a role more headroom, the test still holds it to this
 * floor, so a role cannot quietly be used below it.
 */
export const textRoleKinds = {
  fg: 'text',
  fgMuted: 'text',
  fgSubtle: 'large-text',
  danger: 'text',
  success: 'text',
  accentFg: 'text',
} as const satisfies Record<string, 'text' | 'large-text'>;

/**
 * Roles that draw control edges and focus indicators. They need 3:1 against
 * both surfaces of their tone (WCAG 1.4.11).
 */
export const uiRoles = ['lineStrong', 'focus', 'btn', 'btnHover'] as const;

/**
 * Decorative-only values with no contrast minimum: hairlines, and graphic
 * accents that always sit beside a text label.
 */
export const decorativeRoles = ['line', 'accentGraphic'] as const;

/* ── Typography ───────────────────────────────────────────────────────── */

export const fontFamily = {
  /** Inter variable (OFL), self-hosted; the opsz axis gives the display cut. */
  sans: [
    'var(--font-sans)',
    'system-ui',
    '-apple-system',
    'BlinkMacSystemFont',
    '"Segoe UI"',
    'Roboto',
    '"Helvetica Neue"',
    'Arial',
    'sans-serif',
  ],
  mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', '"Liberation Mono"', 'monospace'],
} as const;

export type TypeStyle = {
  /** CSS font-size (a clamp() where the size is fluid). */
  size: string;
  /** Smallest and largest rendered size in px, for large-text checks. */
  minPx: number;
  maxPx: number;
  lineHeight: string;
  tracking: string;
  weight: number;
};

/**
 * The type scale. Headlines are weight 600, tracked from -0.022em
 * (display) to -0.015em (h3). Body copy is weight 400 with a line height of
 * 1.47. Eyebrows are 14px, weight 600, +0.01em, in sentence case (no
 * letter-spaced capitals).
 * - display-xl and display follow the plan's clamps (48–96px, 40–72px).
 * - h1, h2 and h3 reach 56, 40 and 28px from a 1068px viewport, and scale
 *   down to 32, 32 and 24px at 360px: on a phone a chapter title set at h1
 *   size steps down to h2 size, so the page's own h1 (about 40px there)
 *   leads every chapter by at least 1.2x.
 * - rem values scale with the reader's own font-size setting.
 */
export const typeScale = {
  'display-xl': { size: 'clamp(3rem, 8vw, 6rem)', minPx: 48, maxPx: 96, lineHeight: '1.05', tracking: '-0.022em', weight: 600 },
  display: { size: 'clamp(2.5rem, 6vw, 4.5rem)', minPx: 40, maxPx: 72, lineHeight: '1.07', tracking: '-0.022em', weight: 600 },
  h1: { size: 'clamp(2rem, 1.237rem + 3.39vw, 3.5rem)', minPx: 32, maxPx: 56, lineHeight: '1.07', tracking: '-0.02em', weight: 600 },
  h2: { size: 'clamp(2rem, 1.746rem + 1.13vw, 2.5rem)', minPx: 32, maxPx: 40, lineHeight: '1.1', tracking: '-0.018em', weight: 600 },
  h3: { size: 'clamp(1.5rem, 1.373rem + 0.565vw, 1.75rem)', minPx: 24, maxPx: 28, lineHeight: '1.14', tracking: '-0.015em', weight: 600 },
  lede: { size: 'clamp(1.3125rem, 1.217rem + 0.424vw, 1.5rem)', minPx: 21, maxPx: 24, lineHeight: '1.33', tracking: '-0.011em', weight: 400 },
  'body-lg': { size: '1.1875rem', minPx: 19, maxPx: 19, lineHeight: '1.47', tracking: '-0.011em', weight: 400 },
  body: { size: '1.0625rem', minPx: 17, maxPx: 17, lineHeight: '1.47', tracking: '-0.01em', weight: 400 },
  eyebrow: { size: '0.875rem', minPx: 14, maxPx: 14, lineHeight: '1.43', tracking: '0.01em', weight: 600 },
  caption: { size: '0.875rem', minPx: 14, maxPx: 14, lineHeight: '1.43', tracking: '-0.006em', weight: 400 },
  legal: { size: '0.75rem', minPx: 12, maxPx: 12, lineHeight: '1.33', tracking: '0em', weight: 400 },
} as const satisfies Record<string, TypeStyle>;

export type TypeStyleName = keyof typeof typeScale;

/* ── Layout ───────────────────────────────────────────────────────────── */

/**
 * Breakpoints, in px. They match Tailwind's defaults, so `md:` means the
 * same thing everywhere. "Desktop" values below apply from `md`.
 */
export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 } as const;

/** Max widths, in px. */
export const containers = {
  /** Readable article column (insights). */
  measure: 680,
  /** Prose sections. */
  prose: 980,
  /** Standard content width. */
  content: 1068,
  /** Full-width tiles. */
  wide: 1440,
} as const;

/** Side gutter, in px (22px, the Apple mobile gutter, at every width). */
export const gutter = 22;

/** Vertical rhythm, in px, as [mobile, desktop from `md`]. */
export const sectionSpace = {
  default: [80, 120],
  tight: [56, 80],
} as const;

/** Chrome heights, in px. */
export const chrome = {
  /** Translucent global nav bar. */
  nav: 48,
  /** Sticky local sub-nav on company, service and profile pages. */
  subnav: 52,
  /** Mobile quick-contact bar. */
  quickBar: 56,
} as const;

/** Corner radii, in px. Tiles and media are 20px on mobile and 28px from `md`. */
export const radii = {
  tile: [20, 28],
  card: 18,
  input: 12,
  pill: 9999,
} as const;

/** Stacking order. */
export const zIndex = {
  subnav: 40,
  quickBar: 45,
  nav: 50,
  sheet: 60,
  skip: 100,
} as const;

/* ── Motion (CSS only) ────────────────────────────────────────────────── */

/**
 * Entrance motion is a 16px fade-up, only under
 * prefers-reduced-motion: no-preference and only where
 * animation-timeline: view() is supported. The hero and its LCP image never
 * animate.
 */
export const motion = {
  ease: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
  easeEmphasized: 'cubic-bezier(0.28, 0.11, 0.32, 1)',
  duration: { fast: 180, base: 320, slow: 600 },
  revealDistance: 16,
} as const;

/** Soft shadows for the rare raised element; tiles themselves have none. */
export const shadows = {
  card: '0 2px 12px rgba(0, 0, 0, 0.08)',
  lift: '0 12px 32px rgba(0, 0, 0, 0.12)',
} as const;
