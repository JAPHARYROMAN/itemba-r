'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card,
  PageHeader,
  PageToolbar,
  StatusBadge,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  Btn,
  PageSpinner,
  showToast,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useOrgScope } from '@/hooks/use-org-scope';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface SalesOrderRef {
  id: string;
  salesOrderNumber: string;
  orderDate?: string;
  subtotal?: number | string;
  totalAmount?: number | string;
  status?: string;
  paymentStatus?: string;
}

interface EmployeeRef {
  id: string;
  fullName?: string;
  employeeCode?: string;
}

interface SalesCommission {
  id: string;
  companyId: string;
  employeeId: string;
  salesOrderId: string;
  basis: 'GROSS' | 'NET' | 'FLAT';
  rate: number | string;
  amount: number | string;
  currency: string;
  status: 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED';
  notes?: string | null;
  approvedAt?: string | null;
  paidPayrollEntryId?: string | null;
  createdAt: string;
  employee?: EmployeeRef;
  salesOrder?: SalesOrderRef;
}

interface FormState {
  companyId: string;
  employeeId: string;
  salesOrderId: string;
  basis: 'GROSS' | 'NET' | 'FLAT';
  rate: string;
  amount: string;
  notes: string;
}

const empty: FormState = {
  companyId: '',
  employeeId: '',
  salesOrderId: '',
  basis: 'GROSS',
  rate: '0.05',
  amount: '',
  notes: '',
};

function fmt(n: number | string | undefined | null) {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat('en-TZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

export default function SalesCommissionsPage() {
  const [rows, setRows] = useState<SalesCommission[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SalesCommission | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [empFilter, setEmpFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');

  const { companyOptions, employeeOptions } = useOrgScope(form.companyId, {
    skipBranches: true,
    skipDivisions: true,
  });
  const { hasPermission } = useAuth();
  const canManage = hasPermission('sales_orders.create');
  const canApprove = hasPermission('sales_orders.confirm');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (empFilter) params.set('employeeId', empFilter);
    if (statusFilter) params.set('status', statusFilter);
    const r = await fetch(`/api/backend/sales-commissions?${params}`);
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  }, [empFilter, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    const totals = { draft: 0, approved: 0, paid: 0, cancelled: 0 };
    let approvedAmount = 0;
    let paidAmount = 0;
    for (const r of rows) {
      const a = Number(r.amount);
      if (r.status === 'DRAFT') totals.draft++;
      else if (r.status === 'APPROVED') {
        totals.approved++;
        approvedAmount += a;
      } else if (r.status === 'PAID') {
        totals.paid++;
        paidAmount += a;
      } else if (r.status === 'CANCELLED') totals.cancelled++;
    }
    return { ...totals, approvedAmount, paidAmount };
  }, [rows]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        basis: form.basis,
        rate: form.basis === 'FLAT' ? 0 : Number(form.rate),
        notes: editing ? form.notes : form.notes || undefined,
      };
      if (form.amount) body.amount = Number(form.amount);
      if (!editing) {
        body.companyId = form.companyId;
        body.employeeId = form.employeeId;
        body.salesOrderId = form.salesOrderId;
      }
      const res = await fetch(
        editing
          ? `/api/backend/sales-commissions/${editing.id}`
          : '/api/backend/sales-commissions',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? 'Save failed'),
        );
      }
      setShowModal(false);
      setEditing(null);
      setForm(empty);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const doAction = async (id: string, action: 'approve' | 'cancel' | 'delete') => {
    setActionLoading(`${id}-${action}`);
    let res: Response;
    if (action === 'delete') {
      res = await fetch(`/api/backend/sales-commissions/${id}`, { method: 'DELETE' });
    } else if (action === 'cancel') {
      res = await fetch(`/api/backend/sales-commissions/${id}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } else {
      res = await fetch(`/api/backend/sales-commissions/${id}/${action}`, { method: 'PATCH' });
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(
        'error',
        `Failed to ${action} commission`,
        Array.isArray(j?.message) ? j.message.join(', ') : j?.message,
      );
    }
    setActionLoading('');
    load();
  };

  const openEdit = (r: SalesCommission) => {
    setEditing(r);
    setForm({
      companyId: r.companyId,
      employeeId: r.employeeId,
      salesOrderId: r.salesOrderId,
      basis: r.basis,
      rate: String(r.rate),
      amount: r.basis === 'FLAT' ? String(r.amount) : '',
      notes: r.notes ?? '',
    });
    setError('');
    setShowModal(true);
  };

  const f =
    (k: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

  const ACTIONS: Record<
    string,
    {
      action: 'approve' | 'cancel' | 'delete';
      label: string;
      variant: 'primary' | 'success' | 'danger' | 'warning';
    }[]
  > = {
    DRAFT: [
      { action: 'approve', label: 'Approve', variant: 'success' },
      { action: 'cancel', label: 'Cancel', variant: 'warning' },
      { action: 'delete', label: 'Delete', variant: 'danger' },
    ],
    APPROVED: [{ action: 'cancel', label: 'Cancel', variant: 'warning' }],
    PAID: [],
    CANCELLED: [],
  };

  return (
    <div className="p-6">
      <PageHeader
        title="Sales Commissions"
        subtitle="Sales-rep commission earnings — flow into payroll as a taxable allowance once approved."
        breadcrumbs={[{ label: 'Sales', href: '/sales' }, { label: 'Commissions' }]}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Tile label="Draft" value={String(summary.draft)} />
        <Tile
          label="Approved"
          value={String(summary.approved)}
          hint={`TZS ${fmt(summary.approvedAmount)}`}
        />
        <Tile label="Paid" value={String(summary.paid)} hint={`TZS ${fmt(summary.paidAmount)}`} />
        <Tile label="Cancelled" value={String(summary.cancelled)} muted />
      </div>

      <PageToolbar
        filters={
          <>
            <input
              type="text"
              placeholder="Filter by employee ID…"
              value={empFilter}
              onChange={(e) => setEmpFilter(e.target.value)}
              className="text-sm border rounded-lg px-3 py-1.5 w-44 focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{
                borderColor: 'var(--aurora-border)',
                background: 'var(--aurora-card)',
                color: 'var(--aurora-text)',
              }}
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{
                borderColor: 'var(--aurora-border)',
                background: 'var(--aurora-card)',
                color: 'var(--aurora-text)',
              }}
            >
              <option value="">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="APPROVED">Approved</option>
              <option value="PAID">Paid</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </>
        }
        actions={
          canManage && (
            <Btn
              variant="primary"
              onClick={() => {
                setEditing(null);
                setForm(empty);
                setError('');
                setShowModal(true);
              }}
            >
              + New Commission
            </Btn>
          )
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead
                className="bg-slate-50 border-b border-slate-100"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <tr>
                  <th className={thCls}>Order</th>
                  <th className={thCls}>Salesperson</th>
                  <th className={thCls}>Basis</th>
                  <th className={thCls + ' text-right'}>Rate</th>
                  <th className={thCls + ' text-right'}>Amount</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Created</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map((r) => {
                  const empLabel = r.employee?.fullName ?? r.employee?.employeeCode ?? r.employeeId;
                  const ratePct = (Number(r.rate) * 100).toFixed(2);
                  return (
                    <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className={`${tdCls} font-mono text-xs`}>
                        {r.salesOrder?.salesOrderNumber ?? r.salesOrderId.slice(0, 8)}
                      </td>
                      <td className={tdCls}>
                        <div>{empLabel}</div>
                        {r.employee?.employeeCode && (
                          <div className="text-[11px] font-mono text-slate-400">
                            {r.employee.employeeCode}
                          </div>
                        )}
                      </td>
                      <td className={tdCls}>{r.basis}</td>
                      <td className={`${tdCls} text-right tabular-nums`}>
                        {r.basis === 'FLAT' ? '—' : `${ratePct}%`}
                      </td>
                      <td className={`${tdCls} text-right tabular-nums font-medium`}>
                        {r.currency} {fmt(r.amount)}
                      </td>
                      <td className={tdCls}>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className={tdCls}>{new Date(r.createdAt).toLocaleDateString('en-GB')}</td>
                      <td className={tdCls}>
                        <div className="flex flex-wrap gap-1">
                          {r.status === 'DRAFT' && canManage && (
                            <Btn variant="secondary" size="xs" onClick={() => openEdit(r)}>
                              Edit
                            </Btn>
                          )}
                          {(ACTIONS[r.status] ?? [])
                            .filter((a) => (a.action === 'approve' ? canApprove : canManage))
                            .map((a) => (
                              <Btn
                                key={a.action}
                                variant={a.variant}
                                size="xs"
                                onClick={() => doAction(r.id, a.action)}
                                disabled={actionLoading === `${r.id}-${a.action}`}
                              >
                                {actionLoading === `${r.id}-${a.action}` ? '…' : a.label}
                              </Btn>
                            ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="text-center py-8 text-sm"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      No commissions found. They auto-create when a sales order with a salesperson
                      is confirmed.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => {
          setShowModal(false);
          setEditing(null);
        }}
        title={editing ? 'Edit commission' : 'Create commission'}
        footer={
          <>
            <Btn
              variant="secondary"
              onClick={() => {
                setShowModal(false);
                setEditing(null);
              }}
            >
              Cancel
            </Btn>
            <Btn variant="primary" type="submit" form="sales-commission-form" loading={saving}>
              Save
            </Btn>
          </>
        }
      >
        <form id="sales-commission-form" onSubmit={handleSubmit} className="space-y-3">
          {editing ? (
            <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              {editing.employee?.fullName ?? editing.employeeId} — order{' '}
              <span className="font-mono text-xs">
                {editing.salesOrder?.salesOrderNumber ?? editing.salesOrderId.slice(0, 8)}
              </span>
            </div>
          ) : (
            <>
              <FormSelect
                label="Company"
                required
                value={form.companyId}
                onChange={(e) =>
                  setForm((p) => ({ ...p, companyId: e.target.value, employeeId: '' }))
                }
                options={companyOptions}
                placeholder="Select company"
              />
              <FormSelect
                label="Salesperson"
                required
                value={form.employeeId}
                onChange={f('employeeId')}
                options={employeeOptions}
                placeholder={form.companyId ? 'Select employee' : 'Select company first'}
              />
              <FormInput
                label="Sales Order ID"
                value={form.salesOrderId}
                onChange={f('salesOrderId')}
                required
              />
            </>
          )}
          <FormSelect
            label="Basis"
            value={form.basis}
            onChange={f('basis')}
            options={[
              { value: 'GROSS', label: 'Gross (% of subtotal)' },
              { value: 'NET', label: 'Net (% of subtotal − discount)' },
              { value: 'FLAT', label: 'Flat amount' },
            ]}
          />
          {form.basis !== 'FLAT' && (
            <FormInput
              label="Rate (decimal, e.g. 0.05 for 5%)"
              value={form.rate}
              onChange={f('rate')}
              type="number"
            />
          )}
          <FormInput
            label={
              form.basis === 'FLAT'
                ? 'Amount (required)'
                : 'Amount override (optional — auto-computed if blank)'
            }
            value={form.amount}
            onChange={f('amount')}
            type="number"
            required={form.basis === 'FLAT'}
          />
          <FormTextarea label="Notes" value={form.notes} onChange={f('notes')} rows={2} />
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </form>
      </Modal>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  muted,
}: {
  label: string;
  value: string;
  hint?: string;
  muted?: boolean;
}) {
  return (
    <Card className={`p-3 ${muted ? 'opacity-70' : ''}`}>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
      {hint && <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>}
    </Card>
  );
}
