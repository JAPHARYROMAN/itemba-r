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

type Tab =
  | 'Overview'
  | 'Sales'
  | 'Receivables'
  | 'Products'
  | 'Statements'
  | 'Pricing'
  | 'Credit'
  | 'Audit';

interface CustomerDetail {
  id: string;
  customerCode?: string | null;
  name: string;
  legalName?: string | null;
  customerType: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  contactPerson?: string | null;
  tin?: string | null;
  vrn?: string | null;
  creditLimit: number | string;
  currentBalance: number | string;
  paymentTerms?: string | null;
  status: string;
  notes?: string | null;
  companyId: string;
  company?: { id: string; name: string; code?: string | null } | null;
  division?: { id: string; name: string; code?: string | null } | null;
  branch?: { id: string; name: string; code?: string | null } | null;
  createdAt?: string;
  updatedAt?: string;
}

interface SalesOrderLine {
  id: string;
  description?: string | null;
  quantity: number | string;
  unitPrice: number | string;
  lineTotal: number | string;
  product?: { id: string; productCode?: string | null; sku?: string | null; name: string; category?: { name: string } | null } | null;
  unit?: { name: string; symbol?: string | null } | null;
}

interface SalesOrder {
  id: string;
  salesOrderNumber: string;
  orderDate: string;
  status: string;
  paymentStatus: string;
  salesType: string;
  totalAmount: number | string;
  paidAmount: number | string;
  outstandingAmount: number | string;
  currency: string;
  salesperson?: { fullName?: string | null; employeeCode?: string | null } | null;
  lines?: SalesOrderLine[];
}

interface Receivable {
  id: string;
  receivableNumber: string;
  issueDate: string;
  dueDate?: string | null;
  status: string;
  amount: number | string;
  paidAmount: number | string;
  outstandingAmount: number | string;
  currency: string;
  notes?: string | null;
  salesOrders?: Array<{ id: string; salesOrderNumber: string; status: string; totalAmount: number | string }>;
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

interface ProductHistory {
  product: { id: string; productCode?: string | null; sku?: string | null; name: string; category?: { name: string; categoryType?: string | null } | null };
  unit?: { name: string; symbol?: string | null } | null;
  quantity: number;
  totalAmount: number;
  lastPurchasedAt: string;
}

interface PriceAgreement {
  id: string;
  agreedPrice?: number | string | null;
  discountPercent?: number | string | null;
  startDate: string;
  endDate?: string | null;
  status: string;
  notes?: string | null;
  priceList?: { id: string; name: string; priceListType?: string | null; status: string } | null;
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

interface CustomerControlCenter {
  customer: CustomerDetail;
  summary: {
    lifetimeSalesTotal: number;
    ytdSalesTotal: number;
    paidSalesTotal: number;
    salesOrderCount: number;
    openReceivableBalance: number;
    overdueReceivableBalance: number;
    paidReceivableTotal: number;
    receivableCount: number;
    creditLimit: number;
    creditAvailable: number;
    creditUtilizationPct: number;
  };
  recentSalesOrders: SalesOrder[];
  openReceivables: Receivable[];
  recentReceivables: Receivable[];
  latestStatements: StatementRun[];
  priceAgreements: PriceAgreement[];
  productHistory: ProductHistory[];
  ledger: LedgerEvent[];
  audit?: {
    createdAt?: string;
    updatedAt?: string;
    createdBy?: { fullName?: string | null; email?: string | null } | null;
    updatedBy?: { fullName?: string | null; email?: string | null } | null;
  };
}

const TABS: Tab[] = [
  'Overview',
  'Sales',
  'Receivables',
  'Products',
  'Statements',
  'Pricing',
  'Credit',
  'Audit',
];

function money(value: number | string | null | undefined, currency = 'TZS') {
  const numeric = Number(value ?? 0);
  return `${currency} ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(numeric) ? numeric : 0)}`;
}

function shortDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString();
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function DetailItem({ label, value, mono = false }: { label: string; value?: string | number | null; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
        {label}
      </p>
      <p className={`mt-1 text-sm ${mono ? 'font-mono' : 'font-medium'}`} style={{ color: 'var(--aurora-text)' }}>
        {value || '-'}
      </p>
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-lg border px-4 py-8 text-center text-sm" style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}>
      {text}
    </div>
  );
}

export default function CustomerDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const customerId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { hasPermission } = useAuth();
  const [data, setData] = useState<CustomerControlCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('Overview');
  const [statementStart, setStatementStart] = useState(isoDate(monthStart()));
  const [statementEnd, setStatementEnd] = useState(isoDate(new Date()));
  const [generating, setGenerating] = useState(false);

  const canView = hasPermission('customers.view');
  const canGenerateStatements = hasPermission('customer_statements.generate');

  const load = useCallback(async () => {
    if (!canView || !customerId) return;
    setLoading(true);
    setError('');
    try {
      const record = await backendGet<CustomerControlCenter>(`/customers/${customerId}/control-center`);
      setData(record);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load customer';
      setError(message);
      showToast('error', 'Could not load customer', message);
    } finally {
      setLoading(false);
    }
  }, [canView, customerId]);

  useEffect(() => {
    load();
  }, [load]);

  const generateStatement = async () => {
    if (!data) return;
    setGenerating(true);
    try {
      await backendPost('/customer-statements/generate', {
        companyId: data.customer.companyId,
        customerId: data.customer.id,
        periodStart: statementStart,
        periodEnd: statementEnd,
      });
      showToast('success', 'Customer statement generated', data.customer.name);
      load();
    } catch (err) {
      showToast('error', 'Could not generate statement', err instanceof Error ? err.message : 'Failed');
    } finally {
      setGenerating(false);
    }
  };

  const creditColor = useMemo(() => {
    const utilization = data?.summary.creditUtilizationPct ?? 0;
    if (utilization >= 90) return 'text-red-300';
    if (utilization >= 70) return 'text-amber-300';
    return 'text-emerald-300';
  }, [data?.summary.creditUtilizationPct]);

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Customer" subtitle="Customer control center" />
        <p className="mt-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          Access restricted.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title="Customer" subtitle="Loading customer control center" />
        <SkeletonCardGrid count={6} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title="Customer" subtitle="Customer control center" />
        <Card className="p-6">
          <p className="text-sm text-red-300">{error || 'Customer not found'}</p>
          <Btn className="mt-4" variant="secondary" onClick={() => router.push('/operations/customers')}>
            Back to Customers
          </Btn>
        </Card>
      </div>
    );
  }

  const { customer, summary } = data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <PageHeader
          title={customer.name}
          subtitle={`${customer.customerCode ?? 'No code'} - ${customer.company?.name ?? 'Company'} - ${customer.branch?.name ?? 'No branch'}`}
        />
        <div className="flex flex-wrap gap-2">
          <Btn variant="secondary" onClick={() => router.push('/operations/customers')}>
            Back to Customers
          </Btn>
          <Btn
            variant="secondary"
            onClick={() => router.push(`/operations/reports?search=${encodeURIComponent(customer.name)}`)}
          >
            Customer Reports
          </Btn>
          <StatusBadge status={customer.status} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <StatCard label="Lifetime Sales" value={money(summary.lifetimeSalesTotal)} />
        <StatCard label="YTD Sales" value={money(summary.ytdSalesTotal)} />
        <StatCard label="Open AR" value={money(summary.openReceivableBalance)} />
        <StatCard label="Overdue AR" value={money(summary.overdueReceivableBalance)} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b p-3" style={{ borderColor: 'var(--aurora-border)' }}>
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
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:col-span-2">
                <DetailItem label="Legal Name" value={customer.legalName} />
                <DetailItem label="Customer Type" value={humanize(customer.customerType)} />
                <DetailItem label="Contact Person" value={customer.contactPerson} />
                <DetailItem label="Phone" value={customer.phone} />
                <DetailItem label="Email" value={customer.email} />
                <DetailItem label="TIN" value={customer.tin} mono />
                <DetailItem label="VRN" value={customer.vrn} mono />
                <DetailItem label="Payment Terms" value={customer.paymentTerms} />
                <DetailItem label="Division" value={customer.division?.name} />
                <DetailItem label="Branch" value={customer.branch?.name} />
                <div className="md:col-span-2"><DetailItem label="Address" value={customer.address} /></div>
                <div className="md:col-span-2"><DetailItem label="Notes" value={customer.notes} /></div>
              </div>
              <div className="rounded-lg border p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  Credit Snapshot
                </h3>
                <div className="mt-4 space-y-3">
                  <DetailItem label="Credit Limit" value={money(summary.creditLimit)} />
                  <DetailItem label="Current Exposure" value={money(summary.openReceivableBalance)} />
                  <DetailItem label="Available Credit" value={money(summary.creditAvailable)} />
                  <div>
                    <p className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                      Utilization
                    </p>
                    <p className={`mt-1 text-lg font-semibold ${creditColor}`}>
                      {summary.creditUtilizationPct.toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'Sales' && (
            <div className="space-y-4">
              {data.recentSalesOrders.length === 0 ? (
                <EmptyPanel text="No sales orders for this customer yet." />
              ) : (
                data.recentSalesOrders.map((order) => (
                  <div key={order.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold" style={{ color: 'var(--aurora-text)' }}>{order.salesOrderNumber}</p>
                        <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                          {shortDate(order.orderDate)} - {humanize(order.salesType)} - {money(order.totalAmount, order.currency)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={order.status} />
                        <StatusBadge status={order.paymentStatus} />
                        <Btn
                          variant="secondary"
                          size="xs"
                          onClick={() => router.push(`/operations/sales-orders/${order.id}/print`)}
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
                            <th className="py-2 text-right">Unit Price</th>
                            <th className="py-2 text-right">Line Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {order.lines?.map((line) => (
                            <tr key={line.id} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                              <td className="py-2">{line.product?.name ?? line.description ?? 'Product'}</td>
                              <td className="py-2 text-right">{Number(line.quantity).toLocaleString()} {line.unit?.symbol ?? ''}</td>
                              <td className="py-2 text-right">{money(line.unitPrice, order.currency)}</td>
                              <td className="py-2 text-right">{money(line.lineTotal, order.currency)}</td>
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

          {tab === 'Receivables' && (
            <div className="space-y-4">
              {data.recentReceivables.length === 0 ? (
                <EmptyPanel text="No receivables recorded for this customer." />
              ) : (
                data.recentReceivables.map((receivable) => (
                  <div key={receivable.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                    <div>
                      <p className="font-semibold" style={{ color: 'var(--aurora-text)' }}>{receivable.receivableNumber}</p>
                      <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        Issued {shortDate(receivable.issueDate)} - Due {shortDate(receivable.dueDate)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{money(receivable.outstandingAmount, receivable.currency)}</p>
                      <div className="mt-1 flex justify-end"><StatusBadge status={receivable.status} /></div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'Products' && (
            <div className="overflow-x-auto">
              {data.productHistory.length === 0 ? (
                <EmptyPanel text="No product sales history found yet." />
              ) : (
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="text-left text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                    <tr>
                      <th className="py-2">Product</th>
                      <th className="py-2">Category</th>
                      <th className="py-2 text-right">Quantity</th>
                      <th className="py-2 text-right">Amount</th>
                      <th className="py-2">Last Bought</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.productHistory.map((row) => (
                      <tr key={row.product.id} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                        <td className="py-3">
                          <div className="font-medium">{row.product.name}</div>
                          <div className="font-mono text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                            {row.product.productCode ?? row.product.sku ?? ''}
                          </div>
                        </td>
                        <td className="py-3">{row.product.category?.name ?? '-'}</td>
                        <td className="py-3 text-right">{row.quantity.toLocaleString()} {row.unit?.symbol ?? ''}</td>
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
                <div className="grid grid-cols-1 gap-3 rounded-lg border p-4 md:grid-cols-[1fr_1fr_auto]" style={{ borderColor: 'var(--aurora-border)' }}>
                  <DateInput label="Period Start" value={statementStart} onChange={(event) => setStatementStart(event.target.value)} />
                  <DateInput label="Period End" value={statementEnd} onChange={(event) => setStatementEnd(event.target.value)} />
                  <div className="flex items-end">
                    <Btn variant="primary" onClick={generateStatement} loading={generating}>
                      Generate
                    </Btn>
                  </div>
                </div>
              )}
              {data.latestStatements.length === 0 ? (
                <EmptyPanel text="No customer statements have been generated." />
              ) : (
                data.latestStatements.map((statement) => (
                  <div key={statement.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--aurora-border)' }}>
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

          {tab === 'Pricing' && (
            <div className="space-y-3">
              {data.priceAgreements.length === 0 ? (
                <EmptyPanel text="No customer-specific price agreements found." />
              ) : (
                data.priceAgreements.map((agreement) => (
                  <div key={agreement.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold">{agreement.priceList?.name ?? 'Direct price agreement'}</p>
                        <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                          {shortDate(agreement.startDate)} - {shortDate(agreement.endDate)}
                        </p>
                      </div>
                      <StatusBadge status={agreement.status} />
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                      <DetailItem label="Agreed Price" value={agreement.agreedPrice ? money(agreement.agreedPrice) : '-'} />
                      <DetailItem label="Discount %" value={agreement.discountPercent ? `${agreement.discountPercent}%` : '-'} />
                      <DetailItem label="Notes" value={agreement.notes} />
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'Credit' && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <DetailItem label="Credit Limit" value={money(summary.creditLimit)} />
              <DetailItem label="Open Receivables" value={money(summary.openReceivableBalance)} />
              <DetailItem label="Overdue Receivables" value={money(summary.overdueReceivableBalance)} />
              <DetailItem label="Available Credit" value={money(summary.creditAvailable)} />
              <DetailItem label="Credit Utilization" value={`${summary.creditUtilizationPct.toFixed(1)}%`} />
              <DetailItem label="Customer Status" value={humanize(customer.status)} />
            </div>
          )}

          {tab === 'Audit' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <DetailItem label="Created At" value={shortDate(data.audit?.createdAt ?? customer.createdAt)} />
                <DetailItem label="Updated At" value={shortDate(data.audit?.updatedAt ?? customer.updatedAt)} />
                <DetailItem label="Created By" value={data.audit?.createdBy?.fullName ?? data.audit?.createdBy?.email} />
                <DetailItem label="Updated By" value={data.audit?.updatedBy?.fullName ?? data.audit?.updatedBy?.email} />
              </div>
              <div>
                <h3 className="mb-3 text-sm font-semibold">Recent Ledger Events</h3>
                {data.ledger.length === 0 ? (
                  <EmptyPanel text="No customer ledger events yet." />
                ) : (
                  <div className="space-y-2">
                    {data.ledger.map((event) => (
                      <div key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)' }}>
                        <div>
                          <p className="font-medium">{event.reference}</p>
                          <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{humanize(event.type)} - {shortDate(event.date)}</p>
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
