import React from 'react';

interface FormShellProps {
  onSubmit?: (e: React.FormEvent) => void;
  children: React.ReactNode;
  className?: string;
}

export function FormShell({ onSubmit, children, className = '' }: FormShellProps) {
  return (
    <form onSubmit={onSubmit} className={`space-y-6 ${className}`} noValidate>
      {children}
    </form>
  );
}
