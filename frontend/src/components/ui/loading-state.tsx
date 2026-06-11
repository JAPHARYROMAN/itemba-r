import { Skeleton } from './skeleton';

interface LoadingStateProps {
  rows?: number;
  label?: string;
}

interface PageSpinnerProps {
  label?: string;
  className?: string;
}

export function LoadingState({ rows = 5, label = 'Loading content' }: LoadingStateProps) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 rounded-lg" style={{ opacity: 1 - i * 0.08 }} />
      ))}
    </div>
  );
}

export function PageSpinner({ label = 'Loading', className = '' }: PageSpinnerProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 py-20 ${className}`}
      aria-busy="true"
      aria-live="polite"
      role="status"
    >
      <svg
        className="h-8 w-8 animate-spin"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        style={{ color: 'var(--aurora-primary)' }}
        aria-hidden
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {label ? (
        <p className="text-sm font-medium" style={{ color: 'var(--aurora-text-muted)' }}>{label}</p>
      ) : (
        <span className="sr-only">Loading</span>
      )}
    </div>
  );
}
