'use client';

import { ReactNode } from 'react';
import { StatusBadge } from '@/components/ui';

export function moneyNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function fmtMoney(value: unknown, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(moneyNumber(value))}`;
}

export function fmtQty(value: unknown, digits = 2) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(moneyNumber(value));
}

export function fmtDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtDateOnly(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function displayValue(value: ReactNode) {
  if (value === null || value === undefined || value === '') return '-';
  return value;
}

export function DetailSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      className="rounded-xl border p-4"
      style={{
        borderColor: 'var(--aurora-border)',
        background: 'var(--aurora-bg-subtle)',
      }}
    >
      <div className="mb-3">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
          {title}
        </h3>
        {description && (
          <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

export function DetailGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

export function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div
      className="min-w-0 rounded-lg border px-3 py-2"
      style={{
        borderColor: 'var(--aurora-border)',
        background: 'var(--aurora-card)',
      }}
    >
      <div
        className="text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--aurora-text-muted)' }}
      >
        {label}
      </div>
      <div
        className={`mt-1 break-words text-sm ${mono ? 'font-mono' : 'font-medium'}`}
        style={{ color: 'var(--aurora-text)' }}
      >
        {displayValue(value)}
      </div>
    </div>
  );
}

export function MoneyTile({
  label,
  value,
  currency,
  tone = 'default',
}: {
  label: string;
  value: unknown;
  currency?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const color =
    tone === 'success'
      ? '#047857'
      : tone === 'warning'
        ? '#b45309'
        : tone === 'danger'
          ? '#dc2626'
          : 'var(--aurora-text)';

  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{
        borderColor: 'var(--aurora-border)',
        background: 'var(--aurora-card)',
      }}
    >
      <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
        {label}
      </div>
      <div className="mt-2 text-lg font-bold tabular-nums" style={{ color }}>
        {fmtMoney(value, currency)}
      </div>
    </div>
  );
}

export function EmptyDetail({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-lg border border-dashed px-3 py-4 text-center text-sm"
      style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}
    >
      {children}
    </div>
  );
}

export function InlineStatus({ status }: { status?: string | null }) {
  return status ? <StatusBadge status={status} /> : <span>-</span>;
}

export function DetailTable({
  columns,
  rows,
  empty,
}: {
  columns: string[];
  rows: ReactNode;
  empty: ReactNode;
}) {
  return (
    <div
      className="overflow-x-auto rounded-lg border"
      style={{ borderColor: 'var(--aurora-border)' }}
    >
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr
            className="text-left text-[11px] uppercase"
            style={{ color: 'var(--aurora-text-muted)', background: 'var(--aurora-card)' }}
          >
            {columns.map((column) => (
              <th key={column} className="px-3 py-2 font-semibold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: 'var(--aurora-border)' }}>
          {rows || (
            <tr>
              <td colSpan={columns.length} className="px-3 py-5 text-center text-sm">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
