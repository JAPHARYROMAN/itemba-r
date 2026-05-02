'use client';
import { useEffect, useState } from 'react';
import { type ThemeMode, getStoredTheme, setStoredTheme, applyTheme } from '@/lib/design-system/theme';

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>('system');

  useEffect(() => {
    setMode(getStoredTheme());
  }, []);

  function cycle() {
    const next: ThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
    setMode(next);
    setStoredTheme(next);
    applyTheme(next);
  }

  const icons: Record<ThemeMode, React.ReactNode> = {
    light: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="5" />
        <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
    dark: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    ),
    system: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8m-4-4v4" />
      </svg>
    ),
  };

  const labels: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'Auto' };

  return (
    <button
      onClick={cycle}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
      style={{
        color: 'var(--aurora-text-secondary)',
        background: 'var(--aurora-bg-subtle)',
        border: '1px solid var(--aurora-border)',
      }}
      title={`Theme: ${labels[mode]} — Click to cycle`}
      aria-label={`Current theme: ${labels[mode]}. Click to change.`}
    >
      {icons[mode]}
      <span className="hidden sm:block">{labels[mode]}</span>
    </button>
  );
}
