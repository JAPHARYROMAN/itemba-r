/**
 * The WCAG contrast helper must itself be trustworthy before the token
 * contrast test relies on it. Reference values are the published WCAG
 * extremes plus well-known AA boundary greys (#767676 is the lightest grey
 * that passes 4.5:1 on white; #777777 is the first that fails).
 */
import { describe, expect, it } from 'vitest';
import {
  WCAG_THRESHOLDS,
  composite,
  contrastRatio,
  formatRatio,
  isLargeText,
  meetsContrast,
  parseColor,
  relativeLuminance,
  requiredRatio,
} from './helpers/contrast';

describe('parseColor', () => {
  it('reads six-digit hex in any case', () => {
    expect(parseColor('#1d1d1f')).toEqual({ r: 0x1d, g: 0x1d, b: 0x1f, a: 1 });
    expect(parseColor('#C8860A')).toEqual({ r: 0xc8, g: 0x86, b: 0x0a, a: 1 });
    expect(parseColor('  #ffffff  ')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it('expands three- and four-digit hex', () => {
    expect(parseColor('#fff')).toEqual(parseColor('#ffffff'));
    expect(parseColor('#0a7')).toEqual({ r: 0x00, g: 0xaa, b: 0x77, a: 1 });
    expect(parseColor('#0008')).toEqual({ r: 0, g: 0, b: 0, a: 0x88 / 255 });
  });

  it('reads eight-digit hex alpha', () => {
    expect(parseColor('#ffffff80')).toEqual({ r: 255, g: 255, b: 255, a: 0x80 / 255 });
  });

  it('reads legacy comma and modern space rgb() syntax', () => {
    expect(parseColor('rgba(255, 255, 255, .72)')).toEqual({ r: 255, g: 255, b: 255, a: 0.72 });
    expect(parseColor('rgb(29,29,31)')).toEqual({ r: 29, g: 29, b: 31, a: 1 });
    expect(parseColor('rgb(0 0 0 / 50%)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor('rgb(100% 0% 50%)')).toEqual({ r: 255, g: 0, b: 127.5, a: 1 });
    expect(parseColor('RGBA(0, 113, 227, 1)')).toEqual({ r: 0, g: 113, b: 227, a: 1 });
  });

  it.each([
    'white',
    'transparent',
    '#ff',
    '#fffff',
    '#gggggg',
    'ffffff',
    'rgb(256, 0, 0)',
    'rgb(-1, 0, 0)',
    'rgba(0, 0, 0, 1.5)',
    'rgb(0, 0)',
    'rgb(0 0 0 / 1 / 1)',
    'rgb(a, b, c)',
    'hsl(0 0% 100%)',
    '',
  ])('rejects %j instead of guessing', (input) => {
    expect(() => parseColor(input)).toThrow();
  });
});

describe('relativeLuminance', () => {
  it('spans 0 (black) to 1 (white)', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 12);
  });

  it('matches reference values', () => {
    expect(relativeLuminance('#808080')).toBeCloseTo(0.21586, 5);
    expect(relativeLuminance('#ff0000')).toBeCloseTo(0.2126, 10);
    expect(relativeLuminance('#00ff00')).toBeCloseTo(0.7152, 10);
    expect(relativeLuminance('#0000ff')).toBeCloseTo(0.0722, 10);
  });

  it('uses the linear segment below the sRGB knee', () => {
    // 10/255 is below the 0.04045 knee, so it is c / 12.92 exactly.
    expect(relativeLuminance('#0a0a0a')).toBeCloseTo(10 / 255 / 12.92, 12);
  });

  it('refuses translucent input that has not been composited', () => {
    expect(() => relativeLuminance('rgba(0, 0, 0, 0.5)')).toThrow();
  });
});

describe('composite', () => {
  it('paints alpha over the background', () => {
    expect(composite('rgba(0, 0, 0, 0.5)', '#ffffff')).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
    expect(composite('#1d1d1f', '#ffffff')).toEqual({ r: 0x1d, g: 0x1d, b: 0x1f });
    expect(composite('rgba(255, 255, 255, 0)', '#101014')).toEqual({ r: 0x10, g: 0x10, b: 0x14 });
  });

  it('requires an opaque background', () => {
    expect(() => composite('#000', 'rgba(255, 255, 255, 0.5)')).toThrow();
  });
});

describe('contrastRatio', () => {
  it('reaches the WCAG extremes', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(contrastRatio('#6e6e73', '#6e6e73')).toBe(1);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#0066cc', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#0066cc'), 12);
    expect(contrastRatio('#e8b52e', '#000000')).toBeCloseTo(contrastRatio('#000000', '#e8b52e'), 12);
  });

  it.each([
    ['#767676', '#ffffff', 4.5422],
    ['#777777', '#ffffff', 4.4781],
    ['#595959', '#ffffff', 7.0047],
    ['#949494', '#ffffff', 3.0335],
    ['#808080', '#ffffff', 3.9494],
    ['#0066cc', '#ffffff', 5.5666],
    ['#1d1d1f', '#ffffff', 16.83],
  ])('%s on %s is %d:1', (fg, bg, expected) => {
    expect(contrastRatio(fg, bg)).toBeCloseTo(expected, 3);
  });

  it('composites a translucent foreground over the background', () => {
    // 50% black on white paints as a 127.5 grey.
    const grey = relativeLuminance({ r: 127.5, g: 127.5, b: 127.5 });
    expect(contrastRatio('rgba(0, 0, 0, 0.5)', '#ffffff')).toBeCloseTo((1 + 0.05) / (grey + 0.05), 12);
    expect(contrastRatio('rgba(0, 0, 0, 0)', '#ffffff')).toBe(1);
  });

  it('composites a translucent background over the base surface', () => {
    // The translucent global nav over the white canvas is white; over a
    // black cinema tile it is a 72% grey, which dark ink must still clear.
    expect(contrastRatio('#1d1d1f', 'rgba(255, 255, 255, .72)')).toBeCloseTo(contrastRatio('#1d1d1f', '#ffffff'), 12);
    const overCinema = contrastRatio('#1d1d1f', 'rgba(255, 255, 255, .72)', '#000000');
    const navGrey = relativeLuminance({ r: 255 * 0.72, g: 255 * 0.72, b: 255 * 0.72 });
    expect(overCinema).toBeCloseTo((navGrey + 0.05) / (relativeLuminance('#1d1d1f') + 0.05), 12);
    expect(overCinema).toBeLessThan(contrastRatio('#1d1d1f', '#ffffff'));
  });

  it('requires an opaque base surface', () => {
    expect(() => contrastRatio('#000', '#fff', 'rgba(0, 0, 0, 0.5)')).toThrow();
  });
});

describe('thresholds', () => {
  it('encode WCAG 2.2 AA and AAA minimums', () => {
    expect(WCAG_THRESHOLDS).toEqual({
      AA: { text: 4.5, 'large-text': 3, ui: 3 },
      AAA: { text: 7, 'large-text': 4.5, ui: 3 },
    });
    expect(requiredRatio()).toBe(4.5);
    expect(requiredRatio('large-text')).toBe(3);
    expect(requiredRatio('ui')).toBe(3);
    expect(requiredRatio('text', 'AAA')).toBe(7);
  });

  it('pass or fail on the unrounded ratio', () => {
    expect(meetsContrast('#767676', '#ffffff')).toBe(true);
    expect(meetsContrast('#777777', '#ffffff')).toBe(false);
    expect(meetsContrast('#777777', '#ffffff', { kind: 'large-text' })).toBe(true);
    expect(meetsContrast('#949494', '#ffffff', { kind: 'ui' })).toBe(true);
    expect(meetsContrast('#959595', '#ffffff', { kind: 'ui' })).toBe(false);
    expect(meetsContrast('#595959', '#ffffff', { level: 'AAA' })).toBe(true);
    expect(meetsContrast('#5a5a5a', '#ffffff', { level: 'AAA' })).toBe(false);
  });

  it('honours the base surface for translucent backgrounds', () => {
    expect(meetsContrast('#ffffff', 'rgba(0, 0, 0, 0.1)')).toBe(false);
    expect(meetsContrast('#ffffff', 'rgba(0, 0, 0, 0.1)', { base: '#000000' })).toBe(true);
  });
});

describe('formatRatio', () => {
  it('truncates instead of rounding up', () => {
    expect(formatRatio(4.4999)).toBe('4.49:1');
    expect(formatRatio(4.5422)).toBe('4.54:1');
    expect(formatRatio(4.54)).toBe('4.54:1');
    expect(formatRatio(21)).toBe('21.00:1');
    expect(formatRatio(1)).toBe('1.00:1');
  });
});

describe('isLargeText', () => {
  it('uses 24px regular or 14pt bold', () => {
    expect(isLargeText(24)).toBe(true);
    expect(isLargeText(23.9)).toBe(false);
    expect(isLargeText(56, 600)).toBe(true);
    expect(isLargeText(19, 700)).toBe(true);
    expect(isLargeText((14 * 96) / 72, 700)).toBe(true);
    expect(isLargeText(18.6, 700)).toBe(false);
    expect(isLargeText(21, 600)).toBe(false);
    expect(isLargeText(17)).toBe(false);
  });
});
