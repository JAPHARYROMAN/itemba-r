'use client';

// ITEMBA-R Aurora Design System — Theme Management

export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_KEY = 'aurora-theme';

export function getStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  return (localStorage.getItem(THEME_KEY) as ThemeMode) || 'system';
}

export function setStoredTheme(mode: ThemeMode): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(THEME_KEY, mode);
}

export function getSystemPreference(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof window === 'undefined') return;
  const effective = mode === 'system' ? getSystemPreference() : mode;
  if (effective === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export function initTheme(): void {
  const stored = getStoredTheme();
  applyTheme(stored);
  if (stored === 'system') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (getStoredTheme() === 'system') {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }
}
