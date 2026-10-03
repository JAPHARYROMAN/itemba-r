/**
 * WCAG 2.x contrast maths for the design-token contrast test.
 *
 * - Relative luminance and contrast ratio follow the WCAG 2.2 definitions
 *   (sRGB linearisation with the 0.04045 knee; for 8-bit channels this gives
 *   the same result as the older 0.03928 constant).
 * - Translucent colours are alpha-composited in sRGB space before measuring,
 *   the same way a browser paints them: a translucent background over a base
 *   surface, then a translucent foreground over that result.
 * - Ratios are never rounded up. `formatRatio` truncates, and the pass checks
 *   compare the unrounded value, so 4.499:1 fails a 4.5:1 requirement.
 */

/** Channels are 0–255 (fractional after compositing). */
export type Rgb = { r: number; g: number; b: number };
/** Alpha is 0–1. */
export type Rgba = Rgb & { a: number };

export type ContrastLevel = 'AA' | 'AAA';
/**
 * - `text`: body copy (SC 1.4.3 / 1.4.6).
 * - `large-text`: at least 24px, or at least 18.67px (14pt) at weight 700+.
 * - `ui`: component boundaries, focus rings, icons and other graphics
 *   (SC 1.4.11, which has no AAA tier).
 */
export type ContrastKind = 'text' | 'large-text' | 'ui';

export const WCAG_THRESHOLDS: Readonly<Record<ContrastLevel, Readonly<Record<ContrastKind, number>>>> = {
  AA: { text: 4.5, 'large-text': 3, ui: 3 },
  AAA: { text: 7, 'large-text': 4.5, ui: 3 },
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FN = /^rgba?\((.*)\)$/i;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

function parseNumber(token: string, context: string): number {
  if (!NUMBER.test(token)) throw new Error(`Unsupported colour component "${token}" in ${context}`);
  return Number(token);
}

function parseChannel(token: string, context: string): number {
  const value = token.endsWith('%') ? (parseNumber(token.slice(0, -1), context) / 100) * 255 : parseNumber(token, context);
  if (value < 0 || value > 255) throw new Error(`Colour channel out of range in ${context}`);
  return value;
}

function parseAlpha(token: string, context: string): number {
  const value = token.endsWith('%') ? parseNumber(token.slice(0, -1), context) / 100 : parseNumber(token, context);
  if (value < 0 || value > 1) throw new Error(`Alpha out of range in ${context}`);
  return value;
}

/**
 * Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, and `rgb()` / `rgba()` in
 * both the legacy comma form (`rgba(255, 255, 255, .72)`) and the modern
 * space form (`rgb(0 0 0 / 50%)`). Named colours and other colour spaces are
 * rejected so a token typo cannot silently measure as black.
 */
export function parseColor(input: string): Rgba {
  const value = input.trim();

  const hex = HEX.exec(value);
  if (hex) {
    let digits = hex[1]!;
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join('');
    const byte = (i: number) => parseInt(digits.slice(i, i + 2), 16);
    return { r: byte(0), g: byte(2), b: byte(4), a: digits.length === 8 ? byte(6) / 255 : 1 };
  }

  const fn = RGB_FN.exec(value);
  if (fn) {
    const inner = fn[1]!.trim();
    let parts: string[];
    let alpha: string | undefined;
    if (inner.includes(',')) {
      parts = inner.split(',').map((p) => p.trim());
      if (parts.length === 4) alpha = parts.pop();
    } else {
      const [channels, slashAlpha, extra] = inner.split('/').map((p) => p.trim());
      if (extra !== undefined) throw new Error(`Unsupported colour "${input}"`);
      parts = channels!.split(/\s+/).filter(Boolean);
      alpha = slashAlpha;
    }
    if (parts.length !== 3) throw new Error(`Unsupported colour "${input}"`);
    const [r, g, b] = parts.map((p) => parseChannel(p, input)) as [number, number, number];
    return { r, g, b, a: alpha === undefined ? 1 : parseAlpha(alpha, input) };
  }

  throw new Error(`Unsupported colour "${input}" (use hex or rgb()/rgba())`);
}

function toRgba(color: string | Rgb | Rgba): Rgba {
  if (typeof color === 'string') return parseColor(color);
  return { a: 1, ...color };
}

/** Paints `foreground` (with its alpha) over an opaque `background`. */
export function composite(foreground: string | Rgba, background: string | Rgb): Rgb {
  const fg = toRgba(foreground);
  const bg = toRgba(background);
  if (bg.a < 1) throw new Error('composite() needs an opaque background; composite the background first');
  const mix = (f: number, b: number) => f * fg.a + b * (1 - fg.a);
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b) };
}

function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an opaque colour, 0 (black) to 1 (white). */
export function relativeLuminance(color: string | Rgb | Rgba): number {
  const c = toRgba(color);
  if (c.a < 1) throw new Error('relativeLuminance() needs an opaque colour; composite it first');
  return 0.2126 * linearise(c.r) + 0.7152 * linearise(c.g) + 0.0722 * linearise(c.b);
}

/**
 * Contrast ratio (1 to 21) of `foreground` on `background`. A translucent
 * background is first painted over `base` (white by default, the page
 * canvas); a translucent foreground is then painted over that result.
 */
export function contrastRatio(foreground: string, background: string, base = '#ffffff'): number {
  const baseColor = toRgba(base);
  if (baseColor.a < 1) throw new Error('The base surface must be opaque');
  const bg = composite(background, baseColor);
  const fg = composite(foreground, bg);
  const [light, dark] = [relativeLuminance(fg), relativeLuminance(bg)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

export function requiredRatio(kind: ContrastKind = 'text', level: ContrastLevel = 'AA'): number {
  return WCAG_THRESHOLDS[level][kind];
}

export type ContrastOptions = { kind?: ContrastKind; level?: ContrastLevel; base?: string };

export function meetsContrast(foreground: string, background: string, options: ContrastOptions = {}): boolean {
  const { kind = 'text', level = 'AA', base } = options;
  return contrastRatio(foreground, background, base) >= requiredRatio(kind, level);
}

/** WCAG "large text": 18pt (24px) regular, or 14pt (about 18.67px) bold. */
export function isLargeText(fontSizePx: number, fontWeight = 400): boolean {
  const boldMinimumPx = (14 * 96) / 72;
  return fontSizePx >= 24 || (fontWeight >= 700 && fontSizePx >= boldMinimumPx - 1e-9);
}

/** "4.49:1": truncated, never rounded up past a threshold. */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100 + 1e-9) / 100).toFixed(2)}:1`;
}
