import React from 'react';

type StatCardVariant = 'default' | 'blue' | 'green' | 'amber' | 'red' | 'purple';

const VALUE_COLOR: Record<StatCardVariant, string> = {
  default: '',
  blue:    'text-blue-600 dark:text-blue-400',
  green:   'text-green-600 dark:text-green-400',
  amber:   'text-amber-600 dark:text-amber-400',
  red:     'text-red-600 dark:text-red-400',
  purple:  'text-purple-600 dark:text-purple-400',
};

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  variant?: StatCardVariant;
}

export function StatCard({ label, value, hint, icon, variant = 'default' }: StatCardProps) {
  return (
    <div className="border rounded-xl p-4" style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)', boxShadow: 'var(--aurora-shadow-sm)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide leading-none" style={{ color: 'var(--aurora-text-muted)' }}>{label}</p>
          <p className={`text-2xl font-bold mt-2 ${VALUE_COLOR[variant]}`} style={variant === 'default' ? { color: 'var(--aurora-text)' } : undefined}>{value}</p>
          {hint && <p className="text-[11px] mt-1" style={{ color: 'var(--aurora-text-muted)' }}>{hint}</p>}
        </div>
        {icon && (
          <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg" style={{ background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-muted)' }}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
