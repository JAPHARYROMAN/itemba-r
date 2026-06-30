'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  Card,
  DateInput,
  PageHeader,
  SkeletonCardGrid,
  StatCard,
  StatusBadge,
  showToast,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendGet, backendPost } from '@/lib/api-client';

interface SupplierCategory {
  productCategory: { id: string; name: string; categoryType: string };
}

interface SupplierDetail {
  id: string;
  supplierCode?: string | null;
  name: string;
  legalName?: string | null;
  supplierType: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  contactPerson?: string | null;
  tin?: string | null;
  vrn?: string | null;
  creditLimit: number;
  currentBalance: number;
  paymentTerms?: string | null;
  status: string;
  notes?: string | null;
  companyId: string;
  company?: { id: string; name: string; code?: string | null } | null;
  division?: { id: string; name: string; code?: string | null } | null;
  branch?: { id: string; name: string; code?: string | null } | null;
  productCategories?: SupplierCategory[];
  createdAt?: string;
  updatedAt?: string;
}

interface PurchaseOrderLine {
  id: string;
  description?: string | null;
  quantity: number | string;
  unitCost: number | string;
  lineTotal: number | string;
  product?: {
    id: string;
    productCode?: string | null;
    sku?: string | null;
    name: string;
    category?: { name: string } | null;
  } | null;
  unit?: { name: string; symbol?: string | null } | null;
}

interface PurchaseOrder {
  id: string;
  purchaseOrderNumber: string;
  orderDate: string;
  status: string;
  paymentStatus: string;
  totalAmount: number | string;
  paidAmount: number | string;
  outstandingAmount: number | string;
  currency: string;
  lines?: PurchaseOrderLine[];
}

interface Payable {
  id: string;
  payableNumber: string;
  issueDate: string;
  dueDate?: string | null;
  status: string;
  amount: number | string;
  paidAmount: number | string;
  outstandingAmount: number | string;
  currency: string;
  notes?: string | null;
  purchaseOrders?: Array<{
    id: string;
    purchaseOrderNumber: string;
    status: string;
    totalAmount: number | string;
  }>;
}

interface StatementRun {
  id: string;
  statementRunNumber: string;
  periodStart: string;
  periodEnd: string;
  totalDebits: number | string;
  totalCredits: number | string;
  closingBalance: number | string;
  status: string;
  generatedAt?: string;
  generatedBy?: { fullName?: string | null; email?: string | null } | null;
}

interface PerformanceProfile {
  rating: string;
  onTimeDeliveryRate?: number | string | null;
  qualityScore?: number | string | null;
  priceCompetitivenessScore?: number | string | null;
  totalPurchases?: number | string | null;
  totalReturns?: number | string | null;
  disputeCount?: number | string | null;
  lastReviewedAt?: string | null;
  notes?: string | null;
  reviewedBy?: { fullName?: string | null; email?: string | null } | null;
}

interface ProductCoverage {
  product: {
    id: string;
    productCode?: string | null;
    sku?: string | null;
    name: string;
    category?: { name: string; categoryType?: string | null } | null;
  };
  unit?: { name: string; symbol?: string | null } | null;
  quantity: number;
  totalAmount: number;
  lastPurchasedAt: string;
}

interface LedgerEvent {
  id: string;
  type: string;
  sourceId: string;
  reference: string;
  date: string;
  dueDate?: string | null;
  status: string;
  paymentStatus?: string;
  debit: number;
  credit: number;
  balanceImpact: number;
  currency: string;
  notes?: string | null;
}

interface SupplierControlCenter {
  supplier: SupplierDetail;
  summary: {
    lifetimePurchaseTotal: number;
    ytdPurchaseTotal: number;
    receivedPurchaseTotal: number;
    purchaseOrderCount: number;
    openPayableBalance: number;
    overduePayableBalance: number;
    paidPayableTotal: number;
    payableCount: number;
  };
  recentPurchaseOrders: PurchaseOrder[];
  openPayables: Payable[];
  recentPayables: Payable[];
  latestStatements: StatementRun[];
  performance?: PerformanceProfile | null;
  productCoverage: ProductCoverage[];
  ledger: LedgerEvent[];
  audit?: {
    createdAt?: string;
    updatedAt?: string;
    createdBy?: { fullName?: string | null; email?: string | null } | null;
    updatedBy?: { fullName?: string | null; email?: string | null } | null;
  };
}

const TABS = [
  'Overview',
  'Purchases',
  'Payables',
  'Products',
  'Statements',
  'Performance',
  'Audit',
] as const;
type Tab = (typeof TABS)[number];

function money(value: number | string | null | undefined, currency = 'TZS') {
  const numeric = Number(value ?? 0);
  return `${currency} ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(numeric) ? numeric : 0)}`;
}

function shortDate(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function monthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | number | null;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
        {label}
      </p>
      <p
        className={`mt-1 text-sm ${mono ? 'font-mono' : 'font-medium'}`}
        style={{ color: 'var(--aurora-text)' }}
      >
        {value || '—'}
      </p>
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div
      className="rounded-lg border px-4 py-8 text-center text-sm"
      style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}
    >
      {text}
    </div>
  );
}

export default function SupplierDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const supplierId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { hasPermission } = useAuth();
  const [data, setData] = useState<SupplierControlCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('Overview');
  const [statementStart, setStatementStart] = useState(isoDate(monthStart()));
  const [statementEnd, setStatementEnd] = useState(isoDate(new Date()));
  const [generating, setGenerating] = useState(false);

  const canView = hasPermission('suppliers.view');
  const canGenerateStatements = hasPermission('supplier_statements.generate');

  const load = useCallback(async () => {
    if (!canView || !supplierId) return;
    setLoading(true);
    setError('');
    try {
      const record = await backendGet<SupplierControlCenter>(
        `/suppliers/${supplierId}/control-center`,
      );
      setData(record);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load supplier';
      setError(message);
      showToast('error', 'Could not load supplier', message);
    } finally {
      setLoading(false);
    }
  }, [canView, supplierId]);

  useEffect(() => {
    load();
  }, [load]);

  const generateStatement = async () => {
    if (!data) return;
    setGenerating(true);
    try {
      await backendPost('/supplier-statements/generate', {
        companyId: data.supplier.companyId,
        supplierId: data.supplier.id,
        periodStart: statementStart,
        periodEnd: statementEnd,
      });
      showToast('success', 'Supplier statement generated', data.supplier.name);
      load();
    } catch (err) {
      showToast(
        'error',
        'Could not generate statement',
        err instanceof Error ? err.message : 'Failed',
      );
    } finally {
      setGenerating(false);
    }
  };

  const categories = useMemo(
    () => data?.supplier.productCategories?.map((item) => item.productCategory) ?? [],
    [data?.supplier.productCategories],
  );

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Supplier" subtitle="Supplier control center" />
        <p className="mt-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          Access restricted.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title="Supplier" subtitle="Loading supplier control center" />
        <SkeletonCardGrid count={6} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title="Supplier" subtitle="Supplier control center" />
        <Card className="p-6">
          <p className="text-sm text-red-300">{error || 'Supplier not found'}</p>
          <Btn
            className="mt-4"
            variant="secondary"
            onClick={() => router.push('/operations/suppliers')}
          >
            Back to Suppliers
          </Btn>
        </Card>
      </div>
    );
  }

  const { supplier, summary } = data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <PageHeader
          title={supplier.name}
          subtitle={`${supplier.supplierCode ?? 'No code'} · ${supplier.company?.name ?? 'Company'} · ${supplier.division?.name ?? 'No division'}`}
        />
        <div className="flex flex-wrap gap-2">
          <Btn variant="secondary" onClick={() => router.push('/operations/suppliers')}>
            Back to Suppliers
          </Btn>
          <Btn
            variant="secondary"
            onClick={() =>
              router.push(`/operations/reports?search=${encodeURIComponent(supplier.name)}`)
            }
          >
            Supplier Reports
          </Btn>
          <StatusBadge status={supplier.status} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <StatCard label="Lifetime Purchases" value={money(summary.lifetimePurchaseTotal)} />
        <StatCard label="YTD Purchases" value={money(summary.ytdPurchaseTotal)} />
        <StatCard label="Open AP" value={money(summary.openPayableBalance)} />
        <StatCard label="Overdue AP" value={money(summary.overduePayableBalance)} />
      </div>

      <Card className="overflow-hidden">
        <div
          className="flex flex-wrap gap-2 border-b p-3"
          style={{ borderColor: 'var(--aurora-border)' }}
        >
          {TABS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${tab === item ? 'bg-brand-600 text-white' : 'hover:bg-white/5'}`}
              style={tab === item ? undefined : { color: 'var(--aurora-text-secondary)' }}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === 'Overview' && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              <div className="lg:col-span-2 grid grid-cols-1 gap-4 md:grid-cols-2">
                <DetailItem label="Legal Name" value={supplier.legalName} />
                <DetailItem
                  label="Supplier Type"
                  value={supplier.supplierType?.replace(/_/g, ' ')}
                />
                <DetailItem label="Contact Person" value={supplier.contactPerson} />
                <DetailItem label="Phone" value={supplier.phone} />
                <DetailItem label="Email" value={supplier.email} />
                <DetailItem label="TIN" value={supplier.tin} mono />
                <DetailItem label="VRN" value={supplier.vrn} mono />
                <DetailItem label="Payment Terms" value={supplier.paymentTerms} />
                <DetailItem label="Credit Limit" value={money(supplier.creditLimit)} />
                <DetailItem label="Current Balance" value={money(supplier.currentBalance)} />
                <div className="md:col-span-2">
                  <DetailItem label="Address" value={supplier.address} />
                </div>
                <div className="md:col-span-2">
                  <DetailItem label="Notes" value={supplier.notes} />
                </div>
              </div>
              <div
                className="rounded-lg border p-4"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <h3 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  Category Coverage
                </h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {categories.length ? (
                    categories.map((category) => (
                      <span
                        key={category.id}
                        className="rounded-full border px-2 py-1 text-xs"
                        style={{
                          borderColor: 'var(--aurora-border)',
                          color: 'var(--aurora-text-secondary)',
                        }}
                      >
                        {category.name}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                      No category coverage configured.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'Purchases' && (
            <div className="space-y-4">
              {data.recentPurchaseOrders.length === 0 ? (
                <EmptyPanel text="No purchase orders for this supplier yet." />
              ) : (
                data.recentPurchaseOrders.map((order) => (
                  <div
                    key={order.id}
                    className="rounded-lg border p-4"
                    style={{ borderColor: 'var(--aurora-border)' }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                          {order.purchaseOrderNumber}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                          {shortDate(order.orderDate)} · {money(order.totalAmount, order.currency)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={order.status} />
                        <StatusBadge status={order.paymentStatus} />
                        <Btn
                          variant="secondary"
                          size="xs"
                          onClick={() =>
                            router.push(`/operations/purchase-orders/${order.id}/print`)
                          }
                        >
                          View / Print
                        </Btn>
                      </div>
                    </div>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[700px] text-xs">
                        <thead style={{ color: 'var(--aurora-text-muted)' }}>
                          <tr className="text-left uppercase">
                            <th className="py-2">Product</th>
                            <th className="py-2 text-right">Qty</th>
                            <th className="py-2 text-right">Unit Cost</th>
                            <th className="py-2 text-right">Line Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {order.lines?.map((line) => (
                            <tr
                              key={line.id}
                              className="border-t"
                              style={{ borderColor: 'var(--aurora-border)' }}
                            >
                              <td className="py-2">
                                {line.product?.name ?? line.description ?? 'Product'}
                              </td>
                              <td className="py-2 text-right">
                                {Number(line.quantity).toLocaleString()} {line.unit?.symbol ?? ''}
                              </td>
                              <td className="py-2 text-right">
                                {money(line.unitCost, order.currency)}
                              </td>
                              <td className="py-2 text-right">
                                {money(line.lineTotal, order.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'Payables' && (
            <div className="space-y-4">
              {data.recentPayables.length === 0 ? (
                <EmptyPanel text="No payables recorded for this supplier." />
              ) : (
                data.recentPayables.map((payable) => (
                  <div
                    key={payable.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                    style={{ borderColor: 'var(--aurora-border)' }}
                  >
                    <div>
                      <p className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                        {payable.payableNumber}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        Issued {shortDate(payable.issueDate)} · Due {shortDate(payable.dueDate)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        {money(payable.outstandingAmount, payable.currency)}
                      </p>
                      <div className="mt-1 flex justify-end">
                        <StatusBadge status={payable.status} />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'Products' && (
            <div className="overflow-x-auto">
              {data.productCoverage.length === 0 ? (
                <EmptyPanel text="No product purchase coverage found yet." />
              ) : (
                <table className="w-full min-w-[820px] text-sm">
                  <thead
                    className="text-left text-xs uppercase"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    <tr>
                      <th className="py-2">Product</th>
                      <th className="py-2">Category</th>
                      <th className="py-2 text-right">Quantity</th>
                      <th className="py-2 text-right">Amount</th>
                      <th className="py-2">Last Purchased</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.productCoverage.map((row) => (
                      <tr
                        key={row.product.id}
                        className="border-t"
                        style={{ borderColor: 'var(--aurora-border)' }}
                      >
                        <td className="py-3">
                          <div className="font-medium">{row.product.name}</div>
                          <div
                            className="font-mono text-xs"
                            style={{ color: 'var(--aurora-text-muted)' }}
                          >
                            {row.product.productCode ?? row.product.sku ?? ''}
                          </div>
                        </td>
                        <td className="py-3">{row.product.category?.name ?? '—'}</td>
                        <td className="py-3 text-right">
                          {row.quantity.toLocaleString()} {row.unit?.symbol ?? ''}
                        </td>
                        <td className="py-3 text-right">{money(row.totalAmount)}</td>
                        <td className="py-3">{shortDate(row.lastPurchasedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'Statements' && (
            <div className="space-y-5">
              {canGenerateStatements && (
                <div
                  className="grid grid-cols-1 gap-3 rounded-lg border p-4 md:grid-cols-[1fr_1fr_auto]"
                  style={{ borderColor: 'var(--aurora-border)' }}
                >
                  <DateInput
                    label="Period Start"
                    value={statementStart}
                    onChange={(event) => setStatementStart(event.target.value)}
                  />
                  <DateInput
                    label="Period End"
                    value={statementEnd}
                    onChange={(event) => setStatementEnd(event.target.value)}
                  />
                  <div className="flex items-end">
                    <Btn variant="primary" onClick={generateStatement} loading={generating}>
                      Generate
                    </Btn>
                  </div>
                </div>
              )}
              {data.latestStatements.length === 0 ? (
                <EmptyPanel text="No supplier statements have been generated." />
              ) : (
                data.latestStatements.map((statement) => (
                  <div
                    key={statement.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                    style={{ borderColor: 'var(--aurora-border)' }}
                  >
                    <div>
                      <p className="font-semibold">{statement.statementRunNumber}</p>
                      <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {shortDate(statement.periodStart)} - {shortDate(statement.periodEnd)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{money(statement.closingBalance)}</p>
                      <StatusBadge status={statement.status} />
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'Performance' &&
            (data.performance ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <DetailItem label="Rating" value={data.performance.rating} />
                <DetailItem
                  label="On-Time Delivery"
                  value={`${Number(data.performance.onTimeDeliveryRate ?? 0).toFixed(2)}%`}
                />
                <DetailItem
                  label="Quality Score"
                  value={`${Number(data.performance.qualityScore ?? 0).toFixed(2)}%`}
                />
                <DetailItem
                  label="Price Competitiveness"
                  value={`${Number(data.performance.priceCompetitivenessScore ?? 0).toFixed(2)}%`}
                />
                <DetailItem label="Returns" value={money(data.performance.totalReturns)} />
                <DetailItem label="Disputes" value={String(data.performance.disputeCount ?? 0)} />
                <div className="md:col-span-3">
                  <DetailItem label="Notes" value={data.performance.notes} />
                </div>
              </div>
            ) : (
              <EmptyPanel text="No supplier performance profile has been recorded." />
            ))}

          {tab === 'Audit' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <DetailItem
                  label="Created At"
                  value={shortDate(data.audit?.createdAt ?? supplier.createdAt)}
                />
                <DetailItem
                  label="Updated At"
                  value={shortDate(data.audit?.updatedAt ?? supplier.updatedAt)}
                />
                <DetailItem
                  label="Created By"
                  value={data.audit?.createdBy?.fullName ?? data.audit?.createdBy?.email}
                />
                <DetailItem
                  label="Updated By"
                  value={data.audit?.updatedBy?.fullName ?? data.audit?.updatedBy?.email}
                />
              </div>
              <div>
                <h3 className="mb-3 text-sm font-semibold">Recent Ledger Events</h3>
                {data.ledger.length === 0 ? (
                  <EmptyPanel text="No supplier ledger events yet." />
                ) : (
                  <div className="space-y-2">
                    {data.ledger.map((event) => (
                      <div
                        key={event.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                        style={{ borderColor: 'var(--aurora-border)' }}
                      >
                        <div>
                          <p className="font-medium">{event.reference}</p>
                          <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                            {event.type.replace(/_/g, ' ')} · {shortDate(event.date)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p>{money(event.balanceImpact, event.currency)}</p>
                          <StatusBadge status={event.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
