/**
 * pos-haptics — the four Kaunta patterns and the persisted toggle gate
 * (design direction §2.5). Covers: exact patterns, default-ON validated read,
 * off-gating, garbage-value recovery, and the no-vibrate-API no-op.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isHapticsEnabled,
  reject,
  setHapticsEnabled,
  stampHeld,
  stampSent,
  tick,
} from './pos-haptics';

const vibrate = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  vibrate.mockClear();
  Object.defineProperty(window.navigator, 'vibrate', { configurable: true, value: vibrate });
});

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'vibrate');
});

describe('patterns', () => {
  it('fires exactly the four documented patterns', () => {
    tick();
    stampSent();
    stampHeld();
    reject();
    expect(vibrate.mock.calls).toEqual([[15], [[30, 40, 30]], [[80]], [[60, 40, 60]]]);
  });
});

describe('toggle gate', () => {
  it('defaults ON with nothing stored', () => {
    expect(isHapticsEnabled()).toBe(true);
    tick();
    expect(vibrate).toHaveBeenCalledWith(15);
  });

  it('treats a garbage stored value as the default ON (validated read)', () => {
    window.localStorage.setItem('itemba-pos-haptics', 'banana');
    expect(isHapticsEnabled()).toBe(true);
  });

  it('setHapticsEnabled(false) persists "off" and silences every pattern', () => {
    setHapticsEnabled(false);
    expect(window.localStorage.getItem('itemba-pos-haptics')).toBe('off');
    expect(isHapticsEnabled()).toBe(false);
    tick();
    stampSent();
    stampHeld();
    reject();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('setHapticsEnabled(true) persists "on" and re-arms the patterns', () => {
    setHapticsEnabled(false);
    setHapticsEnabled(true);
    expect(window.localStorage.getItem('itemba-pos-haptics')).toBe('on');
    stampHeld();
    expect(vibrate).toHaveBeenCalledWith([80]);
  });
});

describe('missing API', () => {
  it('no-ops without navigator.vibrate', () => {
    Reflect.deleteProperty(window.navigator, 'vibrate');
    expect(() => {
      tick();
      stampSent();
      stampHeld();
      reject();
    }).not.toThrow();
  });
});
