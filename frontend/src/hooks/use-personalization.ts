'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Navigation personalization store.
 *
 * Provider-less by design (mirrors {@link useTheme}): all state lives in
 * localStorage plus a tiny module-level pub/sub so every consumer — the sidebar,
 * the command palette, the topbar — stays in sync without threading a React
 * context through the tree. Cross-tab consistency comes free via the browser
 * `storage` event.
 *
 * Two independent lists are tracked:
 *  - Favorites: routes the user explicitly pinned (order = pin order).
 *  - Recently viewed: routes visited, most-recent first, capped.
 */

const FAVORITES_KEY = 'itemba.nav.favorites';
const RECENT_KEY = 'itemba.nav.recent';
const MAX_RECENT = 8;

export interface PersonalizationEntry {
  /** Canonical route href, e.g. `/finance/expenses`. Used as the identity. */
  href: string;
  /** Human label captured at record time so the store is self-describing. */
  label: string;
  /** Optional group/section label for grouping in menus. */
  group?: string;
  /** Optional sidebar icon key (keeps rendering consistent across surfaces). */
  iconKey?: string;
}

// ─── Module-level store (shared across all hook instances) ─────────────────────

let favorites: PersonalizationEntry[] = [];
let recent: PersonalizationEntry[] = [];
let loaded = false;

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function safeParse(raw: string | null): PersonalizationEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PersonalizationEntry =>
        e && typeof e === 'object' && typeof e.href === 'string' && typeof e.label === 'string',
    );
  } catch {
    return [];
  }
}

function loadFromStorage() {
  if (loaded || typeof window === 'undefined') return;
  favorites = safeParse(window.localStorage.getItem(FAVORITES_KEY));
  recent = safeParse(window.localStorage.getItem(RECENT_KEY));
  loaded = true;
}

function persistFavorites() {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } catch {
    /* storage unavailable (private mode) — still works for the session */
  }
}

function persistRecent() {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    /* storage unavailable */
  }
}

function normalizeHref(href: string): string {
  // Strip query/hash and trailing slash so `/x?q=1` and `/x/` map to `/x`.
  const clean = href.split(/[?#]/)[0];
  if (clean.length > 1 && clean.endsWith('/')) return clean.slice(0, -1);
  return clean;
}

// ─── Mutations (safe to call outside React) ────────────────────────────────────

export function isFavorite(href: string): boolean {
  loadFromStorage();
  const target = normalizeHref(href);
  return favorites.some((f) => f.href === target);
}

export function addFavorite(entry: PersonalizationEntry) {
  loadFromStorage();
  const href = normalizeHref(entry.href);
  if (favorites.some((f) => f.href === href)) return;
  favorites = [...favorites, { ...entry, href }];
  persistFavorites();
  emit();
}

export function removeFavorite(href: string) {
  loadFromStorage();
  const target = normalizeHref(href);
  const next = favorites.filter((f) => f.href !== target);
  if (next.length === favorites.length) return;
  favorites = next;
  persistFavorites();
  emit();
}

export function toggleFavorite(entry: PersonalizationEntry) {
  if (isFavorite(entry.href)) {
    removeFavorite(entry.href);
  } else {
    addFavorite(entry);
  }
}

/** Record a visited route. Moves it to the front and caps the list. */
export function recordVisit(entry: PersonalizationEntry) {
  loadFromStorage();
  const href = normalizeHref(entry.href);
  // Don't clutter recents with the root/dashboard-less noise; still allow /dashboard.
  if (!href || href === '/') return;
  const withoutDupe = recent.filter((r) => r.href !== href);
  recent = [{ ...entry, href }, ...withoutDupe].slice(0, MAX_RECENT);
  persistRecent();
  emit();
}

export function clearRecent() {
  loadFromStorage();
  if (recent.length === 0) return;
  recent = [];
  persistRecent();
  emit();
}

// ─── React hook ────────────────────────────────────────────────────────────────

export interface UsePersonalizationResult {
  favorites: PersonalizationEntry[];
  recent: PersonalizationEntry[];
  /** True once localStorage has been read (avoids SSR/hydration flicker). */
  hydrated: boolean;
  isFavorite: (href: string) => boolean;
  addFavorite: (entry: PersonalizationEntry) => void;
  removeFavorite: (href: string) => void;
  toggleFavorite: (entry: PersonalizationEntry) => void;
  recordVisit: (entry: PersonalizationEntry) => void;
  clearRecent: () => void;
}

export function usePersonalization(): UsePersonalizationResult {
  const [, setVersion] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    loadFromStorage();
    setHydrated(true);
    setVersion((v) => v + 1);

    const rerender = () => setVersion((v) => v + 1);
    listeners.add(rerender);

    // Cross-tab sync: reload the mutated list and notify all listeners.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== FAVORITES_KEY && event.key !== RECENT_KEY) return;
      if (event.key === FAVORITES_KEY) {
        favorites = safeParse(event.newValue);
      } else {
        recent = safeParse(event.newValue);
      }
      emit();
    };
    window.addEventListener('storage', onStorage);

    return () => {
      listeners.delete(rerender);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const isFav = useCallback((href: string) => isFavorite(href), []);

  return {
    favorites,
    recent,
    hydrated,
    isFavorite: isFav,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    recordVisit,
    clearRecent,
  };
}
