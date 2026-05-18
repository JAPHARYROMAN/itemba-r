'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { DocumentPreviewLink } from '@/components/documents';
import { Btn, Card, PageHeader, PageSpinner, StatusBadge } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Customer {
  id: string;
  customerCode: string;
  name: string;
  customerType: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  contactPerson?: string | null;
  paymentTerms?: string | null;
  status: string;
  company?: { id: string; name: string; code: string } | null;
  branch?: { id: string; name: string } | null;
}

interface Profile {
  customer: Customer;
  credit: {
    creditLimit: number;
    currentBalance: number;
    totalReceivable: number;
    overdueAmount: number;
    overdueCount: number;
    openReceivables: number;
    creditAvailable: number;
    creditUtilizationPct: number;
  };
  lifetime: {
    ordersCount: number;
    totalSpend: number;
  };
  recentOrders: Array<{
    id: string;
    salesOrderNumber: string;
    orderDate: string;
    totalAmount: number | string;
    paidAmount: number | string;
    outstandingAmount: number | string;
    status: string;
    paymentStatus: string;
    paymentMethod?: string | null;
    salesperson?: { id: string; fullName?: string | null; employeeCode?: string | null } | null;
  }>;
  topProducts: Array<{
    productId: string;
    productName: string;
    sku?: string | null;
    totalQuantity: number;
    totalSpend: number;
  }>;
  recentPayments: Array<{
    id: string;
    receivableNumber: string;
    amount: number | string;
    paidAmount: number | string;
    updatedAt: string;
  }>;
  preferredSalesperson: { id: string; fullName?: string | null; employeeCode?: string | null } | null;
}

const fmt = (n: number | string | undefined | null) =>
  new Intl.NumberFormat('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(Number(n ?? 0)) ? Number(n ?? 0) : 0);

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CustomerProfilePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError('');
    fetch(`/api/backend/customers/${id}/profile`)
      .then(async r => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j?.message ?? `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then(j => setProfile(j.data ?? j))
      .catch(err => setError(err instanceof Error ? err.message : 'Load failed'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageSpinner />;
  if (error) return (
    <div className="p-6">
      <Card className="p-4 bg-red-50 border-red-200 text-red-700 text-sm">{error}</Card>
    </div>
  );
  if (!profile) return null;

  const { customer, credit, lifetime, recentOrders, topProducts, recentPayments, preferredSalesperson } = profile;
  const utilColor =
    credit.creditUtilizationPct >= 90 ? 'bg-red-100 text-red-700 border-red-200' :
    credit.creditUtilizationPct >= 70 ? 'bg-amber-100 text-amber-700 border-amber-200' :
    'bg-emerald-100 text-emerald-700 border-emerald-200';

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title={customer.name}
        subtitle={`${customer.customerCode} · ${customer.customerType}${customer.branch?.name ? ' · ' + customer.branch.name : ''} · ${customer.status}`}
        breadcrumbs={[
          { label: 'Westsides', href: '/westsides' },
          { label: 'Customers', href: '/westsides/customers' },
          { label: customer.name },
        ]}
        actions={
          <DocumentPreviewLink href={`/westsides/customers/${customer.id}/print`} />
        }
      />

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Outstanding" value={`TZS ${fmt(credit.totalReceivable)}`} hint={`${credit.openReceivables} open invoice${credit.openReceivables === 1 ? '' : 's'}`} />
        <Tile
          label="Credit Limit"
          value={`TZS ${fmt(credit.creditLimit)}`}
          hint={credit.creditLimit > 0 ? `${credit.creditUtilizationPct.toFixed(0)}% used` : 'No limit set'}
        />
        <Tile
          label="Available Credit"
          value={`TZS ${fmt(credit.creditAvailable)}`}
          tone={credit.creditUtilizationPct >= 90 ? 'danger' : credit.creditUtilizationPct >= 70 ? 'warn' : 'good'}
        />
        <Tile
          label="Lifetime Spend"
          value={`TZS ${fmt(lifetime.totalSpend)}`}
          hint={`${lifetime.ordersCount} order${lifetime.ordersCount === 1 ? '' : 's'}`}
        />
      </div>

      {credit.overdueAmount > 0 && (
        <Card className="p-3 bg-red-50 border-red-200 text-red-700 text-sm font-medium flex items-center justify-between">
          <span>⚠ Overdue: TZS {fmt(credit.overdueAmount)} across {credit.overdueCount} invoice{credit.overdueCount === 1 ? '' : 's'}</span>
        </Card>
      )}

      {/* Credit utilization bar */}
      {credit.creditLimit > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500 mb-2">
            <span>Credit utilization</span>
            <span className={`px-2 py-0.5 rounded border text-xs ${utilColor}`}>{credit.creditUtilizationPct.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
            <div
              className={
                credit.creditUtilizationPct >= 90 ? 'h-full bg-red-500' :
                credit.creditUtilizationPct >= 70 ? 'h-full bg-amber-500' :
                'h-full bg-emerald-500'
              }
              style={{ width: `${Math.min(100, credit.creditUtilizationPct)}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-slate-500 mt-1">
            <span>Used: TZS {fmt(credit.totalReceivable)}</span>
            <span>Limit: TZS {fmt(credit.creditLimit)}</span>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent orders */}
        <Card className="lg:col-span-2 overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Recent Orders</h3>
            <span className="text-xs text-slate-500">last 10</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Order</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Salesperson</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Total</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Outstanding</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map(o => (
                  <tr key={o.id} className="border-b border-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">{o.salesOrderNumber}</td>
                    <td className="px-3 py-2 text-xs">{new Date(o.orderDate).toLocaleDateString('en-GB')}</td>
                    <td className="px-3 py-2 text-xs">{o.salesperson?.fullName ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(o.totalAmount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(o.outstandingAmount) > 0 ? fmt(o.outstandingAmount) : '—'}</td>
                    <td className="px-3 py-2"><StatusBadge status={o.status} /></td>
                  </tr>
                ))}
                {recentOrders.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-6 text-sm text-slate-400 italic">No orders yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Top products */}
        <Card className="overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Top SKUs</h3>
            <span className="text-xs text-slate-500">last 90 days</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {topProducts.map((p, i) => (
              <li key={p.productId} className="px-4 py-3 flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.productName}</div>
                  {p.sku && <div className="text-[11px] font-mono text-slate-400">{p.sku}</div>}
                </div>
                <div className="text-right">
                  <div className="text-sm tabular-nums">TZS {fmt(p.totalSpend)}</div>
                  <div className="text-[11px] text-slate-500">{p.totalQuantity.toFixed(0)} units</div>
                </div>
              </li>
            ))}
            {topProducts.length === 0 && (
              <li className="px-4 py-6 text-sm text-slate-400 italic text-center">No purchases in the last 90 days.</li>
            )}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent payments */}
        <Card className="lg:col-span-2 overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Recent Payments</h3>
            <span className="text-xs text-slate-500">last 10 settled receivables</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Receivable</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Settled</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Amount</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Paid</th>
                </tr>
              </thead>
              <tbody>
                {recentPayments.map(p => (
                  <tr key={p.id} className="border-b border-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">{p.receivableNumber}</td>
                    <td className="px-3 py-2 text-xs">{new Date(p.updatedAt).toLocaleDateString('en-GB')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(p.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-700">{fmt(p.paidAmount)}</td>
                  </tr>
                ))}
                {recentPayments.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-6 text-sm text-slate-400 italic">No settled payments yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Sidebar: contact + preferred salesperson */}
        <Card className="p-4 space-y-4 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Contact</div>
            <div className="space-y-1">
              <Detail label="Phone" value={customer.phone ?? '—'} />
              <Detail label="Email" value={customer.email ?? '—'} />
              <Detail label="Address" value={customer.address ?? '—'} />
              <Detail label="Contact" value={customer.contactPerson ?? '—'} />
              <Detail label="Terms" value={customer.paymentTerms ?? '—'} />
            </div>
          </div>
          <div className="border-t border-slate-100 pt-3">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Preferred Salesperson</div>
            {preferredSalesperson ? (
              <div className="text-sm font-medium">{preferredSalesperson.fullName ?? preferredSalesperson.employeeCode}</div>
            ) : (
              <div className="text-sm text-slate-400 italic">Not enough recent orders</div>
            )}
          </div>
          <div className="border-t border-slate-100 pt-3">
            <Link href={`/operations/sales-orders?customerId=${customer.id}`} className="text-brand-600 hover:underline text-sm">View all orders →</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'warn' | 'danger' }) {
  const accent =
    tone === 'danger' ? 'bg-red-50 border-red-200' :
    tone === 'warn' ? 'bg-amber-50 border-amber-200' :
    tone === 'good' ? 'bg-emerald-50 border-emerald-200' :
    '';
  return (
    <Card className={`p-3 ${accent}`}>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
      {hint && <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>}
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm text-right truncate">{value}</span>
    </div>
  );
}
