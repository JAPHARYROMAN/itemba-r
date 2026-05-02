import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export function Card({ children, className = '', padding = 'md' }: CardProps) {
  const pad = { none: '', sm: 'p-4', md: 'p-5', lg: 'p-6' }[padding];
  return (
    <div
      className={`rounded-xl ${pad} ${className}`}
      style={{
        background: 'var(--aurora-card)',
        border: '1px solid var(--aurora-border)',
        color: 'var(--aurora-text)',
        boxShadow: 'var(--aurora-shadow-sm)',
      }}
    >
      {children}
    </div>
  );
}
