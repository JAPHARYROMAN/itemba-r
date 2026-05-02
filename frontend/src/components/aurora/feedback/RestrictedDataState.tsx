import React from 'react';

interface RestrictedDataStateProps {
  title?: string;
  requiredPermission?: string;
  compact?: boolean;
  className?: string;
}

export function RestrictedDataState({ title = 'Access Restricted', requiredPermission, compact = false, className = '' }: RestrictedDataStateProps) {
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
        style={{ background: 'var(--aurora-restricted-bg, #ede9fe)', color: 'var(--aurora-restricted)' }}
        title={requiredPermission ? `Requires: ${requiredPermission}` : undefined}>
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
        </svg>
        Restricted
      </span>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center py-10 px-6 text-center ${className}`}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
        style={{ background: 'var(--aurora-restricted-bg, #ede9fe)', color: 'var(--aurora-restricted)' }}>
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
        </svg>
      </div>
      <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--aurora-text)' }}>{title}</h3>
      <p className="text-xs max-w-xs" style={{ color: 'var(--aurora-text-muted)' }}>
        {requiredPermission ? `Requires permission: ${requiredPermission}` : 'You do not have permission to view this data. Contact your system administrator.'}
      </p>
    </div>
  );
}
