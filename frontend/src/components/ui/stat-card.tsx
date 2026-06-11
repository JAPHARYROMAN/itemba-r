'use client';
import React from 'react';
import { useCountUp } from '@/hooks/use-count-up';
import { Sparkline } from './sparkline';

type StatCardVariant = 'default' | 'blue' | 'green' | 'amber' | 'red' | 'purple';
type StatCardTier = 'default' | 'prominent' | 'critical';

const VALUE_COLOR: Record<StatCardVariant, string> = {
  default: '',
  blue: 'text-blue-600 dark:text-blue-400',
  green: 'text-green-600 dark:text-green-400',
  amber: 'text-amber-600 dark:text-amber-400',
  red: 'text-red-600 dark:text-red-400',
  purple: 'text-purple-600 dark:text-purple-400',
};

const TIER_SHADOW: Record<StatCardTier, string> = {
  default: 'var(--aurora-shadow-sm)',
  prominent: 'var(--aurora-shadow-prominent)',
  critical: 'var(--aurora-glow-accent)',
};

export interface StatCardTrend {
  /** Signed percentage or delta; sign drives the arrow. */
  value: number;
  /** e.g. "vs yesterday". */
  label?: string;
  /** Override the good/bad color (defaults: up = good/emerald, down = red). */
  positive?: boolean;
}

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  variant?: StatCardVariant;
  /** Elevation/prominence. `critical` adds a brass glow for must-see metrics. */
  tier?: StatCardTier;
  /** Small trend pill under the value. */
  trend?: StatCardTrend;
  /** Animate numeric values up on mount. Default true; ignored for strings. */
  countUp?: boolean;
  /** Mini series rendered along the card bottom (oldest first, >= 2 points). */
  sparkline?: number[];
}

function AnimatedNumber({ target, enabled }: { target: number; enabled: boolean }) {
  const counted = useCountUp(enabled ? target : NaN);
  const shown = enabled && Number.isFinite(counted) ? counted : target;
  const formatted = Number.isInteger(target)
    ? Math.round(shown).toLocaleString()
    : shown.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return <>{formatted}</>;
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  variant = 'default',
  tier = 'default',
  trend,
  countUp = true,
  sparkline,
}: StatCardProps) {
  const isNumeric = typeof value === 'number' && Number.isFinite(value);
  const trendUp = trend ? trend.value >= 0 : false;
  const trendGood = trend?.positive ?? trendUp;

  return (
    <div
      className="rounded-xl border p-4 transition-shadow duration-200 hover:shadow-md"
      style={{
        background: 'var(--aurora-card)',
        borderColor: 'var(--aurora-border)',
        boxShadow: TIER_SHADOW[tier],
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className="text-[11px] font-medium uppercase tracking-wide leading-none"
            style={{ color: 'var(--aurora-text-muted)' }}
          >
            {label}
          </p>
          <p
            className={`aurora-display mt-2 text-2xl ${VALUE_COLOR[variant]}`}
            style={variant === 'default' ? { color: 'var(--aurora-text)' } : undefined}
          >
            {isNumeric ? <AnimatedNumber target={value} enabled={countUp} /> : value}
          </p>
          {trend && (
            <span
              className="mt-2 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none"
              style={{
                background: trendGood ? 'var(--aurora-success-bg)' : 'var(--aurora-danger-bg)',
                color: trendGood ? 'var(--aurora-success-text)' : 'var(--aurora-danger-text)',
              }}
            >
              <span aria-hidden>{trendUp ? '▲' : '▼'}</span>
              {Math.abs(trend.value)}%{trend.label ? <span className="font-normal opacity-80">{trend.label}</span> : null}
            </span>
          )}
          {hint && (
            <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
              {hint}
            </p>
          )}
        </div>
        {icon && (
          <div
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-muted)' }}
          >
            {icon}
          </div>
        )}
      </div>
      {sparkline && sparkline.length >= 2 && (
        <Sparkline data={sparkline} height={28} className="mt-3 block" />
      )}
    </div>
  );
}
