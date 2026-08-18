'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Btn, Card, EmptyState, PageHeader, SkeletonTable } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendDelete, backendGet, backendPatch } from '@/lib/api-client';
import {
  type ConfirmAction,
  RecordBookConfirmDialog,
  RecordBookNav,
  recordBookDate,
  recordBookMoney,
} from './record-book-ui';

type Kind = 'daily-sales' | 'expenses';

interface Person {
  id: string;
  fullName?: string | null;
  email: string;
}

interface BaseRecord {
  id: string;
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  recordDate: string;
  currency: string;
  status: 'DRAFT' | 'FINALIZED' | 'VOIDED';
  notes?: string | null;
  voidReason?: string | null;
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string | null;
  voidedAt?: string | null;
  reopenedAt?: string | null;
  reopenReason?: string | null;
  company?: { name: string; code: string };
  division?: { name: string; code: string } | null;
  branch?: { name: string; code: string } | null;
  createdBy?: Person;
  updatedBy?: Person | null;
  finalizedBy?: Person | null;
  voidedBy?: Person | null;
  reopenedBy?: Person | null;
}

interface DailySale extends BaseRecord {
  totalSalesAmount: number;
  receipts: Array<{
    id: string;
    receiptType: string;
    label?: string | null;
    amount: number;
    reference?: string | null;
    notes?: string | null;
  }>;
}

interface Expense extends BaseRecord {
  amount: number;
  description: string;
  paidTo?: string | null;
  paymentMethod: string;
  paymentLabel?: string | null;
  reference?: string | null;
  expenseCategory?: { id: string; name: string };
}

function personLabel(person?: Person | null) {
  if (!person) return '-';
  return person.fullName ? `${person.fullName} (${person.email})` : person.email;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-100">{value || '-'}</dd>
    </div>
  );
}

export function RecordBookDetailClient({ kind }: { kind: Kind }) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const [record, setRecord] = useState<DailySale | Expense | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const isSale = kind === 'daily-sales';
  const listHref = isSale ? '/record-book/daily-sales' : '/record-book/expenses';

  const load = useCallback(async () => {
    if (!params.id) return;
    setLoading(true);
    setError('');
    try {
      const data = await backendGet<DailySale | Expense>(`/record-book/${kind}/${params.id}`);
      setRecord(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load record');
    } finally {
      setLoading(false);
    }
  }, [kind, params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const request = (
    action: Omit<ConfirmAction, 'onConfirm'> & {
      execute: (reason?: string) => Promise<unknown>;
      after?: () => void;
    },
  ) => {
    setReason('');
    setConfirmAction({
      ...action,
      onConfirm: async (actionReason) => {
        setBusy(true);
        setError('');
        try {
          await action.execute(actionReason);
          setConfirmAction(null);
          action.after?.();
          if (!action.after) await load();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Action failed');
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const actionButtons = record ? (
    <div className="flex flex-wrap gap-2">
      <Link
        href={listHref}
        className="inline-flex items-center rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
      >
        Back to list
      </Link>
      {record.status === 'DRAFT' && hasPermission('record_book.finalize') && (
        <Btn
          variant="success"
          onClick={() =>
            request({
              title: 'Finalize record',
              description: 'This locks the entry until an administrator reopens it.',
              confirmLabel: 'Finalize',
              tone: 'success',
              execute: () => backendPatch(`/record-book/${kind}/${record.id}/finalize`, {}),
            })
          }
        >
          Finalize
        </Btn>
      )}
      {record.status === 'FINALIZED' && hasPermission('record_book.admin') && (
        <Btn
          variant="warning"
          onClick={() =>
            request({
              title: 'Reopen record',
              description:
                'This returns the entry to Draft for correction. Explain why the finalized record must change.',
              confirmLabel: 'Reopen',
              tone: 'warning',
              requireReason: true,
              execute: (reopenReason) =>
                backendPatch(`/record-book/${kind}/${record.id}/reopen`, {
                  reason: reopenReason,
                }),
            })
          }
        >
          Reopen
        </Btn>
      )}
      {record.status !== 'VOIDED' && hasPermission('record_book.void') && (
        <Btn
          variant="danger"
          onClick={() =>
            request({
              title: 'Void record',
              description:
                'The entry remains visible for audit but is excluded from active totals.',
              confirmLabel: 'Void record',
              tone: 'danger',
              requireReason: true,
              execute: (voidReason) =>
                backendPatch(`/record-book/${kind}/${record.id}/void`, { reason: voidReason }),
            })
          }
        >
          Void
        </Btn>
      )}
      {record.status === 'DRAFT' && hasPermission('record_book.delete') && (
        <Btn
          variant="danger"
          onClick={() =>
            request({
              title: 'Move draft to Trash',
              description: 'The record can later be restored by an administrator.',
              confirmLabel: 'Move to Trash',
              tone: 'danger',
              execute: () => backendDelete(`/record-book/${kind}/${record.id}`),
              after: () => router.push('/record-book/trash'),
            })
          }
        >
          Delete
        </Btn>
      )}
    </div>
  ) : undefined;

  return (
    <div className="record-book-workspace mx-auto w-full max-w-[1440px] px-4 pb-10 pt-2 sm:px-6 lg:px-8 xl:px-10">
      <PageHeader
        title={isSale ? 'Daily Sales Record' : 'Money-Out Record'}
        subtitle="Complete scope, value, lifecycle, and audit details"
        actions={actionButtons}
      />
      <RecordBookNav />
      {error && (
        <div className="mb-4 rounded-lg border border-red-700 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {loading ? (
        <SkeletonTable rows={5} cols={4} />
      ) : !record ? (
        <Card>
          <EmptyState
            title="Record not found"
            description="The entry may have been moved to Trash or is outside your company access."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-100">Record overview</h2>
              <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200">
                {record.status}
              </span>
            </div>
            <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Record ID" value={record.id} />
              <Field label="Record Date" value={recordBookDate(record.recordDate)} />
              <Field
                label="Company"
                value={record.company ? `${record.company.code} - ${record.company.name}` : '-'}
              />
              <Field
                label="Division"
                value={
                  record.division
                    ? `${record.division.code} - ${record.division.name}`
                    : 'All divisions'
                }
              />
              <Field
                label="Branch"
                value={
                  record.branch ? `${record.branch.code} - ${record.branch.name}` : 'All branches'
                }
              />
              <Field label="Currency" value={record.currency} />
              <Field
                label={isSale ? 'Total Sales' : 'Amount'}
                value={recordBookMoney(
                  isSale ? (record as DailySale).totalSalesAmount : (record as Expense).amount,
                  record.currency,
                )}
              />
              <Field label="Status" value={record.status} />
            </dl>
          </Card>

          {isSale ? (
            <Card>
              <h2 className="mb-4 text-lg font-semibold text-slate-100">Receipt split</h2>
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/70 text-left text-slate-400">
                    <tr>
                      <th className="px-3 py-3">Method</th>
                      <th className="px-3 py-3">Label</th>
                      <th className="px-3 py-3">Reference</th>
                      <th className="px-3 py-3 text-right">Amount</th>
                      <th className="px-3 py-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(record as DailySale).receipts.map((receipt) => (
                      <tr key={receipt.id} className="border-t border-slate-800">
                        <td className="px-3 py-3">{receipt.receiptType.replace('_', ' ')}</td>
                        <td className="px-3 py-3">{receipt.label || '-'}</td>
                        <td className="px-3 py-3">{receipt.reference || '-'}</td>
                        <td className="px-3 py-3 text-right font-semibold">
                          {recordBookMoney(receipt.amount, record.currency)}
                        </td>
                        <td className="px-3 py-3">{receipt.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <Card>
              <h2 className="mb-4 text-lg font-semibold text-slate-100">Payment details</h2>
              <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Category" value={(record as Expense).expenseCategory?.name} />
                <Field label="Description" value={(record as Expense).description} />
                <Field label="Paid To" value={(record as Expense).paidTo} />
                <Field
                  label="Payment Method"
                  value={(record as Expense).paymentMethod.replace('_', ' ')}
                />
                <Field label="Payment Label" value={(record as Expense).paymentLabel} />
                <Field label="Reference" value={(record as Expense).reference} />
              </dl>
            </Card>
          )}

          <Card>
            <h2 className="mb-4 text-lg font-semibold text-slate-100">Notes and lifecycle</h2>
            <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Notes" value={record.notes} />
              <Field label="Created By" value={personLabel(record.createdBy)} />
              <Field label="Created At" value={recordBookDate(record.createdAt, true)} />
              <Field label="Last Updated By" value={personLabel(record.updatedBy)} />
              <Field label="Last Updated At" value={recordBookDate(record.updatedAt, true)} />
              <Field label="Finalized By" value={personLabel(record.finalizedBy)} />
              <Field label="Finalized At" value={recordBookDate(record.finalizedAt, true)} />
              <Field label="Reopened By" value={personLabel(record.reopenedBy)} />
              <Field label="Reopened At" value={recordBookDate(record.reopenedAt, true)} />
              {record.reopenReason && <Field label="Reopen Reason" value={record.reopenReason} />}
              <Field label="Voided By" value={personLabel(record.voidedBy)} />
              <Field label="Voided At" value={recordBookDate(record.voidedAt, true)} />
              {record.voidReason && <Field label="Void Reason" value={record.voidReason} />}
            </dl>
          </Card>
        </div>
      )}
      <RecordBookConfirmDialog
        action={confirmAction}
        reason={reason}
        onReasonChange={setReason}
        busy={busy}
        onClose={() => {
          setConfirmAction(null);
          setReason('');
        }}
      />
    </div>
  );
}
