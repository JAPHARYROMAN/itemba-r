import React from 'react';

interface SummaryGridProps {
  children: React.ReactNode;
  cols?: 2 | 3 | 4;
  className?: string;
}

export function SummaryGrid({ children, cols = 4, className = '' }: SummaryGridProps) {
  const colClass = {
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  }[cols];
  return <div className={`grid ${colClass} gap-4 ${className}`}>{children}</div>;
}
