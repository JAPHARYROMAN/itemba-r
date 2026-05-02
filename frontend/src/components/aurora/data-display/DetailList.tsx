import React from 'react';

interface DetailItem {
  label: string;
  value: React.ReactNode;
  fullWidth?: boolean;
  sensitive?: boolean;
}

interface DetailListProps {
  items: DetailItem[];
  columns?: 1 | 2 | 3;
  className?: string;
}

export function DetailList({ items, columns = 2, className = '' }: DetailListProps) {
  const gridClass = { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' }[columns];
  return (
    <dl className={`grid ${gridClass} gap-x-6 gap-y-4 ${className}`}>
      {items.map((item, i) => (
        <div key={i} className={item.fullWidth ? 'col-span-full' : ''}>
          <dt className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--aurora-text-muted)' }}>
            {item.label}
          </dt>
          <dd className="text-sm font-medium" style={{ color: item.sensitive ? 'var(--aurora-restricted)' : 'var(--aurora-text)' }}>
            {item.value ?? <span style={{ color: 'var(--aurora-text-muted)' }}>—</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
