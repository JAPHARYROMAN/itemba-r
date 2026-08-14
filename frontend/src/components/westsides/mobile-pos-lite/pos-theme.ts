'use client';

import { useSyncExternalStore } from 'react';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/safe-storage';

/**
 * Kaunta POS theme (design direction §2.1) — Mchana or Usiku, chosen on the
 * phone and nowhere else.
 *
 * Mchana (daytime: warm paper, ink) is the FORCED default and stays the
 * default on a fresh phone, on a phone whose storage is unreadable, and on a
 * garbage stored value: reps work in Dar sunlight on low-nit LCDs, and the
 * one thing worse than a dark POS in the sun is a dark POS in the sun that
 * nobody chose. Usiku (night: ink navy) is opt-in only, for evening and
 * indoor counters.
 *
 * Deliberately NOT tied to the host ERP theme or to `prefers-color-scheme`:
 * `.pos-shell` pins Mchana under `.dark` for exactly this reason, and the
 * same argument makes the POS-local choice the only input here. The rendering
 * side is pure CSS — `.pos-shell[data-pos-theme='usiku']` in globals.css
 * overrides the `--aurora-*` variables every POS surface already resolves
 * through — so a theme change re-paints the whole shell without a single
 * screen component knowing this module exists.
 *
 * Storage: `itemba-pos-theme` (spec-sales §8 owns the key), values
 * `'mchana' | 'usiku'`, alongside `itemba-pos-lang` / `itemba-pos-haptics`.
 */
export type PosTheme = 'mchana' | 'usiku';

const STORAGE_KEY = 'itemba-pos-theme';
const DEFAULT_THEME: PosTheme = 'mchana';

/**
 * Address-bar / status-bar colour per theme — the two surface colours from
 * the §2.1 table (`--aurora-bg`).
 *
 * §2.1 called for a media-paired `themeColor` (light `#FAF7F0` / dark
 * `#0B1B2B`), but that was written when Usiku was expected to follow the
 * system. It became an explicit persisted choice instead, and media pairing
 * would then darken the chrome for a Mchana rep whose PHONE happens to be in
 * dark mode — a navy bar above a paper-white app, driven by a setting she
 * never touched. So the chrome follows the POS's own theme (applied at
 * runtime by `applyPosThemeChrome`); the page's static `themeColor` export
 * stays Mchana, which is what the boot splash, the activation screen and
 * every classic terminal actually render.
 */
const CHROME_COLOR: Record<PosTheme, string> = {
  mchana: '#faf7f0',
  usiku: '#0b1b2b',
};

const listeners = new Set<() => void>();

/**
 * Only set when a write was REFUSED (private mode, full quota, storage
 * disabled), and cleared the moment one succeeds. It is the rep's most recent
 * intent on a phone that cannot remember it, so it OUTRANKS the stored value:
 * checking storage first would shadow it with the last value that did get
 * written, and the tap would do nothing at all. Concretely — she picks Usiku
 * one evening (written), storage later fills up, and next morning she taps
 * back to Mchana: the write is refused, storage still says 'usiku', and a
 * storage-first read snaps the switch straight back under her finger. A
 * control that does not do what it says is the defect, whatever refused it.
 */
let sessionTheme: PosTheme | null = null;

/** Validated read: only 'usiku' opts in; anything else is the default Mchana. */
export function readPosTheme(): PosTheme {
  if (sessionTheme) return sessionTheme;
  const stored = safeLocalStorageGet(STORAGE_KEY);
  if (stored === 'usiku' || stored === 'mchana') return stored;
  return DEFAULT_THEME;
}

export function setPosTheme(theme: PosTheme): void {
  sessionTheme = safeLocalStorageSet(STORAGE_KEY, theme) ? null : theme;
  // Copy first: a listener that unsubscribes while we notify must not skip
  // the next one in the set.
  for (const listener of [...listeners]) listener();
}

/** Subscribe to theme changes (the shell's `useSyncExternalStore` source). */
export function subscribePosTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The shell's read: re-renders the wrapper (and only the wrapper's attribute
 * matters) whenever any surface calls `setPosTheme`. The server snapshot is
 * the forced default — the shell is client-only, and Mchana is what the
 * static `themeColor` and the first paint already assume.
 */
export function usePosTheme(): PosTheme {
  return useSyncExternalStore(subscribePosTheme, readPosTheme, () => DEFAULT_THEME);
}

/**
 * Point the browser chrome at the POS's chosen theme, returning the undo.
 *
 * The first `meta[name="theme-color"]` is the one browsers honour, so this
 * edits that tag in place (Next renders it from the page's `viewport` export)
 * rather than appending a second one that would be ignored — and restores it
 * on cleanup, so leaving the Kaunta shell hands the chrome back exactly as it
 * was found.
 */
export function applyPosThemeChrome(theme: PosTheme): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const existing = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const previous = existing?.getAttribute('content') ?? null;
  const meta = existing ?? document.createElement('meta');
  if (!existing) {
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', CHROME_COLOR[theme]);
  return () => {
    if (!existing) meta.remove();
    else if (previous === null) meta.removeAttribute('content');
    else meta.setAttribute('content', previous);
  };
}
