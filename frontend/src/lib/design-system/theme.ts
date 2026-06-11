'use client';

// ITEMBA-R Aurora Design System — Theme Management

export type ThemeMode = 'light' | 'dark' | 'system';
export type MotionMode = 'system' | 'full' | 'reduced';

const THEME_KEY = 'aurora-theme';
const MOTION_KEY = 'aurora-motion';

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
  applyMotionPreference(getStoredMotionPreference());
  if (stored === 'system') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (getStoredTheme() === 'system') {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }
}

export function getStoredMotionPreference(): MotionMode {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem(MOTION_KEY);
  return stored === 'full' || stored === 'reduced' || stored === 'system' ? stored : 'system';
}

export function setStoredMotionPreference(mode: MotionMode): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(MOTION_KEY, mode);
}

export function systemPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function applyMotionPreference(mode: MotionMode): void {
  if (typeof window === 'undefined') return;
  const reduce = mode === 'reduced' || (mode === 'system' && systemPrefersReducedMotion());
  document.documentElement.classList.toggle('motion-reduced', reduce);
}
