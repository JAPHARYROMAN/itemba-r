'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card,
  PageHeader,
  StatCard,
  SkeletonTable,
  EmptyState,
  showToast,
  scopeToQueryString,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendGet, backendList, backendPage } from '@/lib/api-client';
import { useInventoryWorkspace } from '@/features/inventory/inventory-workspace-context';
import { toFiniteNumber } from '@/lib/design-system/formatters';
import { rowsToCsv, downloadTextFile } from '@/lib/report-export';
import { downloadTablePdf } from '@/lib/export-download';

interface Company {
  id: string;
  name: string;
  code: string;
}
interface LiveTotals {
  totalSkus: number;
  out: number;
  low: number;
  negative: number;
  totalValue: number;
}
interface RecentMovement {
  id: string;
  movementNumber?: string;
  movementDate: string;
  movementType: string;
  quantity: number;
  product?: { name: string; productCode?: string | null } | null;
}

const INBOUND = new Set([
  'OPENING_STOCK',
  'PURCHASE_RECEIPT',
  'SALES_RETURN',
  'TRANSFER_IN',
  'ADJUSTMENT_IN',
  'PRODUCTION_IN',
]);

function fmtNum(n: number | string | null | undefined) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(toFiniteNumber(n));
}
function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const LINKS: Array<{ href: string; label: string; desc: string; perm: string }> = [
  {
    href: '/inventory?tab=stock&view=balances',
    label: 'Balances',
    desc: 'Stock on hand by product & branch',
    perm: 'inventory.view',
  },
  {
    href: '/inventory?tab=stock&view=movements',
    label: 'Movements',
    desc: 'The stock ledger',
    perm: 'inventory.movements.view',
  },
  {
    href: '/inventory?tab=controls&view=adjustments',
    label: 'Stock Adjustments',
    desc: 'Counts & corrections',
    perm: 'inventory.adjustments.create',
  },
  {
    href: '/inventory?tab=catalog&view=products',
    label: 'Products',
    desc: 'Item catalog',
    perm: 'products.view',
  },
  {
    href: '/inventory?tab=catalog&view=categories',
    label: 'Categories',
    desc: 'Catalog taxonomy',
    perm: 'product_categories.view',
  },
  {
    href: '/inventory?tab=catalog&view=units',
    label: 'Units of Measure',
    desc: 'Units & conversions',
    perm: 'units.view',
  },
];

export default function InventoryOverviewPage() {
  const { hasPermission } = useAuth();
  const workspace = useInventoryWorkspace();
  const canView = hasPermission('inventory.view');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [totals, setTotals] = useState<LiveTotals | null>(null);
  const [pending, setPending] = useState(0);
  const [recent, setRecent] = useState<RecentMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const workspaceCompanyId = workspace?.scope.companyId;
  const divisionId = workspace?.scope.divisionId ?? '';
  const branchId = workspace?.scope.branchId ?? '';

  useEffect(() => {
    if (workspaceCompanyId === undefined) return;
    setCompanyId(workspaceCompanyId);
  }, [workspaceCompanyId]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    backendList<Company>('/companies', { query: { limit: 100 } })
      .then((rows) => {
        if (cancelled) return;
        setCompanies(rows);
        if (rows.length === 1) setCompanyId(rows[0].id);
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canView]);

  const load = useCallback(async () => {
    if (!canView || !companyId) return;
    setLoading(true);
    const [live, adj, mov] = await Promise.allSettled([
      backendGet<{ totals: LiveTotals }>('/inventory-balances/live', {
        query: {
          companyId,
          divisionId: divisionId || undefined,
          branchId: branchId || undefined,
        },
      }),
      backendPage<unknown>('/stock-adjustments', {
        query: {
          companyId,
          divisionId: divisionId || undefined,
          branchId: branchId || undefined,
          status: 'PENDING_APPROVAL',
          limit: 1,
        },
      }),
      backendPage<RecentMovement>('/inventory-movements', {
        query: {
          companyId,
          divisionId: divisionId || undefined,
          branchId: branchId || undefined,
          limit: 6,
        },
      }),
    ]);
    setTotals(live.status === 'fulfilled' ? (live.value?.totals ?? null) : null);
    setPending(adj.status === 'fulfilled' ? (adj.value?.total ?? 0) : 0);
    setRecent(mov.status === 'fulfilled' ? (mov.value?.data ?? []) : []);
    setLoading(false);
  }, [branchId, canView, companyId, divisionId]);

  useEffect(() => {
    load();
  }, [load]);

  const buildExportRows = useCallback(
    () =>
      recent.map((m) => ({
        date: fmtDate(m.movementDate),
        product: m.product ? `${m.product.productCode ?? ''} ${m.product.name}`.trim() : '',
        type: m.movementType.replace(/_/g, ' '),
        quantity: (INBOUND.has(m.movementType) ? 1 : -1) * toFiniteNumber(m.quantity),
      })),
    [recent],
  );

  const exportRecent = useCallback(() => {
    if (!recent.length) return;
    const csv = rowsToCsv(buildExportRows(), ['date', 'product', 'type', 'quantity']);
    downloadTextFile(
      `recent-movements-${new Date().toISOString().slice(0, 10)}.csv`,
      'text/csv;charset=utf-8',
      csv,
    );
  }, [recent, buildExportRows]);

  const exportRecentPdf = useCallback(async () => {
    if (!recent.length || exportingPdf) return;
    setExportingPdf(true);
    try {
      const companyName = companies.find((c) => c.id === companyId)?.name;
      const scopeLabels = [
        companyName,
        divisionId ? 'Selected division' : '',
        branchId ? 'Selected branch' : '',
      ]
        .filter(Boolean)
        .join(' · ');
      await downloadTablePdf({
        title: 'Inventory Overview',
        subtitle: scopeLabels ? `Recent movements · ${scopeLabels}` : 'Recent movements',
        companyId: companyId || undefined,
        columns: ['Date', 'Product', 'Type', 'Quantity'],
        rows: buildExportRows().map((r) => [r.date, r.product, r.type, String(r.quantity)]),
        numericColumns: [3],
        baseName: 'recent-movements',
      });
    } catch (e) {
      showToast('error', 'Could not export PDF', e instanceof Error ? e.message : undefined);
    } finally {
      setExportingPdf(false);
    }
  }, [branchId, recent, exportingPdf, companies, companyId, divisionId, buildExportRows]);

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Inventory Overview" subtitle="At-a-glance stock health" />
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">Access Restricted</p>
        </div>
      </div>
    );
  }

  const scopeQuery = scopeToQueryString({ companyId, divisionId, branchId });
  const withScope = (href: string) => `${href}${scopeQuery ? `&${scopeQuery}` : ''}`;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Inventory Overview"
        subtitle="At-a-glance stock health and recent activity"
      />

      {!workspace && (
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          aria-label="Company"
          className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
          style={{
            borderColor: 'var(--aurora-border)',
            background: 'var(--aurora-card)',
            color: 'var(--aurora-text)',
          }}
        >
          <option value="">Select Company…</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}

      {!companyId ? (
        <Card className="p-8 text-center text-sm">
          <span style={{ color: 'var(--aurora-text-muted)' }}>
            Select a company to see its inventory health.
          </span>
        </Card>
      ) : loading && !totals ? (
        <SkeletonTable rows={6} cols={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Link href={withScope('/inventory?tab=stock&view=balances')}>
              <StatCard label="Stock Value" value={'TZS ' + fmtNum(totals?.totalValue ?? 0)} />
            </Link>
            <Link href={withScope('/inventory?tab=stock&view=balances&lowStock=1')}>
              <StatCard
                label="Low Stock"
                value={totals?.low ?? 0}
                variant={(totals?.low ?? 0) > 0 ? 'amber' : 'green'}
              />
            </Link>
            <Link href={withScope('/inventory?tab=stock&view=balances')}>
              <StatCard
                label="Out of Stock"
                value={totals?.out ?? 0}
                variant={(totals?.out ?? 0) > 0 ? 'red' : 'green'}
              />
            </Link>
            <Link href={withScope('/inventory?tab=controls&view=adjustments')}>
              <StatCard
                label="Pending Adjustments"
                value={pending}
                variant={pending > 0 ? 'amber' : 'green'}
              />
            </Link>
          </div>

          <Card className="overflow-hidden">
            <div
              className="px-5 py-3 border-b flex items-center justify-between"
              style={{ borderColor: 'var(--aurora-border)' }}
            >
              <h2 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Recent movements
              </h2>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={exportRecent}
                  disabled={!recent.length}
                  className="text-xs text-blue-600 hover:underline disabled:opacity-40 disabled:hover:no-underline"
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={exportRecentPdf}
                  disabled={!recent.length || exportingPdf}
                  className="text-xs text-blue-600 hover:underline disabled:opacity-40 disabled:hover:no-underline"
                >
                  {exportingPdf ? 'Exporting…' : 'Export PDF'}
                </button>
                <Link
                  href={withScope('/inventory?tab=stock&view=movements')}
                  className="text-xs text-blue-600 hover:underline"
                >
                  View all
                </Link>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Recent inventory movements</caption>
                <thead>
                  <tr
                    className="text-left text-xs uppercase bg-gray-50"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    <th scope="col" className="px-4 py-3">
                      Date
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Product
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Type
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Qty
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recent.length === 0 ? (
                    <tr>
                      <td colSpan={4}>
                        <EmptyState
                          title="No recent movements"
                          description="Stock movements for the selected scope will appear here."
                        />
                      </td>
                    </tr>
                  ) : (
                    recent.map((m) => {
                      const inbound = INBOUND.has(m.movementType);
                      return (
                        <tr key={m.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">{fmtDate(m.movementDate)}</td>
                          <td className="px-4 py-3">
                            {m.product ? (
                              <>
                                <span className="font-mono text-xs text-slate-500">
                                  {m.product.productCode}
                                </span>{' '}
                                {m.product.name}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs">{m.movementType.replace(/_/g, ' ')}</td>
                          <td
                            className={`px-4 py-3 text-right font-mono ${
                              inbound ? 'text-emerald-600' : 'text-red-600'
                            }`}
                          >
                            {inbound ? '+' : '−'}
                            {fmtNum(m.quantity)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {LINKS.filter((l) => hasPermission(l.perm)).map((l) => (
              <Link key={l.href} href={withScope(l.href)}>
                <Card className="p-4 hover:shadow-md transition-shadow">
                  <div className="font-medium text-sm" style={{ color: 'var(--aurora-text)' }}>
                    {l.label}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>
                    {l.desc}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
