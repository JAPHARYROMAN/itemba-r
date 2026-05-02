import React from 'react';

interface AuroraToolbarProps {
  title?: string;
  description?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function AuroraToolbar({
  actions,
  children,
  className = '',
  description,
  meta,
  title,
}: AuroraToolbarProps) {
  return (
    <div
      className={`rounded-aurora border ${className}`}
      style={{
        background: 'var(--aurora-card)',
        borderColor: 'var(--aurora-border)',
        boxShadow: 'var(--aurora-shadow-sm)',
      }}
    >
      <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
        {(title || description || meta) && (
          <div className="min-w-0">
            {title && (
              <h2 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-0.5 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                {description}
              </p>
            )}
            {meta && <div className="mt-1 flex flex-wrap items-center gap-2">{meta}</div>}
          </div>
        )}
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && (
        <div
          className="border-t px-4 py-3"
          style={{ borderColor: 'var(--aurora-border)' }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
