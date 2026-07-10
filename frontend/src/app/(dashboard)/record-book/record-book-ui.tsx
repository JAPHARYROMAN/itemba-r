'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Btn, Modal } from '@/components/ui';

const NAV_ITEMS = [
  { href: '/record-book', label: 'Dashboard', exact: true },
  { href: '/record-book/daily-sales', label: 'Daily Sales' },
  { href: '/record-book/expenses', label: 'Money Out' },
  { href: '/record-book/categories', label: 'Categories' },
  { href: '/record-book/reports', label: 'Reports' },
  { href: '/record-book/trash', label: 'Trash' },
];

export function RecordBookNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-5 flex flex-wrap gap-2" aria-label="Records Book">
      {NAV_ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
              active
                ? 'border-blue-500 bg-blue-600 text-white'
                : 'border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export interface ConfirmAction {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
  requireReason?: boolean;
  onConfirm: (reason?: string) => Promise<unknown>;
}

export function RecordBookConfirmDialog({
  action,
  reason,
  onReasonChange,
  busy,
  onClose,
}: {
  action: ConfirmAction | null;
  reason: string;
  onReasonChange: (value: string) => void;
  busy: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={Boolean(action)}
      onClose={busy ? () => undefined : onClose}
      title={action?.title ?? 'Confirm action'}
      size="sm"
      dismissOnBackdrop={!busy}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={onClose}>Cancel</Btn>
          <Btn
            variant={action?.tone ?? 'primary'}
            loading={busy}
            disabled={Boolean(action?.requireReason && !reason.trim())}
            onClick={() => action?.onConfirm(reason.trim() || undefined)}
          >
            {action?.confirmLabel ?? 'Confirm'}
          </Btn>
        </>
      }
    >
      <p className="text-sm text-slate-300">{action?.description}</p>
      {action?.requireReason && (
        <label className="mt-4 block text-sm font-medium text-slate-300">
          Reason
          <textarea
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            rows={3}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-blue-500"
            placeholder="Explain why this record is being voided"
          />
        </label>
      )}
    </Modal>
  );
}

export function RecordBookPagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
      <span>{total.toLocaleString()} records</span>
      <div className="flex items-center gap-2">
        <Btn size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Btn>
        <span className="min-w-24 text-center">Page {page} of {totalPages}</span>
        <Btn size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next
        </Btn>
      </div>
    </div>
  );
}

export function recordBookMoney(value: number | string | null | undefined, currency = 'TZS') {
  const amount = Number(value ?? 0);
  return `${currency} ${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function recordBookDate(value: string | null | undefined, withTime = false) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (withTime) return date.toLocaleString();
  return date.toLocaleDateString();
}
