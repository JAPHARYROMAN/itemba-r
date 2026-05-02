import React from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-6 text-center ${className}`}>
      {icon ? (
        <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
          style={{ background: 'var(--aurora-bg-muted)', color: 'var(--aurora-text-muted)' }}>
          {icon}
        </div>
      ) : (
        <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
          style={{ background: 'var(--aurora-bg-muted)', color: 'var(--aurora-text-muted)' }}>
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 01-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 011-.01l7-2.5 7 2.5a1 1 0 011 1z"/>
          </svg>
        </div>
      )}
      <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--aurora-text)' }}>{title}</h3>
      {description && <p className="text-sm max-w-xs" style={{ color: 'var(--aurora-text-muted)' }}>{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
