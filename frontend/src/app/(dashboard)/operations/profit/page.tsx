'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Btn, Card, FormInput, FormSelect, PageHeader, PageSpinner, StatCard } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useOrgScope } from '@/hooks/use-org-scope';
import { backendGet, backendPatch, backendPost } from '@/lib/api-client';

interface ProfitSummary {
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  costGaps: number;
  linesMissingCost?: number;
  revenueMissingCost?: number;
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
  hasMissingCost?: boolean;
}

interface CostGapRow {
  type: string;
  productId: string;
  productCode?: string | null;
  productName: string;
  company?: { id?: string | null; name?: string | null; code?: string | null } | null;
  division?: { id?: string | null; name?: string | null; code?: string | null } | null;
  branch?: { id?: string | null; name?: string | null; code?: string | null } | null;
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

interface BelowCostAttemptRow {
  id: string;
  createdAt: string;
  company?: { name?: string | null; code?: string | null } | null;
  user?: { fullName?: string | null; email?: string | null } | null;
  source?: string;
  referenceType?: string;
  referenceId?: string;
  message?: string;
}

interface ExportPayload {
  fileName: string;
  format: string;
  contentType?: string;
  content?: string;
  rows?: Array<Record<string, unknown>>;
}

interface BackfillResult {
  scanned: number;
  updated: number;
  skipped: number;
  skippedSamples: Array<{ salesOrderNumber: string; productName: string; reason: string }>;
}

function unwrapNested<T>(payload: unknown): T {
  if (
    payload &&
    typeof payload === 'object' &&
    'data' in payload &&
    ('success' in payload || 'timestamp' in payload)
  ) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function safeRows<T>(rows: T[] | null | undefined): T[] {
  return Array.isArray(rows) ? rows : [];
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
  const canManageCosts = hasPermission('profit.manage_costs');
  const canAudit = hasPermission('profit.audit') || hasPermission('profit.view');
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
  const [attempts, setAttempts] = useState<BelowCostAttemptRow[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductProfitRow | null>(null);
  const [costFix, setCostFix] = useState<{
    productId: string;
    productName: string;
    branchId: string;
    defaultPurchasePrice: string;
    averageCost: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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
    setNotice('');
    try {
      const [summaryPayload, gapsPayload, attemptsPayload] = await Promise.all([
        backendGet<unknown>('/profit/product-summary', {
          query,
        }),
        backendGet<unknown>('/profit/cost-gaps', { query }),
        canAudit
          ? backendGet<unknown>('/profit/below-cost-attempts', {
              query: { ...query, limit: 10 },
            })
          : Promise.resolve({ rows: [], total: 0 }),
      ]);
      const summaryResult = unwrapNested<{ summary?: ProfitSummary; products?: ProductProfitRow[] }>(summaryPayload);
      const gapsResult = unwrapNested<{ rows?: CostGapRow[]; total?: number }>(gapsPayload);
      const attemptsResult = unwrapNested<{ rows?: BelowCostAttemptRow[]; total?: number }>(attemptsPayload);
      setSummary(summaryResult.summary ?? null);
      setProducts(safeRows(summaryResult.products));
      setGaps(safeRows(gapsResult.rows));
      setAttempts(safeRows(attemptsResult.rows));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profit module');
    } finally {
      setLoading(false);
    }
  }, [canAudit, canView, query]);

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
    backendGet<unknown>(`/profit/products/${selectedProduct.productId}/ledger`, { query })
      .then((payload) => {
        if (!cancelled) setLedger(safeRows(unwrapNested<LedgerRow[]>(payload)));
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

  const downloadExport = async (report: 'product-summary' | 'cost-gaps' | 'below-cost-attempts') => {
    setActionLoading(true);
    setError('');
    setNotice('');
    try {
      const payload = unwrapNested<ExportPayload>(await backendGet<unknown>('/profit/export', {
        query: { ...query, report, format: 'csv' },
      }));
      const content = payload.content ?? '';
      const blob = new Blob([content], { type: payload.contentType ?? 'text/csv' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = payload.fileName || `${report}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice(`${payload.fileName || report} exported.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export profit report');
    } finally {
      setActionLoading(false);
    }
  };

  const runBackfill = async () => {
    setActionLoading(true);
    setError('');
    setNotice('');
    try {
      const result = unwrapNested<BackfillResult>(
        await backendPost<unknown>('/profit/backfill-sales', undefined, { query }),
      );
      setNotice(
        `Backfill scanned ${result.scanned} lines, updated ${result.updated}, skipped ${result.skipped}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to backfill profit snapshots');
    } finally {
      setActionLoading(false);
    }
  };

  const startCostFix = (row: CostGapRow) => {
    setCostFix({
      productId: row.productId,
      productName: row.productName,
      branchId: row.branch?.id ?? '',
      defaultPurchasePrice:
        row.defaultPurchasePrice && row.defaultPurchasePrice > 0 ? String(row.defaultPurchasePrice) : '',
      averageCost: row.averageCost && row.averageCost > 0 ? String(row.averageCost) : '',
    });
    setNotice('');
    setError('');
  };

  const saveCostFix = async () => {
    if (!costFix) return;
    setActionLoading(true);
    setError('');
    setNotice('');
    try {
      await backendPatch(`/profit/products/${costFix.productId}/cost`, {
        defaultPurchasePrice: costFix.defaultPurchasePrice || undefined,
        branchId: costFix.branchId || undefined,
        averageCost: costFix.branchId ? costFix.averageCost || undefined : undefined,
      });
      setNotice(`Cost updated for ${costFix.productName}.`);
      setCostFix(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update cost');
    } finally {
      setActionLoading(false);
    }
  };

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

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Profit controls</h2>
            <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Export profitability, backfill historical COGS snapshots, and resolve blocked cost gaps.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn
              variant="secondary"
              size="sm"
              disabled={actionLoading}
              onClick={() => void downloadExport('product-summary')}
            >
              Export Profitability
            </Btn>
            <Btn
              variant="secondary"
              size="sm"
              disabled={actionLoading}
              onClick={() => void downloadExport('cost-gaps')}
            >
              Export Cost Gaps
            </Btn>
            {canAudit && (
              <Btn
                variant="secondary"
                size="sm"
                disabled={actionLoading}
                onClick={() => void downloadExport('below-cost-attempts')}
              >
                Export Audit
              </Btn>
            )}
            {canManageCosts && (
              <Btn size="sm" disabled={actionLoading} onClick={() => void runBackfill()}>
                Backfill COGS
              </Btn>
            )}
          </div>
        </div>
      </Card>

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
        >
          {notice}
        </div>
      )}

      {costFix && (
        <Card>
          <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-end">
            <div>
              <div className="mb-2 block text-xs font-semibold uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                Fix Cost Gap
              </div>
              <div className="font-medium">{costFix.productName}</div>
              <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                Positive costs are required before this stock item can be sold.
              </div>
            </div>
            <FormInput
              label="Default Purchase Cost"
              type="number"
              min="0"
              step="0.01"
              value={costFix.defaultPurchasePrice}
              onChange={(event) =>
                setCostFix((current) =>
                  current ? { ...current, defaultPurchasePrice: event.target.value } : current,
                )
              }
            />
            <FormInput
              label="Branch Average Cost"
              type="number"
              min="0"
              step="0.0001"
              value={costFix.averageCost}
              disabled={!costFix.branchId}
              onChange={(event) =>
                setCostFix((current) =>
                  current ? { ...current, averageCost: event.target.value } : current,
                )
              }
            />
            <div className="flex gap-2">
              <Btn variant="secondary" disabled={actionLoading} onClick={() => setCostFix(null)}>
                Cancel
              </Btn>
              <Btn disabled={actionLoading} onClick={() => void saveCostFix()}>
                Save Cost
              </Btn>
            </div>
          </div>
        </Card>
      )}

      {loading ? (
        <PageSpinner />
      ) : (
        <>
          {(summary?.linesMissingCost ?? 0) > 0 && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            >
              <strong>Gross profit may be overstated.</strong>{' '}
              {summary?.linesMissingCost} sales line
              {(summary?.linesMissingCost ?? 0) === 1 ? '' : 's'} ({fmtMoney(summary?.revenueMissingCost)}{' '}
              revenue) have no recorded cost, so their cost is counted as zero. Resolve the cost gaps
              below for an accurate figure.
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-5">
            <StatCard
              label="Revenue"
              value={fmtMoney(summary?.revenue)}
              hint={
                (summary?.linesMissingCost ?? 0) > 0
                  ? `${summary?.linesMissingCost} line(s) without cost`
                  : undefined
              }
              countUp={false}
            />
            <StatCard label="COGS" value={fmtMoney(summary?.cogs)} countUp={false} />
            <StatCard
              label="Gross Profit"
              value={fmtMoney(summary?.grossProfit)}
              variant={(summary?.grossProfit ?? 0) >= 0 ? 'green' : 'red'}
              hint={(summary?.linesMissingCost ?? 0) > 0 ? 'May be overstated' : undefined}
              countUp={false}
            />
            <StatCard
              label="Gross Margin"
              value={`${fmtNumber(summary?.grossMarginPct)}%`}
              variant={(summary?.grossMarginPct ?? 0) >= 0 ? 'green' : 'red'}
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
                <caption className="sr-only">Product profitability</caption>
                <thead style={{ background: 'var(--aurora-bg-subtle)' }}>
                  <tr className="text-left text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                    <th scope="col" className="px-4 py-3">Product</th>
                    <th scope="col" className="px-4 py-3 text-right">Qty</th>
                    <th scope="col" className="px-4 py-3 text-right">Revenue</th>
                    <th scope="col" className="px-4 py-3 text-right">COGS</th>
                    <th scope="col" className="px-4 py-3 text-right">Profit</th>
                    <th scope="col" className="px-4 py-3 text-right">Margin</th>
                    <th scope="col" className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={7}>
                        No confirmed sales in this filter.
                      </td>
                    </tr>
                  ) : (
                    products.map((row) => (
                      <tr key={row.productId} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{row.productName}</div>
                          <div className="text-xs text-slate-500">{row.productCode ?? '-'}</div>
                          {row.hasMissingCost && (
                            <span className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                              cost missing
                            </span>
                          )}
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
                          <Btn
                            variant="secondary"
                            size="xs"
                            aria-label={`Drilldown into ${row.productName}`}
                            aria-expanded={selectedProduct?.productId === row.productId}
                            aria-controls="profit-product-ledger"
                            onClick={() => setSelectedProduct(row)}
                          >
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
            <div id="profit-product-ledger">
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
                    <caption className="sr-only">{`${selectedProduct.productName} sales ledger`}</caption>
                    <thead style={{ background: 'var(--aurora-bg-subtle)' }}>
                      <tr className="text-left text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                        <th scope="col" className="px-4 py-3">Order</th>
                        <th scope="col" className="px-4 py-3">Customer</th>
                        <th scope="col" className="px-4 py-3 text-right">Qty</th>
                        <th scope="col" className="px-4 py-3 text-right">Price</th>
                        <th scope="col" className="px-4 py-3 text-right">Cost</th>
                        <th scope="col" className="px-4 py-3 text-right">Profit</th>
                        <th scope="col" className="px-4 py-3">Source</th>
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
            </div>
          )}

          <Card padding="none" className="overflow-hidden">
            <div className="border-b px-4 py-3" style={{ borderColor: 'var(--aurora-border)' }}>
              <h2 className="text-sm font-semibold">Cost gaps blocking sales</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Cost gaps blocking sales</caption>
                <thead style={{ background: 'var(--aurora-bg-subtle)' }}>
                  <tr className="text-left text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                    <th scope="col" className="px-4 py-3">Product</th>
                    <th scope="col" className="px-4 py-3">Scope</th>
                    <th scope="col" className="px-4 py-3 text-right">Qty</th>
                    <th scope="col" className="px-4 py-3 text-right">Avg Cost</th>
                    <th scope="col" className="px-4 py-3 text-right">Default Cost</th>
                    <th scope="col" className="px-4 py-3">Issue</th>
                    <th scope="col" className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {gaps.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={7}>
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
                        <td className="px-4 py-3 text-right">
                          {canManageCosts ? (
                            <Btn
                              variant="secondary"
                              size="xs"
                              aria-label={`Fix cost for ${row.productName}`}
                              onClick={() => startCostFix(row)}
                            >
                              Fix Cost
                            </Btn>
                          ) : (
                            <span className="text-xs text-slate-500">Restricted</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {canAudit && (
            <Card padding="none" className="overflow-hidden">
              <div className="border-b px-4 py-3" style={{ borderColor: 'var(--aurora-border)' }}>
                <h2 className="text-sm font-semibold">Below-cost attempt audit</h2>
                <p className="text-xs text-slate-500">Recent blocked sales caused by missing cost or net price at/below cost.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Below-cost attempt audit</caption>
                  <thead style={{ background: 'var(--aurora-bg-subtle)' }}>
                    <tr className="text-left text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                      <th scope="col" className="px-4 py-3">Time</th>
                      <th scope="col" className="px-4 py-3">User</th>
                      <th scope="col" className="px-4 py-3">Source</th>
                      <th scope="col" className="px-4 py-3">Company</th>
                      <th scope="col" className="px-4 py-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.length === 0 ? (
                      <tr>
                        <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={5}>
                          No blocked below-cost attempts in this filter.
                        </td>
                      </tr>
                    ) : (
                      attempts.map((row) => (
                        <tr key={row.id} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {new Date(row.createdAt).toLocaleString('en-GB')}
                          </td>
                          <td className="px-4 py-3">{row.user?.fullName ?? row.user?.email ?? '-'}</td>
                          <td className="px-4 py-3">{row.source ?? '-'}</td>
                          <td className="px-4 py-3">{row.company?.code ?? row.company?.name ?? '-'}</td>
                          <td className="px-4 py-3 text-red-600">{row.message ?? '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
