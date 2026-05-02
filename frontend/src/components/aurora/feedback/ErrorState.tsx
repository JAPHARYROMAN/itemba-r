import React from 'react';

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ title = 'Something went wrong', description, onRetry, className = '' }: ErrorStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-6 text-center ${className}`}>
      <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
        style={{ background: 'var(--aurora-danger-bg, #fee2e2)', color: 'var(--aurora-danger)' }}>
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4m0 4h.01"/>
        </svg>
      </div>
      <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--aurora-text)' }}>{title}</h3>
      {description && <p className="text-sm max-w-xs mb-4" style={{ color: 'var(--aurora-text-muted)' }}>{description}</p>}
      {onRetry && (
        <button onClick={onRetry} className="text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          style={{ background: 'var(--aurora-primary)', color: '#fff' }}>
          Try Again
        </button>
      )}
    </div>
  );
}
