import React from 'react';

interface FormSectionProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  columns?: 1 | 2 | 3;
  className?: string;
}

export function FormSection({ title, description, children, columns = 2, className = '' }: FormSectionProps) {
  const gridClass = { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' }[columns];
  return (
    <div className={`${className}`}>
      {(title || description) && (
        <div className="mb-4">
          {title && <h3 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>{title}</h3>}
          {description && <p className="text-xs mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>{description}</p>}
        </div>
      )}
      <div className={`grid ${gridClass} gap-4`}>{children}</div>
    </div>
  );
}
