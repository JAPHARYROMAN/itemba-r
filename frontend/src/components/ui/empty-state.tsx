import React from 'react';

interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({
  title = 'No records found',
  description = 'There are no items to display.',
  icon,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-16 text-center animate-fade-up">
      {icon && (
        <div className="mb-4" style={{ color: 'var(--aurora-text-disabled)' }}>
          {icon}
        </div>
      )}
      <h3 className="text-[15px] font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
        {title}
      </h3>
      <p className="mt-1 max-w-xs text-[13px]" style={{ color: 'var(--aurora-text-muted)' }}>
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
