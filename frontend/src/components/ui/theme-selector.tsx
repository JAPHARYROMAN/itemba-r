'use client';

import type { LucideIcon } from 'lucide-react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemeMode } from '@/hooks/use-theme';

const MODES: Array<{ value: ThemeMode; label: string; icon: LucideIcon }> = [
  {
    value: 'light',
    label: 'Light theme',
    icon: Sun,
  },
  {
    value: 'system',
    label: 'Follow system theme',
    icon: Monitor,
  },
  {
    value: 'dark',
    label: 'Dark theme',
    icon: Moon,
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
      {MODES.map(({ value, label, icon: Icon }) => {
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
            <Icon aria-hidden className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
