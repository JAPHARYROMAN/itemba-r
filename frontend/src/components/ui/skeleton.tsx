import React from 'react';

/**
 * Loading skeletons that mirror the *shape* of the content they replace, so the
 * layout doesn't jump when data arrives. Use these instead of a bare spinner
 * wherever the eventual layout is known (cards, tables, forms).
 *
 * Built on the `aurora-skeleton` shimmer utility (globals.css) which already
 * respects prefers-reduced-motion via the global guard.
 */

export function Skeleton({
  className = '',
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={`aurora-skeleton rounded-md ${className}`} style={style} aria-hidden />;
}

export function SkeletonText({
  lines = 3,
  className = '',
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`} aria-busy="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3.5" style={{ width: i === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-xl border p-4 ${className}`}
      style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
      aria-busy="true"
    >
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="mt-3 h-7 w-2/3" />
      <Skeleton className="mt-2 h-3 w-1/2" />
    </div>
  );
}

export function SkeletonCardGrid({
  count = 4,
  className = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={className} aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
      aria-busy="true"
    >
      <div
        className="flex gap-4 border-b px-4 py-3"
        style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex gap-4 border-b px-4 py-3.5 last:border-b-0"
          style={{ borderColor: 'var(--aurora-border)' }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" style={{ opacity: 1 - r * 0.08 }} />
          ))}
        </div>
      ))}
    </div>
  );
}
