import React from 'react';
import { StatusBadge } from './StatusBadge';

interface RecordHeaderProps {
  title: string;
  subtitle?: string;
  status?: string;
  statusVariant?: string;
  meta?: Array<{ label: string; value: React.ReactNode }>;
  actions?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}

export function RecordHeader({ title, subtitle, status, meta, actions, badge, className = '' }: RecordHeaderProps) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b ${className}`}
      style={{ borderColor: 'var(--aurora-border)' }}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--aurora-text)' }}>{title}</h1>
          {status && <StatusBadge status={status} />}
          {badge}
        </div>
        {subtitle && <p className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>{subtitle}</p>}
        {meta && meta.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
            {meta.map((m, i) => (
              <span key={i} className="text-xs flex items-center gap-1" style={{ color: 'var(--aurora-text-muted)' }}>
                <span className="font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>{m.label}:</span>
                {m.value}
              </span>
            ))}
          </div>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
