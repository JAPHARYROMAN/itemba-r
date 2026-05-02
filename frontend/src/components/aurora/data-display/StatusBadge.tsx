import { STATUS_CLASSES, DOT_CLASSES, type StatusVariant, getStatusVariant } from '@/lib/design-system/status';
import { formatStatusLabel } from '@/lib/design-system/formatters';

interface StatusBadgeProps {
  status: string | null | undefined;
  variant?: StatusVariant;
  size?: 'sm' | 'md';
  dot?: boolean;
  className?: string;
}

export function StatusBadge({ status, variant, size = 'md', dot = true, className = '' }: StatusBadgeProps) {
  if (!status) return <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>—</span>;
  const v = variant ?? getStatusVariant(status);
  const colorClass = STATUS_CLASSES[v];
  const dotClass = DOT_CLASSES[v];
  const sizeClass = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs px-2.5 py-1';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${sizeClass} ${colorClass} ${className}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`} />}
      {formatStatusLabel(status)}
    </span>
  );
}
