'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Btn,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonTable,
  StatCard,
  StatusBadge,
  showToast,
} from '@/components/ui';
import { backendGet, backendPatch } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { RecordSalesOrderPaymentModal } from '../../_components/record-sales-order-payment-modal';
import {
  ApprovalTimeline,
  AuditTimeline,
  type ApprovalStep,
  type AuditEntry,
} from '@/components/aurora/timelines';

type AnyRecord = Record<string, any>;

interface SalesOrderControlCenter {
  order: AnyRecord;
  customerCredit?: AnyRecord | null;
  ledger?: AnyRecord | null;
  fulfillment?: AnyRecord | null;
  profit?: AnyRecord | null;
  audit?: AnyRecord | null;
}

const tabs = [
  'Overview',
  'Lines & Stock',
  'Payments / Receivable',
  'Fulfillment / Delivery Notes',
  'Profit & Margin',
  'Journal / Accounting',
  'Commission',
  'Audit',
];

function tabId(tab: string) {
  return tab
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function money(value: unknown, currency = 'TZS') {
  const number = Number(value ?? 0);
  return `${currency} ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(number) ? number : 0)}`;
}

function qty(value: unknown) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(
    Number.isFinite(number) ? number : 0,
  );
}

function date(value?: string | null) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString('en-GB');
}

function dateTime(value?: string | null) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function personName(value?: AnyRecord | null) {
  if (!value) return '-';
  return (
    value.fullName ||
    [value.firstName, value.lastName].filter(Boolean).join(' ').trim() ||
    value.employeeCode ||
    value.email ||
    '-'
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
        {label}
      </p>
      <div className="mt-1 font-medium" style={{ color: 'var(--aurora-text)' }}>
        {value || '-'}
      </div>
    </div>
  );
}

function buildStatusSteps(
  order: AnyRecord,
  audit: AnyRecord | null | undefined,
  fulfillment: AnyRecord | null | undefined,
): ApprovalStep[] {
  const status = String(order?.status ?? '').toUpperCase();
  const paymentStatus = String(order?.paymentStatus ?? '').toUpperCase();
  const isCancelled = status === 'CANCELLED';
  const isConfirmed = ['CONFIRMED', 'PARTIALLY_PAID', 'PAID', 'DELIVERED', 'COMPLETED'].includes(
    status,
  );

  const fulfillmentStatus = String(fulfillment?.summary?.status ?? '').toUpperCase();
  const deliveryCount = Number(fulfillment?.summary?.deliveryNoteCount ?? 0);
  const isDelivered =
    ['DELIVERED', 'FULFILLED', 'COMPLETED'].includes(fulfillmentStatus) ||
    ['DELIVERED', 'COMPLETED'].includes(status) ||
    deliveryCount > 0;

  const outstanding = Number(order?.outstandingAmount ?? 0);
  const isPaid =
    paymentStatus === 'PAID' ||
    (isConfirmed && Number.isFinite(outstanding) && outstanding <= 0);

  const drafted: ApprovalStep = {
    id: 'draft',
    stepNumber: 1,
    title: 'Draft',
    status: 'APPROVED',
    approver: personName(audit?.createdBy),
    actionedAt: dateTime(audit?.createdAt) || undefined,
  };

  const confirmed: ApprovalStep = {
    id: 'confirmed',
    stepNumber: 2,
    title: 'Confirmed',
    status: isCancelled ? 'REJECTED' : isConfirmed ? 'APPROVED' : 'PENDING',
    approver: isConfirmed ? personName(audit?.confirmedBy) : undefined,
    actionedAt: isConfirmed ? dateTime(audit?.confirmedAt) || undefined : undefined,
    comment: isCancelled ? 'Order cancelled' : undefined,
  };

  const delivered: ApprovalStep = {
    id: 'delivered',
    stepNumber: 3,
    title: 'Delivered',
    status: isCancelled ? 'SKIPPED' : isDelivered ? 'APPROVED' : 'PENDING',
    description:
      isDelivered && deliveryCount > 0
        ? `${deliveryCount} delivery note${deliveryCount === 1 ? '' : 's'}`
        : undefined,
  };

  const paid: ApprovalStep = {
    id: 'paid',
    stepNumber: 4,
    title: 'Paid',
    status: isCancelled ? 'SKIPPED' : isPaid ? 'APPROVED' : 'PENDING',
    description:
      !isCancelled && !isPaid && Number.isFinite(outstanding) && outstanding > 0
        ? `Outstanding ${money(outstanding, order?.currency ?? 'TZS')}`
        : undefined,
  };

  return [drafted, confirmed, delivered, paid];
}

function buildAuditEntries(
  order: AnyRecord,
  audit: AnyRecord | null | undefined,
): AuditEntry[] {
  const entries: AuditEntry[] = [];
  const entityType = 'Sales Order';

  if (audit?.createdAt) {
    entries.push({
      id: 'audit-created',
      action: 'Order created',
      entityType,
      userEmail: personName(audit.createdBy) !== '-' ? personName(audit.createdBy) : undefined,
      createdAt: dateTime(audit.createdAt),
    });
  }

  if (audit?.confirmedAt) {
    entries.push({
      id: 'audit-confirmed',
      action: 'Order confirmed',
      entityType,
      userEmail:
        personName(audit.confirmedBy) !== '-' ? personName(audit.confirmedBy) : undefined,
      createdAt: dateTime(audit.confirmedAt),
    });
  }

  if (
    audit?.updatedAt &&
    audit.updatedAt !== audit.createdAt &&
    audit.updatedAt !== audit.confirmedAt
  ) {
    entries.push({
      id: 'audit-updated',
      action: 'Order updated',
      entityType,
      createdAt: dateTime(audit.updatedAt),
    });
  }

  if (String(order?.status ?? '').toUpperCase() === 'CANCELLED') {
    entries.push({
      id: 'audit-cancelled',
      action: 'Order cancelled',
      entityType,
      createdAt: dateTime(audit?.updatedAt),
    });
  }

  // Newest first for the audit trail.
  return entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export default function SalesOrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params.id ?? '');
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState(tabs[0]);
  const [data, setData] = useState<SalesOrderControlCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [recordingPayment, setRecordingPayment] = useState(false);

  const canConfirm = hasPermission('sales.confirm');
  const canCancel = hasPermission('sales.cancel');
  const canRecordPayment = hasPermission('receivables.manage');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      setData(await backendGet<SalesOrderControlCenter>(`/sales-orders/${id}/control-center`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sales order');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const order = data?.order;
  const currency = order?.currency ?? 'TZS';
  const receivableId = order?.receivableId ?? data?.ledger?.receivable?.id;
  const outstanding = Number(
    order?.outstandingAmount ?? data?.ledger?.receivable?.outstandingAmount ?? 0,
  );
  const lines = useMemo(() => order?.lines ?? [], [order?.lines]);
  const statusSteps = useMemo(
    () => (order ? buildStatusSteps(order, data?.audit, data?.fulfillment) : []),
    [order, data?.audit, data?.fulfillment],
  );
  const auditEntries = useMemo(
    () => (order ? buildAuditEntries(order, data?.audit) : []),
    [order, data?.audit],
  );

  const runAction = async (action: 'confirm' | 'cancel') => {
    setActionLoading(action);
    setError('');
    try {
      await backendPatch(`/sales-orders/${id}/${action}`);
      showToast(
        action === 'confirm' ? 'success' : 'info',
        action === 'confirm' ? 'Order confirmed' : 'Order cancelled',
      );
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : `Could not ${action} order`;
      setError(message);
      showToast('error', message);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="Sales Order" subtitle="Loading control center" />
        <SkeletonTable rows={5} cols={4} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="Sales Order" subtitle="Control center" />
        <Card className="p-6">
          <ErrorState message={error} onRetry={load} />
          <div className="mt-4 flex justify-center">
            <Btn variant="secondary" onClick={() => router.push('/operations/sales-orders')}>
              Back
            </Btn>
          </div>
        </Card>
      </div>
    );
  }

  if (!order) return null;

  return (
    <div className="p-6 space-y-6">
      {recordingPayment && receivableId && (
        <RecordSalesOrderPaymentModal
          receivableId={receivableId}
          companyId={order.companyId}
          divisionId={order.divisionId}
          branchId={order.branchId}
          currency={currency}
          outstanding={outstanding}
          orderLabel={order.salesOrderNumber ?? order.orderNumber ?? order.id}
          onClose={() => setRecordingPayment(false)}
          onSaved={() => {
            setRecordingPayment(false);
            load();
          }}
        />
      )}

      <PageHeader
        title={order.salesOrderNumber ?? 'Sales Order'}
        subtitle={`${order.salesType?.replace(/_/g, ' ') ?? 'Sale'} - ${date(order.orderDate)} - ${
          order.customer?.name ?? order.customerName ?? 'Walk-in'
        }`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Btn variant="secondary" onClick={() => router.push('/operations/sales-orders')}>
              Back
            </Btn>
            {order.customer?.id && (
              <Btn
                variant="secondary"
                onClick={() => router.push(`/operations/customers/${order.customer.id}`)}
              >
                View Customer
              </Btn>
            )}
            <Btn
              variant="secondary"
              onClick={() => router.push(`/operations/sales-orders/${order.id}/print`)}
            >
              Print / PDF
            </Btn>
            {order.status === 'DRAFT' && hasPermission('sales.create') && (
              <Btn
                variant="secondary"
                onClick={() => router.push(`/operations/sales-orders?editId=${order.id}`)}
              >
                Edit Draft
              </Btn>
            )}
            {order.status === 'DRAFT' && canConfirm && (
              <Btn
                variant="primary"
                loading={actionLoading === 'confirm'}
                onClick={() => runAction('confirm')}
              >
                Confirm
              </Btn>
            )}
            {['CONFIRMED', 'PARTIALLY_PAID', 'PAID'].includes(order.status) && canCancel && (
              <Btn
                variant="danger"
                loading={actionLoading === 'cancel'}
                onClick={() => runAction('cancel')}
              >
                Cancel
              </Btn>
            )}
            {receivableId && outstanding > 0 && canRecordPayment && (
              <Btn variant="primary" onClick={() => setRecordingPayment(true)}>
                Record Payment
              </Btn>
            )}
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total" value={money(order.totalAmount, currency)} />
        <StatCard label="Paid" value={money(order.paidAmount, currency)} />
        <StatCard label="Outstanding" value={money(order.outstandingAmount, currency)} />
        <StatCard
          label="Gross Profit"
          value={money(data.profit?.summary?.grossProfitAmount, currency)}
        />
      </div>

      <Card className="p-2">
        <div
          role="tablist"
          aria-label="Sales order control center sections"
          className="flex flex-wrap gap-2"
        >
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`tab-${tabId(tab)}`}
              aria-selected={activeTab === tab}
              aria-controls={`tabpanel-${tabId(tab)}`}
              onClick={() => setActiveTab(tab)}
              className={`rounded-md px-3 py-2 text-sm font-medium ${
                activeTab === tab ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </Card>

      {activeTab === 'Overview' && (
        <div
          role="tabpanel"
          id={`tabpanel-${tabId('Overview')}`}
          aria-labelledby={`tab-${tabId('Overview')}`}
          className="space-y-6"
        >
          <Card className="p-5">
            <h3 className="mb-4 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Order Lifecycle
            </h3>
            <ApprovalTimeline steps={statusSteps} />
          </Card>
          <Card className="p-5">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-4">
              <InfoRow label="Status" value={<StatusBadge value={order.status} />} />
              <InfoRow label="Payment" value={<StatusBadge value={order.paymentStatus} />} />
              <InfoRow label="Company" value={order.company?.name} />
              <InfoRow
                label="Division / Branch"
                value={[order.division?.name, order.branch?.name].filter(Boolean).join(' / ')}
              />
              <InfoRow label="Customer" value={order.customer?.name ?? order.customerName} />
              <InfoRow label="Salesperson" value={personName(order.salesperson)} />
              <InfoRow label="Payment Method" value={order.paymentMethod?.replace(/_/g, ' ')} />
              <InfoRow label="Receipt Account" value={order.cashAccount?.accountName} />
              <InfoRow label="Reference" value={order.paymentReference} />
              <InfoRow label="Order Date" value={date(order.orderDate)} />
              <InfoRow label="Due Date" value={date(order.dueDate)} />
              <InfoRow
                label="Credit Available"
                value={money(data.customerCredit?.availableCredit, currency)}
              />
            </div>
            {order.notes && (
              <div
                className="mt-5 rounded-lg border p-3"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <p className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                  Notes
                </p>
                <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text)' }}>
                  {order.notes}
                </p>
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'Lines & Stock' && (
        <div
          role="tabpanel"
          id={`tabpanel-${tabId('Lines & Stock')}`}
          aria-labelledby={`tab-${tabId('Lines & Stock')}`}
        >
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <caption className="sr-only">Order lines and stock availability</caption>
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3">
                      Product
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Description
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Qty
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Unit
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Available Stock
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Unit Price
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Line Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((line: AnyRecord) => {
                    const stock = line.stockSnapshot;
                    const available =
                      stock == null
                        ? null
                        : Number(stock.quantityOnHand ?? 0) - Number(stock.quantityReserved ?? 0);
                    return (
                      <tr key={line.id}>
                        <td className="px-4 py-3 font-semibold">
                          {line.product?.productCode ? `${line.product.productCode} - ` : ''}
                          {line.product?.name}
                        </td>
                        <td className="px-4 py-3">{line.description ?? '-'}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{qty(line.quantity)}</td>
                        <td className="px-4 py-3">{line.unit?.symbol ?? line.unit?.name}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {available == null ? '-' : qty(available)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {money(line.unitPrice, currency)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {money(line.lineTotal, currency)}
                        </td>
                      </tr>
                    );
                  })}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8">
                        <EmptyState
                          title="No order lines"
                          description="This order has no line items."
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'Payments / Receivable' && (
        <div
          role="tabpanel"
          id={`tabpanel-${tabId('Payments / Receivable')}`}
          aria-labelledby={`tab-${tabId('Payments / Receivable')}`}
        >
          <Card className="p-5">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-4">
              <InfoRow label="Payment Method" value={order.paymentMethod?.replace(/_/g, ' ')} />
              <InfoRow label="Payment Status" value={<StatusBadge value={order.paymentStatus} />} />
              <InfoRow label="Receivable" value={data.ledger?.receivable?.receivableNumber} />
              <InfoRow label="Receivable Status" value={data.ledger?.receivable?.status} />
              <InfoRow label="Paid" value={money(order.paidAmount, currency)} />
              <InfoRow label="Outstanding" value={money(order.outstandingAmount, currency)} />
              <InfoRow label="Cash / Bank Account" value={order.cashAccount?.accountName} />
              <InfoRow label="Payment Reference" value={order.paymentReference} />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Btn variant="secondary" onClick={() => router.push('/finance/receivables')}>
                View Receivables
              </Btn>
              {receivableId && outstanding > 0 && canRecordPayment && (
                <Btn variant="primary" onClick={() => setRecordingPayment(true)}>
                  Record Payment
                </Btn>
              )}
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'Fulfillment / Delivery Notes' && (
        <div
          role="tabpanel"
          id={`tabpanel-${tabId('Fulfillment / Delivery Notes')}`}
          aria-labelledby={`tab-${tabId('Fulfillment / Delivery Notes')}`}
        >
          <Card className="p-5 space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard label="Fulfillment" value={data.fulfillment?.summary?.status ?? 'Open'} />
              <StatCard
                label="Delivery Notes"
                value={data.fulfillment?.summary?.deliveryNoteCount ?? 0}
              />
              <StatCard
                label="Inventory Movements"
                value={data.fulfillment?.summary?.inventoryMovementCount ?? 0}
              />
            </div>
            <div>
              <h3 className="mb-3 font-semibold">Delivery Notes</h3>
              <div className="space-y-2">
                {(data.fulfillment?.deliveryNotes ?? []).map((note: AnyRecord) => (
                  <div
                    key={note.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                    style={{ borderColor: 'var(--aurora-border)' }}
                  >
                    <div>
                      <p className="font-semibold">{note.deliveryNoteNumber}</p>
                      <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {date(note.deliveryDate)} - {note.lines?.length ?? 0} lines
                      </p>
                    </div>
                    <StatusBadge value={note.status} />
                  </div>
                ))}
                {(data.fulfillment?.deliveryNotes ?? []).length === 0 && (
                  <EmptyState
                    title="No delivery notes"
                    description="No delivery notes linked yet."
                  />
                )}
              </div>
            </div>
            <div>
              <h3 className="mb-3 font-semibold">Inventory Issue Movements</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-sm">
                  <caption className="sr-only">Inventory issue movements for this order</caption>
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th scope="col" className="px-4 py-3">
                        Movement
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Product
                      </th>
                      <th scope="col" className="px-4 py-3 text-right">
                        Qty
                      </th>
                      <th scope="col" className="px-4 py-3 text-right">
                        Cost
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(data.fulfillment?.inventoryMovements ?? []).map((movement: AnyRecord) => (
                      <tr key={movement.id}>
                        <td className="px-4 py-3 font-mono text-xs">{movement.movementNumber}</td>
                        <td className="px-4 py-3">{movement.product?.name}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {qty(movement.quantity)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {money(movement.totalCost, currency)}
                        </td>
                        <td className="px-4 py-3">{date(movement.movementDate)}</td>
                      </tr>
                    ))}
                    {(data.fulfillment?.inventoryMovements ?? []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8">
                          <EmptyState
                            title="No inventory movements"
                            description="No stock issue movements recorded for this order."
                          />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'Profit & Margin' && (
        <div
          role="tabpanel"
          id={`tabpanel-${tabId('Profit & Margin')}`}
          aria-labelledby={`tab-${tabId('Profit & Margin')}`}
        >
          <Card className="overflow-hidden">
            <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
              <StatCard
                label="Revenue Ex Tax"
                value={money(data.profit?.summary?.revenueExTax, currency)}
              />
              <StatCard label="COGS" value={money(data.profit?.summary?.cogsAmount, currency)} />
              <StatCard
                label="Gross Profit"
                value={money(data.profit?.summary?.grossProfitAmount, currency)}
              />
              <StatCard
                label="Margin"
                value={`${Number(data.profit?.summary?.grossMarginPct ?? 0).toFixed(2)}%`}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <caption className="sr-only">Per-line profit and margin</caption>
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3">
                      Product
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Unit Cost
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      COGS
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Profit
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Margin
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Cost Source
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(data.profit?.lines ?? []).map((line: AnyRecord) => (
                    <tr key={line.id}>
                      <td className="px-4 py-3 font-semibold">{line.product?.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {money(line.unitCostAtSale, currency)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {money(line.cogsAmount, currency)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {money(line.grossProfitAmount ?? line.computedGrossProfit, currency)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {Number(line.grossMarginPct ?? 0).toFixed(2)}%
                      </td>
                      <td className="px-4 py-3">{line.profitCostSource ?? '-'}</td>
                    </tr>
                  ))}
                  {(data.profit?.lines ?? []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8">
                        <EmptyState
                          title="No profit lines"
                          description="No profit and margin detail available for this order."
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'Journal / Accounting' && (
        <div
          role="tabpanel"
          id={`tabpanel-${tabId('Journal / Accounting')}`}
          aria-labelledby={`tab-${tabId('Journal / Accounting')}`}
        >
          <Card className="overflow-hidden">
            <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-4">
              <InfoRow label="Journal" value={data.ledger?.journalEntry?.journalNumber} />
              <InfoRow label="Status" value={data.ledger?.journalEntry?.status} />
              <InfoRow
                label="Transaction Date"
                value={date(data.ledger?.journalEntry?.transactionDate)}
              />
              <InfoRow label="Description" value={data.ledger?.journalEntry?.description} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <caption className="sr-only">Journal entry lines</caption>
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3">
                      Account
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Description
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Debit
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Credit
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(data.ledger?.journalEntry?.lines ?? []).map((line: AnyRecord) => (
                    <tr key={line.id}>
                      <td className="px-4 py-3">
                        {line.account?.accountCode} - {line.account?.accountName}
                      </td>
                      <td className="px-4 py-3">{line.description ?? '-'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {money(line.debit, currency)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {money(line.credit, currency)}
                      </td>
                    </tr>
                  ))}
                  {(data.ledger?.journalEntry?.lines ?? []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8">
                        <EmptyState
                          title="No journal entry"
                          description="No posted journal entry linked yet."
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'Commission' && (
        <div
          role="tabpanel"
          id={`tabpanel-${tabId('Commission')}`}
          aria-labelledby={`tab-${tabId('Commission')}`}
        >
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <caption className="sr-only">Commission rows for this order</caption>
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3">
                      Employee
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Basis
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Rate
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Amount
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(order.commissions ?? []).map((commission: AnyRecord) => (
                    <tr key={commission.id}>
                      <td className="px-4 py-3">{personName(commission.employee)}</td>
                      <td className="px-4 py-3">{commission.basis}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {(Number(commission.rate ?? 0) * 100).toFixed(2)}%
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {money(commission.amount, currency)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge value={commission.status} />
                      </td>
                    </tr>
                  ))}
                  {(order.commissions ?? []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8">
                        <EmptyState
                          title="No commissions"
                          description="No commission rows linked to this order."
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'Audit' && (
        <div
          role="tabpanel"
          id={`tabpanel-${tabId('Audit')}`}
          aria-labelledby={`tab-${tabId('Audit')}`}
          className="space-y-6"
        >
          <Card className="p-5">
            <h3 className="mb-4 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Audit Trail
            </h3>
            <AuditTimeline entries={auditEntries} emptyText="No audit records for this order" />
          </Card>
          <Card className="p-5">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-4">
              <InfoRow label="Created At" value={date(data.audit?.createdAt)} />
              <InfoRow label="Created By" value={personName(data.audit?.createdBy)} />
              <InfoRow label="Updated At" value={date(data.audit?.updatedAt)} />
              <InfoRow label="Confirmed At" value={date(data.audit?.confirmedAt)} />
              <InfoRow label="Confirmed By" value={personName(data.audit?.confirmedBy)} />
              <InfoRow
                label="Order ID"
                value={<span className="font-mono text-xs">{order.id}</span>}
              />
              <InfoRow
                label="Receivable ID"
                value={<span className="font-mono text-xs">{receivableId ?? '-'}</span>}
              />
              <InfoRow
                label="Journal ID"
                value={
                  <span className="font-mono text-xs">{data.ledger?.journalEntry?.id ?? '-'}</span>
                }
              />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
