'use client';

import { WorkspaceTable } from '@/components/ui/workspace-table';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Btn, Card, PageHeader, SkeletonCardGrid, StatusBadge } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useGuardedRouter, useUnsavedWork } from '@/components/workspace/unsaved-work-provider';
import {
  ProfileSections,
  PartnerStatementGenerator,
} from '@/components/workspace/partner-profile-controls';
import { PartnerAction } from '@/components/workspace/trading-partner-workspace';
import '@/components/workspace/workspace.css';
import '@/components/workspace/partner-profile.css';

import { SupplierFormModal, type Company } from '../_components/SupplierFormModal';

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
  divisionId?: string | null;
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
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  const numeric = Number(value);
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
    <div className="partner-profile-detail">
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
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <SupplierProfile key={id} supplierId={id} />;
}
function SupplierProfile({ supplierId }: { supplierId: string }) {
  const router = useGuardedRouter();
  const { request } = useUnsavedWork();
  const { hasPermission, loading: authLoading } = useAuth();
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<Tab>('Overview');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canView = !authLoading && hasPermission('suppliers.view');
  const canViewReports = hasPermission('operations.reports.view');
  const canUpdate = hasPermission('suppliers.update');
  const canDelete = hasPermission('suppliers.delete');

  const result = useWorkspaceResource<SupplierControlCenter>(
    `/suppliers/${supplierId}/control-center`,
    {},
    canView && !!supplierId,
  );
  const { data, loading, error, reload: load } = result;
  const categories = useMemo(
    () => data?.supplier.productCategories?.map((item) => item.productCategory) ?? [],
    [data?.supplier.productCategories],
  );

  const companyOptions = useMemo<Company[]>(() => {
    const company = data?.supplier.company;
    return company ? [{ id: company.id, name: company.name, code: company.code ?? '' }] : [];
  }, [data?.supplier.company]);

  if (authLoading)
    return (
      <p role="status" className="workspace-notice">
        Loading profile...
      </p>
    );
  if (!canView) {
    return (
      <div className="business-workspace partner-profile">
        <PageHeader title="Supplier" subtitle="Supplier control center" />
        <p className="mt-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          Access restricted.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="business-workspace partner-profile">
        <PageHeader title="Supplier" subtitle="Loading supplier control center" />
        <SkeletonCardGrid count={6} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="business-workspace partner-profile">
        <PageHeader title="Supplier" subtitle="Supplier control center" />
        <Card className="p-6">
          <p role="alert" className="workspace-notice">
            {error || 'Supplier not found'}
          </p>
          <Btn variant="secondary" onClick={load}>
            Try again
          </Btn>
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
    <div className="business-workspace partner-profile">
      {editing && (
        <SupplierFormModal
          mode="edit"
          initial={supplier}
          companies={companyOptions}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      )}
      {confirmDelete && (
        <PartnerAction
          partnerKind="suppliers"
          record={supplier}
          kind="delete"
          onClose={() => setConfirmDelete(false)}
          onSaved={() => router.push('/operations/suppliers')}
        />
      )}

      <div className="partner-profile-heading">
        <PageHeader
          title={supplier.name}
          breadcrumbs={[
            { label: 'Operations', href: '/operations' },
            { label: 'Suppliers', href: '/operations/suppliers' },
            { label: supplier.name },
          ]}
          subtitle={`${supplier.supplierCode ?? 'No code'} · ${supplier.company?.name ?? 'Company'} · ${supplier.division?.name ?? 'No division'}`}
        />
        <div className="partner-profile-actions">
          <Btn variant="secondary" onClick={() => router.push('/operations/suppliers')}>
            Back to Suppliers
          </Btn>
          {canViewReports && (
            <Btn
              variant="secondary"
              onClick={() =>
                router.push(
                  `/operations/reports/suppliers?companyId=${encodeURIComponent(supplier.companyId)}&supplierId=${encodeURIComponent(supplier.id)}`,
                )
              }
            >
              Supplier Reports
            </Btn>
          )}
          {canUpdate && (
            <Btn variant="primary" onClick={() => setEditing(true)}>
              Edit
            </Btn>
          )}
          {canDelete && (
            <Btn variant="ghost" onClick={() => setConfirmDelete(true)}>
              Delete
            </Btn>
          )}
          <Btn variant="secondary" onClick={() => request(load)}>
            Refresh
          </Btn>
          <StatusBadge status={supplier.status} />
        </div>
      </div>

      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      <div className="workspace-summary">
        <div>
          <span>Lifetime Purchases</span>
          <strong>{money(summary.lifetimePurchaseTotal)}</strong>
        </div>
        <div>
          <span>YTD Purchases</span>
          <strong>{money(summary.ytdPurchaseTotal)}</strong>
        </div>
        <div>
          <span>Open AP</span>
          <strong>{money(summary.openPayableBalance)}</strong>
        </div>
        <div>
          <span>Overdue AP</span>
          <strong>{money(summary.overduePayableBalance)}</strong>
        </div>
      </div>

      <Card padding="none" className="overflow-hidden">
        <ProfileSections
          items={TABS}
          value={tab}
          onChange={(next) => request(() => setTab(next))}
        />

        <section
          id="partner-profile-section"
          aria-label={`${tab} section`}
          className="partner-profile-content"
        >
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
              <p className="partner-profile-history-note">
                Recent records returned by this profile. Summary balances cover all records.
              </p>
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
                      <div className="partner-profile-order-actions">
                        <StatusBadge status={order.status} />
                        <StatusBadge status={order.paymentStatus} />
                        {hasPermission('purchases.view') && (
                          <Btn
                            variant="secondary"
                            size="xs"
                            onClick={() =>
                              router.push(`/operations/purchase-orders/${order.id}/print`)
                            }
                          >
                            View / Print
                          </Btn>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 overflow-x-auto">
                      <WorkspaceTable className="partner-profile-table">
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
                              <td data-label="Product" className="py-2">
                                {line.product?.name ?? line.description ?? 'Product'}
                              </td>
                              <td data-label="Qty" className="py-2 text-right">
                                {Number(line.quantity).toLocaleString()} {line.unit?.symbol ?? ''}
                              </td>
                              <td data-label="Unit Cost" className="py-2 text-right">
                                {money(line.unitCost, order.currency)}
                              </td>
                              <td data-label="Line Total" className="py-2 text-right">
                                {money(line.lineTotal, order.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </WorkspaceTable>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'Payables' && (
            <div className="space-y-4">
              <p className="partner-profile-history-note">
                Recent records returned by this profile. Summary balances cover all records.
              </p>
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
              <p className="partner-profile-history-note">
                Product history returned by this profile.
              </p>
              {data.productCoverage.length === 0 ? (
                <EmptyPanel text="No product purchase coverage found yet." />
              ) : (
                <WorkspaceTable className="partner-profile-table">
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
                        <td data-label="Product" className="py-3">
                          <div className="font-medium">{row.product.name}</div>
                          <div
                            className="font-mono text-xs"
                            style={{ color: 'var(--aurora-text-muted)' }}
                          >
                            {row.product.productCode ?? row.product.sku ?? ''}
                          </div>
                        </td>
                        <td data-label="Category" className="py-3">
                          {row.product.category?.name ?? '—'}
                        </td>
                        <td data-label="Quantity" className="py-3 text-right">
                          {row.quantity.toLocaleString()} {row.unit?.symbol ?? ''}
                        </td>
                        <td data-label="Amount" className="py-3 text-right">
                          {money(row.totalAmount)}
                        </td>
                        <td data-label="Last Purchased" className="py-3">
                          {shortDate(row.lastPurchasedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </WorkspaceTable>
              )}
            </div>
          )}

          {tab === 'Statements' && (
            <div className="space-y-5">
              <p className="partner-profile-history-note">
                Recent records returned by this profile. Summary balances cover all records.
              </p>
              <PartnerStatementGenerator
                kind="suppliers"
                record={supplier}
                onGenerated={() => {
                  setNotice('Supplier statement generated.');
                  load();
                }}
              />
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
                  value={
                    data.performance.onTimeDeliveryRate == null
                      ? '—'
                      : `${Number(data.performance.onTimeDeliveryRate).toFixed(2)}%`
                  }
                />
                <DetailItem
                  label="Quality Score"
                  value={
                    data.performance.qualityScore == null
                      ? '—'
                      : `${Number(data.performance.qualityScore).toFixed(2)}%`
                  }
                />
                <DetailItem
                  label="Price Competitiveness"
                  value={
                    data.performance.priceCompetitivenessScore == null
                      ? '—'
                      : `${Number(data.performance.priceCompetitivenessScore).toFixed(2)}%`
                  }
                />
                <DetailItem label="Returns" value={money(data.performance.totalReturns)} />
                <DetailItem
                  label="Total purchases"
                  value={money(data.performance.totalPurchases)}
                />
                <DetailItem
                  label="Last reviewed"
                  value={shortDate(data.performance.lastReviewedAt)}
                />
                <DetailItem
                  label="Reviewed by"
                  value={
                    data.performance.reviewedBy?.fullName || data.performance.reviewedBy?.email
                  }
                />
                <DetailItem
                  label="Disputes"
                  value={
                    data.performance.disputeCount == null
                      ? '—'
                      : String(data.performance.disputeCount)
                  }
                />
                <div className="md:col-span-3">
                  <DetailItem label="Notes" value={data.performance.notes} />
                </div>
              </div>
            ) : (
              <EmptyPanel text="No supplier performance profile has been recorded." />
            ))}

          {tab === 'Audit' && (
            <div className="space-y-5">
              <p className="partner-profile-history-note">
                Recent ledger activity returned by this profile.
              </p>
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
        </section>
      </Card>
    </div>
  );
}
