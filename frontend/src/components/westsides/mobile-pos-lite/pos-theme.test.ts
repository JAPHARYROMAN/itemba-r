/**
 * pos-theme — the persisted Mchana/Usiku choice (design direction §2.1,
 * `itemba-pos-theme` per spec-sales §8). Mirrors the pos-haptics suite:
 * validated read, forced default, safe storage, plus the subscription the
 * shell re-themes from and the browser-chrome tag it points at the theme.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPosThemeChrome,
  readPosTheme,
  setPosTheme,
  subscribePosTheme,
  type PosTheme,
} from './pos-theme';

const STORAGE_KEY = 'itemba-pos-theme';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
});

describe('validated read', () => {
  it('defaults to Mchana on a fresh phone (nothing stored)', () => {
    expect(readPosTheme()).toBe('mchana');
  });

  it('treats a garbage stored value as the forced default Mchana', () => {
    window.localStorage.setItem(STORAGE_KEY, 'ndizi');
    expect(readPosTheme()).toBe('mchana');
  });

  it('reads back both real values', () => {
    window.localStorage.setItem(STORAGE_KEY, 'usiku');
    expect(readPosTheme()).toBe('usiku');
    window.localStorage.setItem(STORAGE_KEY, 'mchana');
    expect(readPosTheme()).toBe('mchana');
  });
});

describe('setter and subscription', () => {
  it('persists the exact value and notifies every subscriber', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribePosTheme(first);
    const unsubscribeSecond = subscribePosTheme(second);

    setPosTheme('usiku');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('usiku');
    expect(readPosTheme()).toBe('usiku');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    setPosTheme('mchana');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('mchana');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);

    unsubscribeSecond();
  });

  it('still applies the choice for this session when storage refuses the write', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      setPosTheme('usiku');
      // Nothing was written, but the rep's tap is not swallowed.
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(readPosTheme()).toBe('usiku');
    } finally {
      setItem.mockRestore();
    }
    // A working write clears the session fallback again.
    setPosTheme('mchana');
    expect(readPosTheme()).toBe('mchana');
  });

  it('applies a refused write even when an EARLIER write succeeded, so the switch never snaps back', () => {
    // The case a storage-first read gets wrong, and the one a rep actually
    // meets: she chose Usiku one evening and it was written; storage later
    // fills up; next morning she taps back to Mchana. The write is refused and
    // storage still says 'usiku', so reading storage first would return 'usiku'
    // and flip the switch back under her finger — a control that does nothing.
    setPosTheme('usiku');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('usiku');

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      setPosTheme('mchana');
      // Storage is stale by necessity — the session intent is what renders.
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe('usiku');
      expect(readPosTheme()).toBe('mchana');
    } finally {
      setItem.mockRestore();
    }
  });
});

describe('browser chrome', () => {
  const chromeContent = () =>
    document.head.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null;

  it('creates the tag when the document has none, and removes it on undo', () => {
    const undo = applyPosThemeChrome('usiku');
    expect(chromeContent()).toBe('#0b1b2b');
    undo();
    expect(document.head.querySelector('meta[name="theme-color"]')).toBeNull();
  });

  it('edits the page tag in place and restores it exactly', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', '#faf7f0');
    document.head.appendChild(meta);

    const undo = applyPosThemeChrome('usiku');
    // The first theme-color tag is the one browsers honour — no second tag.
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
    expect(chromeContent()).toBe('#0b1b2b');

    undo();
    expect(chromeContent()).toBe('#faf7f0');
  });

  it('paints Mchana chrome for the default theme', () => {
    const theme: PosTheme = 'mchana';
    const undo = applyPosThemeChrome(theme);
    expect(chromeContent()).toBe('#faf7f0');
    undo();
  });
});
