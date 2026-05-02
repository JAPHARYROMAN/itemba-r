import React from 'react';

interface AuroraPageHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  className?: string;
}

export function AuroraPageHeader({ title, subtitle, eyebrow, actions, breadcrumbs, className = '' }: AuroraPageHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0 flex-1">
        {breadcrumbs && <div className="mb-2">{breadcrumbs}</div>}
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--aurora-primary)' }}>
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight truncate" style={{ color: 'var(--aurora-text)' }}>
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
