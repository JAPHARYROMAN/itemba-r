'use client';

import React from 'react';
import { useCountUp } from '@/hooks/use-count-up';

interface StatCardProps {
  title: string;
  value: React.ReactNode;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: { value: number; label?: string };
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  className?: string;
  loading?: boolean;
  countUp?: boolean;
}

const VARIANT_STYLES = {
  default: { icon: 'var(--aurora-bg-muted)', iconText: 'var(--aurora-text-secondary)' },
  primary: { icon: 'var(--aurora-primary-subtle)', iconText: 'var(--aurora-primary)' },
  success: { icon: 'var(--aurora-success-bg)', iconText: 'var(--aurora-success-text)' },
  warning: { icon: 'var(--aurora-warning-bg)', iconText: 'var(--aurora-warning-text)' },
  danger: { icon: 'var(--aurora-danger-bg)', iconText: 'var(--aurora-danger-text)' },
};

function AnimatedValue({ value, countUp }: { value: React.ReactNode; countUp: boolean }) {
  const numeric = typeof value === 'number' && Number.isFinite(value);
  const counted = useCountUp(numeric && countUp ? value : NaN);

  if (!numeric) return <>{value}</>;

  const shown = countUp && Number.isFinite(counted) ? counted : value;
  const formatted = Number.isInteger(value)
    ? Math.round(shown).toLocaleString()
    : shown.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return <>{formatted}</>;
}

export function StatCard({ title, value, subtitle, icon, trend, variant = 'default', className = '', loading = false, countUp = true }: StatCardProps) {
  const vstyle = VARIANT_STYLES[variant];

  if (loading) {
    return (
      <div className={`rounded-aurora border p-5 ${className}`}
        style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)', boxShadow: 'var(--aurora-shadow-sm)' }}>
        <div className="space-y-3">
          <div className="h-3 w-24 rounded aurora-skeleton" style={{ background: 'var(--aurora-bg-muted)' }} />
          <div className="h-8 w-32 rounded aurora-skeleton" style={{ background: 'var(--aurora-bg-muted)' }} />
          <div className="h-3 w-16 rounded aurora-skeleton" style={{ background: 'var(--aurora-bg-muted)' }} />
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-aurora border p-5 ${className}`}
      style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)', boxShadow: 'var(--aurora-shadow-sm)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--aurora-text-muted)' }}>
            {title}
          </p>
          <div className="aurora-metric text-2xl font-bold" style={{ color: 'var(--aurora-text)', letterSpacing: '-0.02em' }}>
            <AnimatedValue value={value} countUp={countUp} />
          </div>
          {subtitle && (
            <p className="text-xs mt-1.5" style={{ color: 'var(--aurora-text-muted)' }}>{subtitle}</p>
          )}
          {trend !== undefined && (
            <div className="flex items-center gap-1 mt-2 text-xs font-medium">
              <span style={{ color: trend.value >= 0 ? 'var(--aurora-success)' : 'var(--aurora-danger)' }}>
                {trend.value >= 0 ? '▲' : '▼'} {Math.abs(trend.value)}%
              </span>
              {trend.label && <span style={{ color: 'var(--aurora-text-muted)' }}>{trend.label}</span>}
            </div>
          )}
        </div>
        {icon && (
          <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: vstyle.icon, color: vstyle.iconText }}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
