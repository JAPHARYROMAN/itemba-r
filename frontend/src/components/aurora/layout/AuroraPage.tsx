import React from 'react';

interface AuroraPageProps {
  children: React.ReactNode;
  className?: string;
}

export function AuroraPage({ children, className = '' }: AuroraPageProps) {
  return (
    <div className={`p-6 space-y-6 min-h-full ${className}`} style={{ background: 'var(--aurora-bg)' }}>
      {children}
    </div>
  );
}
