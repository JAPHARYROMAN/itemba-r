import React from 'react';

interface AuroraPageHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  /** Render a gently pulsing dot before the eyebrow — for live/auto-refreshing views. */
  live?: boolean;
  actions?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  className?: string;
}

export function AuroraPageHeader({ title, subtitle, eyebrow, live = false, actions, breadcrumbs, className = '' }: AuroraPageHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0 flex-1">
        {breadcrumbs && <div className="mb-2">{breadcrumbs}</div>}
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-widest mb-1 flex items-center gap-1.5" style={{ color: 'var(--aurora-primary)' }}>
            {live && (
              <span
                className="inline-block h-1.5 w-1.5 rounded-full animate-pulse-subtle"
                style={{ background: 'var(--aurora-success, #10b981)' }}
                aria-hidden="true"
              />
            )}
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
