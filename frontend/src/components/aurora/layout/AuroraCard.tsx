import React from 'react';

interface AuroraCardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  elevated?: boolean;
  onClick?: () => void;
}

export function AuroraCard({ children, className = '', padding = 'md', elevated = false, onClick }: AuroraCardProps) {
  const padMap = { none: '', sm: 'p-3', md: 'p-5', lg: 'p-6' };
  const shadow = elevated ? 'var(--aurora-shadow)' : 'var(--aurora-shadow-sm)';
  const bg = elevated ? 'var(--aurora-card-elevated)' : 'var(--aurora-card)';

  return (
    <div
      className={`rounded-aurora border ${padMap[padding]} ${onClick ? 'cursor-pointer hover:opacity-95 transition-opacity' : ''} ${className}`}
      style={{ background: bg, borderColor: 'var(--aurora-border)', boxShadow: shadow }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
