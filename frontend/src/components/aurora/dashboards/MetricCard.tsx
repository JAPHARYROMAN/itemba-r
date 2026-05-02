import React from 'react';

interface MetricCardProps {
  title: string;
  value: React.ReactNode;
  unit?: string;
  description?: string;
  icon?: React.ReactNode;
  trend?: { value: number; period?: string };
  badge?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  prominent?: boolean;
}

export function MetricCard({ title, value, unit, description, icon, trend, badge, footer, className = '', prominent = false }: MetricCardProps) {
  return (
    <div className={`rounded-aurora-lg border p-6 ${prominent ? 'ring-1 ring-blue-500/20' : ''} ${className}`}
      style={{
        background: prominent ? 'linear-gradient(135deg, var(--aurora-card) 0%, var(--aurora-primary-subtle) 100%)' : 'var(--aurora-card)',
        borderColor: prominent ? 'var(--aurora-border-focus)' : 'var(--aurora-border)',
        boxShadow: prominent ? 'var(--aurora-shadow), 0 0 20px rgba(59,130,246,0.08)' : 'var(--aurora-shadow-sm)',
      }}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--aurora-text-muted)' }}>{title}</p>
        <div className="flex items-center gap-2">
          {badge}
          {icon && (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--aurora-primary-subtle)', color: 'var(--aurora-primary)' }}>
              {icon}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-end gap-2 mb-1">
        <span className="aurora-metric leading-none" style={{ fontSize: '2rem', color: 'var(--aurora-text)' }}>{value}</span>
        {unit && <span className="text-sm font-medium pb-1" style={{ color: 'var(--aurora-text-muted)' }}>{unit}</span>}
      </div>
      {description && <p className="text-xs mt-1" style={{ color: 'var(--aurora-text-secondary)' }}>{description}</p>}
      {trend !== undefined && (
        <div className="flex items-center gap-1 mt-2 text-xs font-semibold">
          <span style={{ color: trend.value >= 0 ? 'var(--aurora-success)' : 'var(--aurora-danger)' }}>
            {trend.value >= 0 ? '▲' : '▼'} {Math.abs(trend.value).toFixed(1)}%
          </span>
          {trend.period && <span style={{ color: 'var(--aurora-text-muted)' }}>vs {trend.period}</span>}
        </div>
      )}
      {footer && <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--aurora-border)' }}>{footer}</div>}
    </div>
  );
}
