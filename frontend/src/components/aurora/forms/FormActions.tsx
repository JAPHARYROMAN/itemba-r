import React from 'react';

interface FormActionsProps {
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
  loading?: boolean;
  primaryType?: 'submit' | 'button';
  primaryVariant?: 'primary' | 'danger';
  children?: React.ReactNode;
  sticky?: boolean;
  className?: string;
}

export function FormActions({
  primaryLabel = 'Save',
  secondaryLabel = 'Cancel',
  onPrimary,
  onSecondary,
  loading = false,
  primaryType = 'submit',
  primaryVariant = 'primary',
  children,
  sticky = false,
  className = '',
}: FormActionsProps) {
  const primaryStyle = primaryVariant === 'danger'
    ? { background: 'var(--aurora-danger)', color: '#fff' }
    : { background: 'var(--aurora-primary)', color: '#fff' };

  return (
    <div
      className={`flex items-center justify-end gap-3 pt-4 ${sticky ? 'sticky bottom-0 py-4 border-t' : ''} ${className}`}
      style={sticky ? { background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' } : {}}
    >
      {children}
      {onSecondary && (
        <button
          type="button"
          onClick={onSecondary}
          className="text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          style={{ background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-secondary)', border: '1px solid var(--aurora-border)' }}
        >
          {secondaryLabel}
        </button>
      )}
      <button
        type={primaryType}
        onClick={onPrimary}
        disabled={loading}
        className="text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
        style={primaryStyle}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            Saving...
          </span>
        ) : primaryLabel}
      </button>
    </div>
  );
}
