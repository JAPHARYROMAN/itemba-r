'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Btn, Card, FormInput, FormSelect, PageHeader, PageSpinner, StatCard } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useOrgScope } from '@/hooks/use-org-scope';
import { backendGet } from '@/lib/api-client';

interface ProfitSummary {
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  costGaps: number;
}

interface ProductProfitRow {
  productId: string;
  productCode?: string | null;
  productName: string;
  quantity: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  salesCount: number;
}

interface CostGapRow {
  type: string;
  productId: string;
  productCode?: string | null;
  productName: string;
  company?: { name?: string | null; code?: string | null } | null;
  division?: { name?: string | null; code?: string | null } | null;
  branch?: { name?: string | null; code?: string | null } | null;
  quantityOnHand?: number | null;
  averageCost?: number | null;
  defaultPurchasePrice?: number | null;
  message: string;
}

interface LedgerRow {
  salesOrderId: string;
  salesOrderNumber: string;
  orderDate: string;
  customerName?: string | null;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  unitCostAtSale?: number | null;
  cogsAmount: number;
  grossProfitAmount: number;
  grossMarginPct?: number | null;
  profitCostSource?: string | null;
}

function fmtMoney(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return `TZS ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(parsed) ? parsed : 0)}`;
}

function fmtNumber(value: number | string | null | undefined, decimals = 2) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number.isFinite(parsed) ? parsed : 0);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIso() {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().slice(0, 10);
}

export default function OperationsProfitPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const canView = hasPermission('profit.view') || hasPermission('operations.reports.view');
  const [companyId, setCompanyId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [dateFrom, setDateFrom] = useState(monthStartIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const { companyOptions, divisionOptions, branchOptions, loading: scopeLoading } = useOrgScope(
    companyId,
    { skipEmployees: true },
  );

  const [summary, setSummary] = useState<ProfitSummary | null>(null);
  const [products, setProducts] = useState<ProductProfitRow[]>([]);
  const [gaps, setGaps] = useState<CostGapRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductProfitRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [error, setError] = useState('');

  const query = useMemo(
    () => ({
      companyId,
      divisionId,
      branchId,
      dateFrom,
      dateTo,
    }),
    [branchId, companyId, dateFrom, dateTo, divisionId],
  );

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const [summaryPayload, gapsPayload] = await Promise.all([
        backendGet<{ summary: ProfitSummary; products: ProductProfitRow[] }>('/profit/product-summary', {
          query,
        }),
        backendGet<{ rows: CostGapRow[]; total: number }>('/profit/cost-gaps', { query }),
      ]);
      setSummary(summaryPayload.summary);
      setProducts(summaryPayload.products);
      setGaps(gapsPayload.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profit module');
    } finally {
      setLoading(false);
    }
  }, [canView, query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedProduct) {
      setLedger([]);
      return;
    }
    let cancelled = false;
    setLedgerLoading(true);
    backendGet<LedgerRow[]>(`/profit/products/${selectedProduct.productId}/ledger`, { query })
      .then((rows) => {
        if (!cancelled) setLedger(rows);
      })
      .catch(() => {
        if (!cancelled) setLedger([]);
      })
      .finally(() => {
        if (!cancelled) setLedgerLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // query fields are intentionally expanded so ledger refreshes with filters.
  }, [query, selectedProduct]);

  if (authLoading || scopeLoading) return <PageSpinner />;
  if (!canView) {
    return (
      <Card>
        <p className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
          You do not have permission to view profit reports.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Profit"
        subtitle="Product profitability, frozen COGS, margin control, and cost gaps."
      />

      <Card>
        <div className="grid gap-3 lg:grid-cols-5">
          <FormSelect
            label="Company"
            value={companyId}
            onChange={(event) => {
              setCompanyId(event.target.value);
              setDivisionId('');
              setBranchId('');
            }}
            placeholder="All companies"
            options={companyOptions}
          />
          <FormSelect
            label="Division"
            value={divisionId}
            onChange={(event) => {
              setDivisionId(event.target.value);
              setBranchId('');
            }}
            placeholder="All divisions"
            options={divisionOptions}
            disabled={!companyId}
          />
          <FormSelect
            label="Branch"
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
            placeholder="All branches"
            options={branchOptions.filter((branch) => {
              if (!divisionId) return true;
              const source = branchOptions.find((candidate) => candidate.value === branch.value);
              return Boolean(source);
            })}
            disabled={!companyId}
          />
          <FormInput
            label="Date From"
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
          <FormInput
            label="Date To"
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <PageSpinner />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Revenue" value={fmtMoney(summary?.revenue)} countUp={false} />
            <StatCard label="COGS" value={fmtMoney(summary?.cogs)} countUp={false} />
            <StatCard
              label="Gross Profit"
              value={fmtMoney(summary?.grossProfit)}
              variant={(summary?.grossProfit ?? 0) >= 0 ? 'green' : 'red'}
              countUp={false}
            />
            <StatCard
              label="Gross Margin"
              value={`${fmtNumber(summary?.grossMarginPct)}%`}
              variant={(summary?.grossMarginPct ?? 0) > 0 ? 'green' : 'red'}
              countUp={false}
            />
            <StatCard
              label="Blocked Cost Gaps"
              value={summary?.costGaps ?? 0}
              variant={(summary?.costGaps ?? 0) > 0 ? 'red' : 'green'}
            />
          </div>

          <Card padding="none" className="overflow-hidden">
            <div className="border-b px-4 py-3" style={{ borderColor: 'var(--aurora-border)' }}>
              <h2 className="text-sm font-semibold">Product profitability</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead style={{ background: 'var(--aurora-bg-subtle)' }}>
                  <tr className="text-left text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Revenue</th>
                    <th className="px-4 py-3 text-right">COGS</th>
                    <th className="px-4 py-3 text-right">Profit</th>
                    <th className="px-4 py-3 text-right">Margin</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={7}>
                        No confirmed sales with profit snapshots in this filter.
                      </td>
                    </tr>
                  ) : (
                    products.map((row) => (
                      <tr key={row.productId} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{row.productName}</div>
                          <div className="text-xs text-slate-500">{row.productCode ?? '-'}</div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtNumber(row.quantity, 4)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(row.revenue)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(row.cogs)}</td>
                        <td
                          className={`px-4 py-3 text-right tabular-nums ${
                            row.grossProfit >= 0 ? 'text-emerald-600' : 'text-red-600'
                          }`}
                        >
                          {fmtMoney(row.grossProfit)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {fmtNumber(row.grossMarginPct)}%
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Btn variant="secondary" size="xs" onClick={() => setSelectedProduct(row)}>
                            Drilldown
                          </Btn>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {selectedProduct && (
            <Card padding="none" className="overflow-hidden">
              <div
                className="flex items-center justify-between border-b px-4 py-3"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <div>
                  <h2 className="text-sm font-semibold">{selectedProduct.productName} ledger</h2>
                  <p className="text-xs text-slate-500">Sales orders, cost source, COGS, and margin.</p>
                </div>
                <Btn variant="ghost" size="xs" onClick={() => setSelectedProduct(null)}>
                  Close
                </Btn>
              </div>
              {ledgerLoading ? (
                <div className="p-4">
                  <PageSpinner />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead style={{ background: 'var(--aurora-bg-subtle)' }}>
                      <tr className="text-left text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                        <th className="px-4 py-3">Order</th>
                        <th className="px-4 py-3">Customer</th>
                        <th className="px-4 py-3 text-right">Qty</th>
                        <th className="px-4 py-3 text-right">Price</th>
                        <th className="px-4 py-3 text-right">Cost</th>
                        <th className="px-4 py-3 text-right">Profit</th>
                        <th className="px-4 py-3">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.map((row) => (
                        <tr key={`${row.salesOrderId}-${row.orderDate}`} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                          <td className="px-4 py-3">
                            <div className="font-medium">{row.salesOrderNumber}</div>
                            <div className="text-xs text-slate-500">
                              {new Date(row.orderDate).toLocaleDateString('en-GB')}
                            </div>
                          </td>
                          <td className="px-4 py-3">{row.customerName ?? 'Walk-in'}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmtNumber(row.quantity, 4)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(row.unitPrice)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(row.unitCostAtSale)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(row.grossProfitAmount)}</td>
                          <td className="px-4 py-3">{row.profitCostSource?.replace(/_/g, ' ') ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          <Card padding="none" className="overflow-hidden">
            <div className="border-b px-4 py-3" style={{ borderColor: 'var(--aurora-border)' }}>
              <h2 className="text-sm font-semibold">Cost gaps blocking sales</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead style={{ background: 'var(--aurora-bg-subtle)' }}>
                  <tr className="text-left text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Scope</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Avg Cost</th>
                    <th className="px-4 py-3 text-right">Default Cost</th>
                    <th className="px-4 py-3">Issue</th>
                  </tr>
                </thead>
                <tbody>
                  {gaps.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={6}>
                        No cost gaps found.
                      </td>
                    </tr>
                  ) : (
                    gaps.map((row, index) => (
                      <tr key={`${row.productId}-${row.type}-${index}`} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{row.productName}</div>
                          <div className="text-xs text-slate-500">{row.productCode ?? '-'}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {row.company?.code ?? row.company?.name ?? 'Company'}
                          {row.division ? ` / ${row.division.code ?? row.division.name}` : ''}
                          {row.branch ? ` / ${row.branch.code ?? row.branch.name}` : ''}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtNumber(row.quantityOnHand, 4)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(row.averageCost)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(row.defaultPurchasePrice)}</td>
                        <td className="px-4 py-3 text-red-600">{row.message}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
