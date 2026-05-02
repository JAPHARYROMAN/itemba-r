import React from 'react';

interface ChartCardProps {
  title: string;
  value?: React.ReactNode;
  subtitle?: string;
  chart?: React.ReactNode;
  height?: number;
  emptyText?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function ChartCard({
  title,
  value,
  subtitle,
  chart,
  height = 200,
  emptyText = 'Chart data will appear here',
  actions,
  className = '',
}: ChartCardProps) {
  return (
    <div
      className={`rounded-aurora border overflow-hidden ${className}`}
      style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)', boxShadow: 'var(--aurora-shadow-sm)' }}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--aurora-border)' }}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--aurora-text-muted)' }}>{title}</p>
          {value && <p className="aurora-metric text-xl mt-0.5" style={{ color: 'var(--aurora-text)' }}>{value}</p>}
          {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>{subtitle}</p>}
        </div>
        {actions && <div>{actions}</div>}
      </div>
      <div style={{ height, minHeight: height }}>
        {chart ?? (
          <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
            {emptyText}
          </div>
        )}
      </div>
    </div>
  );
}
