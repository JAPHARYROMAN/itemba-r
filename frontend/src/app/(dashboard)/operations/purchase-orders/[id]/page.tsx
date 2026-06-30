'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Btn, Card, PageHeader, SkeletonTable, StatCard, StatusBadge } from '@/components/ui';
import { backendGet, backendPage } from '@/lib/api-client';
import { downloadTextFile, rowsToCsv } from '@/lib/report-export';
import { useAuth } from '@/hooks/use-auth';

type AnyRecord = Record<string, any>;

const tabs = [
  'Overview',
  'Line Items',
  'Goods Receipts',
  'Supplier Invoice',
  'Three-Way Match',
  'Payable',
  'Inventory Movements',
];

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

export default function PurchaseOrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params.id ?? '');
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState(tabs[0]);
  const [order, setOrder] = useState<AnyRecord | null>(null);
  const [grns, setGrns] = useState<AnyRecord[]>([]);
  const [invoices, setInvoices] = useState<AnyRecord[]>([]);
  const [matches, setMatches] = useState<AnyRecord[]>([]);
  const [payable, setPayable] = useState<AnyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const canView = hasPermission('purchases.view');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    setGrns([]);
    setInvoices([]);
    setMatches([]);
    setPayable(null);
    try {
      const po = await backendGet<AnyRecord>(`/purchase-orders/${id}`);
      setOrder(po);

      const companyId = po?.companyId as string | undefined;
      if (companyId) {
        // The detail endpoint only returns the PO itself; related documents are
        // pulled from the existing list endpoints and scoped to this PO. Each
        // lookup degrades gracefully so a missing permission on one related area
        // does not blank out the whole control center.
        const [grnRes, invoiceRes, matchRes, payableRes] = await Promise.allSettled([
          backendPage<AnyRecord>('/goods-received-notes', {
            query: { companyId, limit: 200 },
          }),
          backendPage<AnyRecord>('/supplier-invoices', {
            query: { companyId, purchaseOrderId: id, limit: 100 },
          }),
          backendPage<AnyRecord>('/three-way-matching', {
            query: { companyId, limit: 200 },
          }),
          po?.payableId
            ? backendGet<AnyRecord>(`/payables/${po.payableId}`)
            : Promise.resolve(null),
        ]);

        if (grnRes.status === 'fulfilled') {
          setGrns(grnRes.value.data.filter((g) => g.purchaseOrderId === id));
        }
        if (invoiceRes.status === 'fulfilled') {
          setInvoices(invoiceRes.value.data);
        }
        if (matchRes.status === 'fulfilled') {
          setMatches(matchRes.value.data.filter((m) => m.purchaseOrderId === id));
        }
        if (payableRes.status === 'fulfilled') {
          setPayable(payableRes.value);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load purchase order');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const currency = order?.currency ?? 'TZS';
  const lines = useMemo(() => order?.lines ?? [], [order?.lines]);

  const movementsHref = useMemo(() => {
    if (!order?.companyId) return null;
    const params = new URLSearchParams({
      companyId: order.companyId,
      referenceType: 'PurchaseOrder',
      referenceId: id,
    });
    return `/operations/inventory-movements?${params.toString()}`;
  }, [order?.companyId, id]);

  // Export the rows behind the active data tab. Each tab maps to a flat row
  // shape so the shared CSV builder produces stable, human-readable columns.
  const exportCsv = useCallback(() => {
    const stamp = new Date().toISOString().slice(0, 10);
    const base = order?.purchaseOrderNumber ?? id;
    let rows: Record<string, unknown>[] = [];
    let suffix = '';

    if (activeTab === 'Line Items') {
      suffix = 'line-items';
      rows = (lines as AnyRecord[]).map((line) => ({
        product: `${line.product?.productCode ? `${line.product.productCode} - ` : ''}${
          line.product?.name ?? ''
        }`,
        description: line.description ?? '',
        quantity: qty(line.quantity),
        unit: line.unit?.symbol ?? line.unit?.name ?? '',
        unitCost: money(line.unitCost, currency),
        discount: money(line.discountAmount, currency),
        tax: money(line.taxAmount, currency),
        lineTotal: money(line.lineTotal, currency),
      }));
    } else if (activeTab === 'Goods Receipts') {
      suffix = 'goods-receipts';
      rows = grns.map((grn) => ({
        grnNumber: grn.grnNumber ?? '',
        receivedDate: date(grn.receivedDate),
        lines: grn.lines?.length ?? 0,
        status: grn.status ?? '',
        postedAt: date(grn.postedAt),
      }));
    } else if (activeTab === 'Supplier Invoice') {
      suffix = 'supplier-invoices';
      rows = invoices.map((inv) => ({
        invoiceNumber: inv.supplierInvoiceNumber ?? '',
        reference: inv.invoiceReference ?? '',
        invoiceDate: date(inv.invoiceDate),
        dueDate: date(inv.dueDate),
        total: money(inv.totalAmount, inv.currency ?? currency),
        paid: money(inv.paidAmount, inv.currency ?? currency),
        outstanding: money(inv.outstandingAmount, inv.currency ?? currency),
        status: inv.status ?? '',
      }));
    } else if (activeTab === 'Three-Way Match') {
      suffix = 'three-way-match';
      rows = matches.map((match) => ({
        matchNumber: match.matchNumber ?? '',
        matchDate: date(match.matchDate),
        quantityVariance: qty(match.quantityVariance),
        amountVariance: money(match.amountVariance, currency),
        status: match.matchStatus ?? '',
      }));
    }

    if (!rows.length) return;
    downloadTextFile(
      `${base}-${suffix}-${stamp}.csv`,
      'text/csv;charset=utf-8',
      rowsToCsv(rows),
    );
  }, [activeTab, order?.purchaseOrderNumber, id, lines, grns, invoices, matches, currency]);

  const canExportActiveTab =
    (activeTab === 'Line Items' && lines.length > 0) ||
    (activeTab === 'Goods Receipts' && grns.length > 0) ||
    (activeTab === 'Supplier Invoice' && invoices.length > 0) ||
    (activeTab === 'Three-Way Match' && matches.length > 0);

  if (!canView) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="Purchase Order" subtitle="Control center" />
        <Card className="p-6">
          <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
            Access Restricted
          </p>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="Purchase Order" subtitle="Loading control center" />
        <SkeletonTable rows={5} cols={4} />
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="Purchase Order" subtitle="Control center" />
        <Card className="p-6">
          <div className="text-sm text-red-600">{error}</div>
          <div className="mt-4 flex gap-2">
            <Btn variant="secondary" onClick={() => router.push('/operations/purchase-orders')}>
              Back
            </Btn>
            <Btn variant="primary" onClick={load}>
              Try again
            </Btn>
          </div>
        </Card>
      </div>
    );
  }

  if (!order) return null;

  const supplierName = order.supplier?.name ?? order.supplierName ?? 'N/A';

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={order.purchaseOrderNumber ?? 'Purchase Order'}
        subtitle={`${order.purchaseType?.replace(/_/g, ' ') ?? 'Purchase'} - ${date(
          order.orderDate,
        )} - ${supplierName}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Btn variant="secondary" onClick={() => router.push('/operations/purchase-orders')}>
              Back
            </Btn>
            {canExportActiveTab && (
              <Btn variant="secondary" onClick={exportCsv}>
                Export CSV
              </Btn>
            )}
            {order.supplier?.id && (
              <Btn
                variant="secondary"
                onClick={() => router.push(`/operations/suppliers/${order.supplier.id}`)}
              >
                View Supplier
              </Btn>
            )}
            <Btn
              variant="secondary"
              onClick={() => router.push(`/operations/purchase-orders/${order.id}/print`)}
            >
              Print / PDF
            </Btn>
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
        <StatCard label="Status" value={order.status?.replace(/_/g, ' ') ?? '-'} />
      </div>

      <Card className="p-2">
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
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
        <Card className="p-5">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-4">
            <InfoRow label="Status" value={<StatusBadge value={order.status} />} />
            <InfoRow label="Payment" value={<StatusBadge value={order.paymentStatus} />} />
            <InfoRow label="Company" value={order.company?.name} />
            <InfoRow label="Branch" value={order.branch?.name} />
            <InfoRow label="Supplier" value={supplierName} />
            <InfoRow label="Supplier Code" value={order.supplier?.supplierCode} />
            <InfoRow label="Purchase Type" value={order.purchaseType?.replace(/_/g, ' ')} />
            <InfoRow label="Currency" value={order.currency} />
            <InfoRow label="Order Date" value={date(order.orderDate)} />
            <InfoRow label="Expected Date" value={date(order.expectedDate)} />
            <InfoRow label="Confirmed At" value={date(order.confirmedAt)} />
            <InfoRow label="Received At" value={date(order.receivedAt)} />
            <InfoRow label="Prepared By" value={order.createdBy?.fullName} />
            <InfoRow label="Confirmed By" value={order.confirmedBy?.fullName} />
            <InfoRow label="Received By" value={order.receivedBy?.fullName} />
            <InfoRow label="Subtotal" value={money(order.subtotal, currency)} />
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
      )}

      {activeTab === 'Line Items' && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm" aria-label="Purchase order line items">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Product</th>
                  <th scope="col" className="px-4 py-3">Description</th>
                  <th scope="col" className="px-4 py-3 text-right">Qty</th>
                  <th scope="col" className="px-4 py-3">Unit</th>
                  <th scope="col" className="px-4 py-3 text-right">Unit Cost</th>
                  <th scope="col" className="px-4 py-3 text-right">Discount</th>
                  <th scope="col" className="px-4 py-3 text-right">Tax</th>
                  <th scope="col" className="px-4 py-3 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((line: AnyRecord) => (
                  <tr key={line.id}>
                    <td className="px-4 py-3 font-semibold">
                      {line.product?.productCode ? `${line.product.productCode} - ` : ''}
                      {line.product?.name}
                    </td>
                    <td className="px-4 py-3">{line.description ?? '-'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{qty(line.quantity)}</td>
                    <td className="px-4 py-3">{line.unit?.symbol ?? line.unit?.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(line.unitCost, currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(line.discountAmount, currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(line.taxAmount, currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(line.lineTotal, currency)}
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                      No line items on this purchase order.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeTab === 'Goods Receipts' && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm" aria-label="Goods received notes">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3">GRN #</th>
                  <th scope="col" className="px-4 py-3">Received Date</th>
                  <th scope="col" className="px-4 py-3 text-right">Lines</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Posted At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {grns.map((grn) => (
                  <tr key={grn.id}>
                    <td className="px-4 py-3 font-mono text-xs">{grn.grnNumber}</td>
                    <td className="px-4 py-3">{date(grn.receivedDate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{grn.lines?.length ?? 0}</td>
                    <td className="px-4 py-3">
                      <StatusBadge value={grn.status} />
                    </td>
                    <td className="px-4 py-3">{date(grn.postedAt)}</td>
                  </tr>
                ))}
                {grns.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                      No goods received notes linked to this purchase order.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeTab === 'Supplier Invoice' && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm" aria-label="Supplier invoices">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Invoice #</th>
                  <th scope="col" className="px-4 py-3">Reference</th>
                  <th scope="col" className="px-4 py-3">Invoice Date</th>
                  <th scope="col" className="px-4 py-3">Due Date</th>
                  <th scope="col" className="px-4 py-3 text-right">Total</th>
                  <th scope="col" className="px-4 py-3 text-right">Paid</th>
                  <th scope="col" className="px-4 py-3 text-right">Outstanding</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-4 py-3 font-mono text-xs">{inv.supplierInvoiceNumber}</td>
                    <td className="px-4 py-3">{inv.invoiceReference ?? '-'}</td>
                    <td className="px-4 py-3">{date(inv.invoiceDate)}</td>
                    <td className="px-4 py-3">{date(inv.dueDate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(inv.totalAmount, inv.currency ?? currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(inv.paidAmount, inv.currency ?? currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(inv.outstandingAmount, inv.currency ?? currency)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={inv.status} />
                    </td>
                  </tr>
                ))}
                {invoices.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                      No supplier invoice linked to this purchase order yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeTab === 'Three-Way Match' && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm" aria-label="Three-way match results">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Match #</th>
                  <th scope="col" className="px-4 py-3">Match Date</th>
                  <th scope="col" className="px-4 py-3 text-right">Qty Variance</th>
                  <th scope="col" className="px-4 py-3 text-right">Amount Variance</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {matches.map((match) => (
                  <tr key={match.id}>
                    <td className="px-4 py-3 font-mono text-xs">{match.matchNumber}</td>
                    <td className="px-4 py-3">{date(match.matchDate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {qty(match.quantityVariance)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(match.amountVariance, currency)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={match.matchStatus} />
                    </td>
                  </tr>
                ))}
                {matches.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                      No three-way match recorded for this purchase order.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeTab === 'Payable' && (
        <Card className="p-5">
          {payable ? (
            <>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-4">
                <InfoRow label="Payable #" value={payable.payableNumber} />
                <InfoRow label="Status" value={<StatusBadge value={payable.status} />} />
                <InfoRow label="Supplier" value={payable.supplierName} />
                <InfoRow label="Issue Date" value={date(payable.issueDate)} />
                <InfoRow label="Due Date" value={date(payable.dueDate)} />
                <InfoRow
                  label="Amount"
                  value={money(payable.amount, payable.currency ?? currency)}
                />
                <InfoRow
                  label="Paid"
                  value={money(payable.paidAmount, payable.currency ?? currency)}
                />
                <InfoRow
                  label="Outstanding"
                  value={money(payable.outstandingAmount, payable.currency ?? currency)}
                />
              </div>
              <div className="mt-5">
                <Btn variant="secondary" onClick={() => router.push('/finance/payables')}>
                  View Payables
                </Btn>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                No payable has been raised for this purchase order yet.
              </p>
              <Btn variant="secondary" onClick={() => router.push('/finance/payables')}>
                View Payables
              </Btn>
            </div>
          )}
        </Card>
      )}

      {activeTab === 'Inventory Movements' && (
        <Card className="p-5 space-y-4">
          <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
            Stock receipts posted against this purchase order are recorded as inventory movements.
            Open the inventory movements ledger filtered to this purchase order.
          </p>
          <div>
            <Btn
              variant="primary"
              disabled={!movementsHref}
              onClick={() => movementsHref && router.push(movementsHref)}
            >
              View Inventory Movements
            </Btn>
          </div>
        </Card>
      )}
    </div>
  );
}
