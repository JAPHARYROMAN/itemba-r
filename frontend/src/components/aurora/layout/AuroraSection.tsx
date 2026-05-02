import React from 'react';

interface AuroraSectionProps {
  id?: string;
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}

export function AuroraSection({ id, title, description, actions, children, className = '', padded = false }: AuroraSectionProps) {
  return (
    <section
      id={id}
      className={`rounded-aurora border ${className}`}
      style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)', boxShadow: 'var(--aurora-shadow-sm)' }}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--aurora-border)' }}>
          <div>
            {title && <h2 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>{title}</h2>}
            {description && <p className="text-xs mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}
