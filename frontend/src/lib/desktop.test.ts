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
});
