'use client';

import { useTheme, type ThemeMode } from '@/hooks/use-theme';

const MODES: Array<{ value: ThemeMode; label: string; icon: React.ReactNode }> = [
  {
    value: 'light',
    label: 'Light theme',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
        <path
          strokeLinecap="round"
          d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        />
      </svg>
    ),
  },
  {
    value: 'system',
    label: 'Follow system theme',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path strokeLinecap="round" d="M8 21h8m-4-4v4" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark theme',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
        />
      </svg>
    ),
  },
];

/**
 * Light / System / Dark segmented control. Styled with aurora tokens so it is
 * correct in both themes without the legacy-class dark bridge.
 */
export function ThemeSelector({ className = '' }: { className?: string }) {
  const { mode, setMode, hydrated } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className={`flex items-center gap-0.5 rounded-lg border p-0.5 ${className}`}
      style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}
    >
      {MODES.map(({ value, label, icon }) => {
        const active = hydrated && mode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setMode(value)}
            className="rounded-md p-1.5 transition-colors"
            style={
              active
                ? {
                    background: 'var(--aurora-card)',
                    color: 'var(--aurora-primary)',
                    boxShadow: 'var(--aurora-shadow-sm)',
                  }
                : { color: 'var(--aurora-text-muted)' }
            }
          >
            {icon}
          </button>
        );
      })}
    </div>
  );
}
