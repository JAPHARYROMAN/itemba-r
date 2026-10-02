import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE,
  accentForeground,
  fitBounds,
  parseAppearance,
  parseDesktopSession,
  windowBounds,
} from './desktop';

describe('desktop recovery boundaries', () => {
  it('rejects executable and cross-origin locations in stored layouts', () => {
    const windows = [
      'javascript:alert(1)',
      '//evil.test/',
      '/invoice-desk\\bad',
      '/invoice-desk',
    ].map((href, i) => ({
      id: `window-${i}`,
      appId: 'invoice-desk',
      href,
      bounds: {},
      mode: 'floating',
    }));
    expect(parseDesktopSession({ version: 1, windows }).windows.map((w) => w.href)).toEqual([
      '/invoice-desk',
    ]);
  });
  it('preserves separate instances of the same application', () => {
    const windows = ['a', 'b'].map((id, i) => ({
      id,
      appId: 'invoice-desk',
      href: `/invoice-desk?record=${i}`,
      bounds: { x: 40 + i * 80, y: 20, width: 900, height: 600 },
      mode: 'floating',
      minimized: i === 1,
    }));
    const result = parseDesktopSession({ version: 1, windows, activeId: 'a' });
    expect(result.windows).toEqual(windows);
    expect(result.activeId).toBe('a');
  });
  it('keeps restored windows reachable after changing monitor size', () => {
    expect(fitBounds({ x: 2000, y: 1500, width: 1600, height: 1000 }, 768, 700)).toEqual({
      x: 8,
      y: 8,
      width: 752,
      height: 684,
    });
    const window = {
      id: 'a',
      appId: 'invoice-desk',
      href: '/invoice-desk',
      mode: 'bottom-right' as const,
      bounds: { x: 0, y: 0, width: 900, height: 600 },
      minimized: false,
    };
    expect(windowBounds(window, 1440, 900)).toEqual({ x: 724, y: 454, width: 708, height: 438 });
  });
  it('validates custom colours and clamps expensive appearance settings', () => {
    const result = parseAppearance({
      ...DEFAULT_APPEARANCE,
      accent: 'url(evil)',
      blur: 500,
      iconSize: -1,
      pinnedApps: ['unknown', 'invoice-desk', 'invoice-desk'],
    });
    expect(result.accent).toBe(DEFAULT_APPEARANCE.accent);
    expect(result.blur).toBe(40);
    expect(result.iconSize).toBe(36);
    expect(result.pinnedApps).toEqual(['invoice-desk']);
    expect(accentForeground('#ffffff')).toBe('#000000');
    expect(accentForeground('#000000')).toBe('#ffffff');
  });
  it.each([
    [390, 802],
    [768, 982],
    [1440, 858],
    [1920, 1038],
  ])('maximises edge to edge in a %i by %i workspace', (width, height) => {
    const bounds = { x: 72, y: 32, width: 900, height: 600 };
    expect(
      windowBounds(
        {
          id: 'a',
          appId: 'records',
          href: '/records',
          bounds,
          mode: 'maximized',
          minimized: false,
        },
        width,
        height,
      ),
    ).toEqual({ x: 0, y: 0, width, height });
    // Maximising doesn't overwrite the arrangement used by Restore.
    expect(bounds).toEqual({ x: 72, y: 32, width: 900, height: 600 });
  });
  it('aligns resized and snapped windows to whole pixels, including odd-sized displays', () => {
    expect(fitBounds({ x: 72.3, y: 32.8, width: 640.6, height: 500.2 }, 1441, 859)).toEqual({
      x: 72,
      y: 33,
      width: 641,
      height: 500,
    });
    const base = {
      id: 'a',
      appId: 'records',
      href: '/records',
      minimized: false,
      bounds: { x: 72, y: 32, width: 900, height: 600 },
    };
    const left = windowBounds({ ...base, mode: 'top-left' }, 1441, 859);
    const right = windowBounds({ ...base, mode: 'bottom-right' }, 1441, 859);
    expect(Object.values(left).every(Number.isInteger)).toBe(true);
    expect(Object.values(right).every(Number.isInteger)).toBe(true);
    expect(left.x).toBe(8);
    expect(left.y).toBe(8);
    expect(right.x + right.width).toBe(1433);
    expect(right.y + right.height).toBe(851);
    expect(right.x - (left.x + left.width)).toBe(9);
  });
  it('keeps floating windows clear of the dock while maximised windows use the full area', () => {
    const base = {
      id: 'a',
      appId: 'records',
      href: '/records',
      minimized: false,
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
    };
    for (const insets of [
      { left: 12, right: 12, bottom: 100 },
      { left: 100, right: 12, bottom: 14 },
      { left: 12, right: 100, bottom: 14 },
    ]) {
      const frame = windowBounds({ ...base, mode: 'floating' }, 1440, 900, insets);
      expect(frame.x).toBeGreaterThanOrEqual(insets.left + 8);
      expect(frame.x + frame.width).toBeLessThanOrEqual(1440 - insets.right - 8);
      expect(frame.y + frame.height).toBeLessThanOrEqual(900 - insets.bottom - 8);
      expect(windowBounds({ ...base, mode: 'maximized' }, 1440, 900, insets)).toEqual({
        x: 0,
        y: 0,
        width: 1440,
        height: 900,
      });
    }
  });
});
