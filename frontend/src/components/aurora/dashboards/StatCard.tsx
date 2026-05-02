import React from 'react';

interface StatCardProps {
  title: string;
  value: React.ReactNode;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: { value: number; label?: string };
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  className?: string;
  loading?: boolean;
}

const VARIANT_STYLES = {
  default: { icon: 'var(--aurora-bg-muted)', iconText: 'var(--aurora-text-secondary)' },
  primary: { icon: 'var(--aurora-primary-subtle)', iconText: 'var(--aurora-primary)' },
  success: { icon: '#d1fae5', iconText: '#059669' },
  warning: { icon: '#fef3c7', iconText: '#d97706' },
  danger: { icon: '#fee2e2', iconText: '#dc2626' },
};

export function StatCard({ title, value, subtitle, icon, trend, variant = 'default', className = '', loading = false }: StatCardProps) {
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
            {value}
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
