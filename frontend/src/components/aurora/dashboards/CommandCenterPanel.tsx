import React from 'react';

interface CommandCenterPanelProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  dark?: boolean;
  className?: string;
}

export function CommandCenterPanel({ title, subtitle, actions, children, dark = false, className = '' }: CommandCenterPanelProps) {
  return (
    <div className={`rounded-aurora-lg border overflow-hidden ${className}`}
      style={{
        background: dark ? '#09111f' : 'var(--aurora-card)',
        borderColor: dark ? '#1e2d40' : 'var(--aurora-border)',
        boxShadow: dark ? 'var(--aurora-shadow-lg)' : 'var(--aurora-shadow)',
      }}>
      <div className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: dark ? '#1e2d40' : 'var(--aurora-border)', background: dark ? '#0f1a2e' : 'var(--aurora-bg-subtle)' }}>
        <div>
          <h2 className="text-base font-semibold" style={{ color: dark ? '#f1f5f9' : 'var(--aurora-text)' }}>{title}</h2>
          {subtitle && <p className="text-xs mt-0.5" style={{ color: dark ? '#64748b' : 'var(--aurora-text-muted)' }}>{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}
