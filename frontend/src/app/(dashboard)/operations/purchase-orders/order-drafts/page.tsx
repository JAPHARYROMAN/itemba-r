'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Copy, FilePlus2, Send, Trash2 } from 'lucide-react';
import {
  Btn,
  Card,
  ConfirmDialog,
  EmptyState,
  FormSelect,
  PageHeader,
  PageToolbar,
  SkeletonTable,
  StatCard,
  StatusBadge,
  showToast,
} from '@/components/ui';
import {
  backendDelete,
  backendGet,
  backendList,
  backendPatch,
  backendPost,
} from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { PurchaseOrderTabs } from '../_components/PurchaseOrderTabs';
import { SupplierOrderDraftForm } from '../_components/SupplierOrderDraftForm';
import type {
  BranchOption,
  CompanyOption,
  DivisionOption,
  SupplierOption,
  SupplierOrderDraft,
  SupplierOrderDraftStatus,
} from '../_components/supplier-order-draft-types';
import { dateOnly, money } from '../_components/supplier-order-draft-types';

interface DraftListResponse {
  data: SupplierOrderDraft[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: Array<{ status: SupplierOrderDraftStatus; count: number; totalAmount: number }>;
}

type PendingAction = {
  draft: SupplierOrderDraft;
  action: 'send' | 'accept' | 'decline' | 'reopen' | 'cancel' | 'delete';
};

const statuses: SupplierOrderDraftStatus[] = ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'CANCELLED'];

export default function SupplierOrderDraftsPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [data, setData] = useState<DraftListResponse | null>(null);
  const [companyId, setCompanyId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [divisions, setDivisions] = useState<DivisionOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SupplierOrderDraft | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [acting, setActing] = useState(false);

  const canView = hasPermission('supplier_order_drafts.view');
  const canCreate = hasPermission('supplier_order_drafts.create');
  const canUpdate = hasPermission('supplier_order_drafts.update');
  const canSend = hasPermission('supplier_order_drafts.send');
  const canManage = hasPermission('supplier_order_drafts.manage');

  useEffect(() => {
    if (!canView) return;
    backendList<CompanyOption>('/companies', { query: { limit: 500 } })
      .then(setCompanies)
      .catch(() => setCompanies([]));
  }, [canView]);

  useEffect(() => {
    if (!companyId) {
      setDivisions([]);
      setBranches([]);
      setSuppliers([]);
      return;
    }
    Promise.all([
      backendList<DivisionOption>('/divisions', { query: { companyId, limit: 200 } }),
      backendList<BranchOption>('/branches', {
        query: { companyId, activeOnly: true, limit: 500 },
      }),
      backendList<SupplierOption>('/suppliers', { query: { companyId, limit: 500 } }),
    ])
      .then(([divisionRows, branchRows, supplierRows]) => {
        setDivisions(divisionRows);
        setBranches(branchRows);
        setSuppliers(supplierRows);
      })
      .catch(() => {
        setDivisions([]);
        setBranches([]);
        setSuppliers([]);
      });
  }, [companyId]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const result = await backendGet<DraftListResponse>('/supplier-order-drafts', {
        query: {
          companyId: companyId || undefined,
          divisionId: divisionId || undefined,
          branchId: branchId || undefined,
          supplierId: supplierId || undefined,
          status: status || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          search: search || undefined,
          page,
          limit: 25,
        },
      });
      setData(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load supplier order drafts');
    } finally {
      setLoading(false);
    }
  }, [
    canView,
    companyId,
    divisionId,
    branchId,
    supplierId,
    status,
    dateFrom,
    dateTo,
    search,
    page,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const summary = useMemo(
    () => new Map((data?.summary ?? []).map((row) => [row.status, row])),
    [data],
  );

  async function duplicate(draft: SupplierOrderDraft) {
    try {
      const copy = await backendPost<SupplierOrderDraft>(
        `/supplier-order-drafts/${draft.id}/duplicate`,
      );
      showToast('success', `Created ${copy.draftNumber}`);
      await load();
    } catch (cause) {
      showToast(
        'error',
        'Could not duplicate draft',
        cause instanceof Error ? cause.message : undefined,
      );
    }
  }

  async function executePending() {
    if (!pending) return;
    setActing(true);
    try {
      if (pending.action === 'delete')
        await backendDelete(`/supplier-order-drafts/${pending.draft.id}`);
      else await backendPatch(`/supplier-order-drafts/${pending.draft.id}/${pending.action}`, {});
      showToast(
        'success',
        `Supplier order draft ${pending.action === 'send' ? 'marked as sent' : `${pending.action}d`}`,
      );
      setPending(null);
      await load();
    } catch (cause) {
      showToast(
        'error',
        `Could not ${pending.action} draft`,
        cause instanceof Error ? cause.message : undefined,
      );
    } finally {
      setActing(false);
    }
  }

  if (!canView)
    return (
      <div className="p-6">
        <PageHeader title="Supplier Order Drafts" subtitle="Access restricted" />
      </div>
    );

  return (
    <div className="space-y-5 p-6">
      {(creating || editing) && (
        <SupplierOrderDraftForm
          open
          companies={companies}
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void load();
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(pending)}
        title={`${pending?.action ? pending.action[0].toUpperCase() + pending.action.slice(1) : ''} supplier order draft`}
        message={
          pending?.action === 'delete'
            ? 'This soft-deletes the planning document. It does not affect any purchase order or stock record.'
            : `Confirm that you want to ${pending?.action} ${pending?.draft.draftNumber}.`
        }
        confirmLabel={
          pending?.action === 'send'
            ? 'Mark Sent'
            : pending?.action === 'delete'
              ? 'Delete Draft'
              : 'Confirm'
        }
        variant={
          pending?.action === 'delete' ||
          pending?.action === 'cancel' ||
          pending?.action === 'decline'
            ? 'danger'
            : 'default'
        }
        loading={acting}
        onConfirm={executePending}
        onClose={() => setPending(null)}
      />

      <PageHeader
        title="Purchase Orders"
        subtitle="Actual purchasing and independent supplier-facing planning drafts"
      />
      <PurchaseOrderTabs />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="All Drafts" value={data?.total ?? 0} />
        <StatCard label="Draft" value={summary.get('DRAFT')?.count ?? 0} />
        <StatCard label="Sent" value={summary.get('SENT')?.count ?? 0} />
        <StatCard label="Accepted" value={summary.get('ACCEPTED')?.count ?? 0} />
        <StatCard label="Accepted Value" value={money(summary.get('ACCEPTED')?.totalAmount ?? 0)} />
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] text-blue-800">
        Supplier Order Drafts are planning documents only. Sending or accepting one never creates
        inventory, payables, journals, GRNs, tax entries, procurement activity, or an actual
        Purchase Order.
      </div>

      <PageToolbar
        search={search}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Draft number, supplier, title, or item"
        filters={
          <>
            <FormSelect
              aria-label="Company"
              className="min-w-48"
              value={companyId}
              onChange={(event) => {
                setCompanyId(event.target.value);
                setDivisionId('');
                setBranchId('');
                setSupplierId('');
                setPage(1);
              }}
              placeholder="All companies"
              options={companies.map((company) => ({ value: company.id, label: company.name }))}
            />
            <FormSelect
              aria-label="Division"
              value={divisionId}
              onChange={(event) => {
                setDivisionId(event.target.value);
                setBranchId('');
                setPage(1);
              }}
              placeholder="All divisions"
              options={divisions.map((division) => ({ value: division.id, label: division.name }))}
            />
            <FormSelect
              aria-label="Branch"
              value={branchId}
              onChange={(event) => {
                setBranchId(event.target.value);
                setPage(1);
              }}
              placeholder="All branches"
              options={branches
                .filter((branch) => !divisionId || branch.divisionId === divisionId)
                .map((branch) => ({ value: branch.id, label: branch.name }))}
            />
            <FormSelect
              aria-label="Supplier"
              value={supplierId}
              onChange={(event) => {
                setSupplierId(event.target.value);
                setPage(1);
              }}
              placeholder="All saved suppliers"
              options={suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))}
            />
            <FormSelect
              aria-label="Status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              placeholder="All statuses"
              options={statuses.map((value) => ({ value, label: value.replaceAll('_', ' ') }))}
            />
            <input
              aria-label="From date"
              className="aurora-input rounded-lg border px-3 py-2 text-[13px]"
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setPage(1);
              }}
            />
            <input
              aria-label="To date"
              className="aurora-input rounded-lg border px-3 py-2 text-[13px]"
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                setPage(1);
              }}
            />
          </>
        }
        actions={
          canCreate ? (
            <Btn icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New Supplier Draft
            </Btn>
          ) : null
        }
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      <Card padding="none" className="overflow-hidden">
        {loading ? (
          <div className="p-5">
            <SkeletonTable rows={6} cols={7} />
          </div>
        ) : !data?.data.length ? (
          <EmptyState
            title="No supplier order drafts"
            description="Create an independent supplier-facing request without posting an actual purchase."
            action={
              canCreate ? <Btn onClick={() => setCreating(true)}>Create Draft</Btn> : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead
                style={{ background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-muted)' }}
              >
                <tr>
                  <th className="px-4 py-3">Draft</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Scope</th>
                  <th className="px-4 py-3 text-right">Pricing</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((draft) => (
                  <tr
                    key={draft.id}
                    className="border-t"
                    style={{ borderColor: 'var(--aurora-border)' }}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/operations/purchase-orders/order-drafts/${draft.id}`}
                        className="font-semibold text-brand-600 hover:underline"
                      >
                        {draft.draftNumber}
                      </Link>
                      <div
                        className="mt-0.5 text-[11px]"
                        style={{ color: 'var(--aurora-text-muted)' }}
                      >
                        {draft.title || `${draft.lines.length} item lines`}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{dateOnly(draft.draftDate)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{draft.supplierName}</div>
                      <div className="text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
                        {draft.supplierId ? 'Saved supplier snapshot' : 'One-off supplier'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{draft.company?.name}</div>
                      <div className="text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
                        {draft.division?.name || 'All divisions'} ·{' '}
                        {draft.branch?.name || 'All branches'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="font-semibold">
                        {money(draft.totalAmount, draft.currency)}
                      </div>
                      {draft.hasUnpricedLines && (
                        <div className="text-[11px] text-amber-600">
                          Partial total · prices pending
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={draft.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Link
                          href={`/operations/purchase-orders/order-drafts/${draft.id}`}
                          className="rounded-md border px-2.5 py-1 text-[11px] font-medium"
                          style={{ borderColor: 'var(--aurora-border)' }}
                        >
                          View
                        </Link>
                        {draft.status === 'DRAFT' && canUpdate && (
                          <button
                            className="rounded-md border px-2.5 py-1 text-[11px]"
                            style={{ borderColor: 'var(--aurora-border)' }}
                            onClick={() => setEditing(draft)}
                          >
                            Edit
                          </button>
                        )}
                        {canCreate && (
                          <button
                            title="Duplicate"
                            className="rounded-md border p-1.5"
                            style={{ borderColor: 'var(--aurora-border)' }}
                            onClick={() => duplicate(draft)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {draft.status === 'DRAFT' && canSend && (
                          <button
                            title="Mark sent"
                            className="rounded-md bg-brand-600 p-1.5 text-white"
                            onClick={() => setPending({ draft, action: 'send' })}
                          >
                            <Send className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {draft.status === 'DRAFT' && canManage && (
                          <button
                            title="Delete draft"
                            className="rounded-md bg-red-600 p-1.5 text-white"
                            onClick={() => setPending({ draft, action: 'delete' })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Btn
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </Btn>
          <span className="text-xs">
            Page {page} of {data.totalPages}
          </span>
          <Btn
            size="sm"
            variant="secondary"
            disabled={page >= data.totalPages}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </Btn>
        </div>
      )}
    </div>
  );
}
