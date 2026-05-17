'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader, StatCard, Btn, PageSpinner } from '@/components/ui';
import { backendGet, backendList } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

interface Company {
  id: string;
  name: string;
  code: string;
}
interface StockValuationRow {
  productCode: string;
  productName: string;
  location: string;
  quantityOnHand: number;
  averageCost: number;
  totalValue: number;
}
interface SalesSummary {
  totalSalesOrders: number;
  totalSalesValue: number;
  totalPaid: number;
  totalOutstanding: number;
  byType: { salesType: string; count: number; value: number }[];
}
interface PurchaseSummary {
  totalPurchaseOrders: number;
  totalPurchaseValue: number;
  totalPaid: number;
  totalOutstanding: number;
  byType: { purchaseType: string; count: number; value: number }[];
}

type Tab = 'stock-valuation' | 'sales-summary' | 'purchase-summary';

function fmtTZS(n: number) {
  return (
    'TZS ' +
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function normalizeStockRows(payload: unknown): StockValuationRow[] {
  if (Array.isArray(payload)) return payload as StockValuationRow[];
  if (isObject(payload) && Array.isArray(payload.rows)) return payload.rows as StockValuationRow[];
  return [];
}

function normalizeSalesSummary(payload: unknown): SalesSummary | null {
  if (!isObject(payload)) return null;
  return {
    totalSalesOrders: Number(payload.totalSalesOrders ?? 0),
    totalSalesValue: Number(payload.totalSalesValue ?? 0),
    totalPaid: Number(payload.totalPaid ?? 0),
    totalOutstanding: Number(payload.totalOutstanding ?? 0),
    byType: Array.isArray(payload.byType) ? (payload.byType as SalesSummary['byType']) : [],
  };
}

function normalizePurchaseSummary(payload: unknown): PurchaseSummary | null {
  if (!isObject(payload)) return null;
  return {
    totalPurchaseOrders: Number(payload.totalPurchaseOrders ?? 0),
    totalPurchaseValue: Number(payload.totalPurchaseValue ?? 0),
    totalPaid: Number(payload.totalPaid ?? 0),
    totalOutstanding: Number(payload.totalOutstanding ?? 0),
    byType: Array.isArray(payload.byType) ? (payload.byType as PurchaseSummary['byType']) : [],
  };
}

export default function OperationsReportsPage() {
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<Tab>('stock-valuation');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [stockRows, setStockRows] = useState<StockValuationRow[] | null>(null);
  const [salesSummary, setSalesSummary] = useState<SalesSummary | null>(null);
  const [purchaseSummary, setPurchaseSummary] = useState<PurchaseSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canView = hasPermission('operations.reports.view');

  useEffect(() => {
    let cancelled = false;
    backendList<Company>('/companies', { query: { limit: 100 } })
      .then((rows) => {
        if (!cancelled) setCompanies(rows);
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const generate = async () => {
    if (!companyId) {
      setError('Company is required');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const query: Record<string, string> = { companyId };
      if (tab === 'stock-valuation') {
        const payload = await backendGet<unknown>('/operations-reports/stock-valuation', { query });
        setStockRows(normalizeStockRows(payload));
      } else if (tab === 'sales-summary') {
        if (dateFrom) query.dateFrom = dateFrom;
        if (dateTo) query.dateTo = dateTo;
        const payload = await backendGet<unknown>('/operations-reports/sales-summary', { query });
        setSalesSummary(normalizeSalesSummary(payload));
      } else {
        if (dateFrom) query.dateFrom = dateFrom;
        if (dateTo) query.dateTo = dateTo;
        const payload = await backendGet<unknown>('/operations-reports/purchase-summary', {
          query,
        });
        setPurchaseSummary(normalizePurchaseSummary(payload));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Operations Reports" subtitle="Operational analytics" />
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">Access Restricted</p>
        </div>
      </div>
    );
  }

  const filterSelectCls =
    'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = {
    borderColor: 'var(--aurora-border)',
    background: 'var(--aurora-card)',
    color: 'var(--aurora-text)',
  } as const;

  const stockTotal = stockRows?.reduce((acc, r) => acc + r.totalValue, 0) ?? 0;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'stock-valuation', label: 'Stock Valuation' },
    { id: 'sales-summary', label: 'Sales Summary' },
    { id: 'purchase-summary', label: 'Purchase Summary' },
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Operations Reports" subtitle="Stock, sales, and purchase analytics" />

      <Card className="p-1">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                setError('');
              }}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === t.id ? 'bg-brand-600 text-white' : 'hover:bg-slate-100'}`}
              style={tab !== t.id ? { color: 'var(--aurora-text)' } : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--aurora-text-muted)' }}>
              Company *
            </label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">Select company…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {(tab === 'sales-summary' || tab === 'purchase-summary') && (
            <>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--aurora-text-muted)' }}>
                  From
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className={filterSelectCls}
                  style={filterStyle}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--aurora-text-muted)' }}>
                  To
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className={filterSelectCls}
                  style={filterStyle}
                />
              </div>
            </>
          )}
          <Btn variant="primary" onClick={generate} loading={loading}>
            Generate Report
          </Btn>
        </div>
        {error && (
          <div
            role="alert"
            className="mt-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2"
          >
            {error}
          </div>
        )}
      </Card>

      {loading ? (
        <Card className="p-10">
          <PageSpinner />
        </Card>
      ) : tab === 'stock-valuation' && stockRows ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr
                  className="text-left text-xs uppercase bg-gray-50"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  <th className="px-4 py-3">Product Code</th>
                  <th className="px-4 py-3">Product Name</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3 text-right">Quantity</th>
                  <th className="px-4 py-3 text-right">Avg Cost</th>
                  <th className="px-4 py-3 text-right">Total Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!stockRows.length ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-10 text-center text-sm"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      No data
                    </td>
                  </tr>
                ) : (
                  stockRows.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs">{r.productCode}</td>
                      <td className="px-4 py-3 font-medium">{r.productName}</td>
                      <td className="px-4 py-3 text-xs">{r.location}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.quantityOnHand}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtTZS(r.averageCost)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        {fmtTZS(r.totalValue)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {stockRows.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-50 font-semibold">
                    <td colSpan={5} className="px-4 py-3 text-right">
                      Grand Total
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtTZS(stockTotal)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      ) : tab === 'sales-summary' && salesSummary ? (
        <>
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="Total Orders" value={salesSummary.totalSalesOrders} />
            <StatCard label="Total Value" value={fmtTZS(salesSummary.totalSalesValue)} />
            <StatCard label="Total Paid" value={fmtTZS(salesSummary.totalPaid)} />
            <StatCard label="Outstanding" value={fmtTZS(salesSummary.totalOutstanding)} />
          </div>
          <Card className="overflow-hidden">
            <div
              className="px-5 py-3 border-b font-semibold"
              style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
            >
              By Sales Type
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-xs uppercase bg-gray-50"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  <th className="px-4 py-3">Sales Type</th>
                  <th className="px-4 py-3 text-right">Count</th>
                  <th className="px-4 py-3 text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!salesSummary.byType.length ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-4 py-10 text-center text-sm"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      No data
                    </td>
                  </tr>
                ) : (
                  salesSummary.byType.map((row) => (
                    <tr key={row.salesType} className="hover:bg-slate-50">
                      <td className="px-4 py-3">{row.salesType.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.count}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtTZS(row.value)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
        </>
      ) : tab === 'purchase-summary' && purchaseSummary ? (
        <>
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="Total Orders" value={purchaseSummary.totalPurchaseOrders} />
            <StatCard label="Total Value" value={fmtTZS(purchaseSummary.totalPurchaseValue)} />
            <StatCard label="Total Paid" value={fmtTZS(purchaseSummary.totalPaid)} />
            <StatCard label="Outstanding" value={fmtTZS(purchaseSummary.totalOutstanding)} />
          </div>
          <Card className="overflow-hidden">
            <div
              className="px-5 py-3 border-b font-semibold"
              style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
            >
              By Purchase Type
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-xs uppercase bg-gray-50"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  <th className="px-4 py-3">Purchase Type</th>
                  <th className="px-4 py-3 text-right">Count</th>
                  <th className="px-4 py-3 text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!purchaseSummary.byType.length ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-4 py-10 text-center text-sm"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      No data
                    </td>
                  </tr>
                ) : (
                  purchaseSummary.byType.map((row) => (
                    <tr key={row.purchaseType} className="hover:bg-slate-50">
                      <td className="px-4 py-3">{row.purchaseType.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.count}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtTZS(row.value)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
        </>
      ) : (
        <Card className="p-10 text-center text-sm">
          <span style={{ color: 'var(--aurora-text-muted)' }}>
            Select filters and click Generate Report to view data.
          </span>
        </Card>
      )}
    </div>
  );
}
