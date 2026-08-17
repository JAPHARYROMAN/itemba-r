'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Btn, Card, EmptyState, PageHeader, PageToolbar, SkeletonTable, StatCard } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendGet, backendList, backendPage } from '@/lib/api-client';
import { useInventoryWorkspace } from '@/features/inventory/inventory-workspace-context';
import { toFiniteNumber } from '@/lib/design-system/formatters';
import { downloadTablePdf } from '@/lib/export-download';
import { cellToString, downloadTextFile, rowsToCsv } from '@/lib/report-export';

interface Company {
  id: string;
  name: string;
  code?: string | null;
}

interface Division {
  id: string;
  name: string;
  code?: string | null;
}

interface Branch {
  id: string;
  name: string;
  code?: string | null;
  divisionId?: string | null;
}

interface ProductCategory {
  id: string;
  name: string;
  categoryType?: string | null;
}

interface ProductFamily {
  id: string;
  name: string;
  brand?: string | null;
  categoryId?: string | null;
}

interface InventoryBalance {
  id: string;
  productId: string;
  branchId?: string | null;
  companyId: string;
  divisionId?: string | null;
  quantityOnHand: number | string;
  quantityReserved: number | string;
  quantityAvailable?: number | string;
  reorderLevel?: number | string | null;
  averageCost: number | string;
  totalValue: number | string;
  lastMovementAt?: string | null;
  stockStatus?: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'OVERSOLD';
  costStatus?: 'HAS_COST' | 'MISSING_COST';
  isStale?: boolean;
  daysSinceMovement?: number | null;
  product?: {
    id: string;
    name: string;
    productCode?: string | null;
    sku?: string | null;
    barcode?: string | null;
    reorderLevel?: number | string | null;
    minimumStockLevel?: number | string | null;
    category?: ProductCategory | null;
    productFamily?: ProductFamily | null;
  } | null;
  branch?: Branch | null;
  division?: Division | null;
  company?: Company | null;
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

interface InventorySummary {
  totalSkus: number;
  totalValue: number;
  outOfStock: number;
  lowStock: number;
  oversold: number;
  missingCost: number;
  staleStock: number;
}

const emptyPaginated = <T,>(page = 1): Paginated<T> => ({
  data: [],
  total: 0,
  page,
  totalPages: 1,
});

const blankSummary = (): InventorySummary => ({
  totalSkus: 0,
  totalValue: 0,
  outOfStock: 0,
  lowStock: 0,
  oversold: 0,
  missingCost: 0,
  staleStock: 0,
});

const tdCls = 'px-4 py-3 text-sm';
const thCls = 'px-4 py-3';
const filterSelectCls =
  'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
const filterStyle = {
  borderColor: 'var(--aurora-border)',
  background: 'var(--aurora-card)',
  color: 'var(--aurora-text)',
} as const;

function fmtNum(n: number | string | null | undefined, decimals = 2) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(toFiniteNumber(n));
}

function fmtTZS(n: number | string | null | undefined) {
  return `TZS ${fmtNum(n)}`;
}

function fmtDate(d?: string | null) {
  if (!d) return 'Never';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function balanceAvailable(balance: InventoryBalance) {
  return toFiniteNumber(
    balance.quantityAvailable ??
      toFiniteNumber(balance.quantityOnHand) - toFiniteNumber(balance.quantityReserved),
  );
}

function stockStatus(balance: InventoryBalance): InventoryBalance['stockStatus'] {
  if (balance.stockStatus) return balance.stockStatus;
  const available = balanceAvailable(balance);
  const onHand = toFiniteNumber(balance.quantityOnHand);
  const reorder = toFiniteNumber(balance.product?.reorderLevel ?? balance.product?.minimumStockLevel ?? 10);
  if (available < 0) return 'OVERSOLD';
  if (onHand <= 0) return 'OUT_OF_STOCK';
  if (onHand <= reorder) return 'LOW_STOCK';
  return 'IN_STOCK';
}

function StockBadge({ balance }: { balance: InventoryBalance }) {
  const status = stockStatus(balance);
  const styles: Record<string, string> = {
    IN_STOCK: 'bg-emerald-100 text-emerald-700',
    LOW_STOCK: 'bg-yellow-100 text-yellow-700',
    OUT_OF_STOCK: 'bg-red-100 text-red-700',
    OVERSOLD: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status ?? 'IN_STOCK']}`}>
      {(status ?? 'IN_STOCK').replace(/_/g, ' ')}
    </span>
  );
}

function CostBadge({ balance }: { balance: InventoryBalance }) {
  const missing = balance.costStatus === 'MISSING_COST' || toFiniteNumber(balance.averageCost) <= 0;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        missing ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
      }`}
    >
      {missing ? 'Missing cost' : 'Has cost'}
    </span>
  );
}

export default function InventoryBalancesPage() {
  const { hasPermission } = useAuth();
  const workspace = useInventoryWorkspace();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [families, setFamilies] = useState<ProductFamily[]>([]);
  const [data, setData] = useState<Paginated<InventoryBalance> | null>(null);
  const [summary, setSummary] = useState<InventorySummary>(blankSummary);
  const [loading, setLoading] = useState(false);
  const [companyId, setCompanyId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [productFamilyId, setProductFamilyId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [stockStatusFilter, setStockStatusFilter] = useState('');
  const [costStatus, setCostStatus] = useState('');
  const [staleDays, setStaleDays] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState<false | 'csv' | 'pdf'>(false);

  const canView = hasPermission('inventory.view');

  useEffect(() => {
    if (!workspace) return;
    setCompanyId(workspace.scope.companyId);
    setDivisionId(workspace.scope.divisionId);
    setBranchId(workspace.scope.branchId);
    setPage(1);
  }, [workspace?.scope.branchId, workspace?.scope.companyId, workspace?.scope.divisionId]);

  const query = useCallback(
    (extra?: Record<string, string | number>) => ({
      companyId: companyId || undefined,
      divisionId: divisionId || undefined,
      branchId: branchId || undefined,
      categoryId: categoryId || undefined,
      productFamilyId: productFamilyId || undefined,
      search: search.trim() || undefined,
      stockStatus: stockStatusFilter || undefined,
      costStatus: costStatus || undefined,
      staleDays: staleDays ? Number(staleDays) : undefined,
      ...extra,
    }),
    [
      companyId,
      divisionId,
      branchId,
      categoryId,
      productFamilyId,
      search,
      stockStatusFilter,
      costStatus,
      staleDays,
    ],
  );

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    backendList<Company>('/companies', { query: { limit: 500 } })
      .then((rows) => {
        if (!cancelled) setCompanies(rows);
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canView]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    const common = { companyId: companyId || undefined, limit: 5000 };
    Promise.all([
      backendList<Division>('/divisions', { query: { companyId: companyId || undefined } }).catch(() => []),
      backendList<Branch>('/branches', {
        query: {
          companyId: companyId || undefined,
          divisionId: divisionId || undefined,
          activeOnly: true,
        },
      }).catch(() => []),
      backendList<ProductCategory>('/product-categories', { query: { ...common, isActive: true } }).catch(() => []),
      backendList<ProductFamily>('/products/families', {
        query: {
          companyId: companyId || undefined,
          divisionId: divisionId || undefined,
          categoryId: categoryId || undefined,
          isActive: true,
          limit: 5000,
        },
      }).catch(() => []),
    ]).then(([divisionRows, branchRows, categoryRows, familyRows]) => {
      if (cancelled) return;
      setDivisions(divisionRows);
      setBranches(branchRows);
      setCategories(categoryRows);
      setFamilies(familyRows);
    });
    return () => {
      cancelled = true;
    };
  }, [canView, companyId, divisionId, categoryId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const low = params.get('lowStock') === '1' || params.get('stock') === 'low';
    if (low) setStockStatusFilter('LOW_STOCK');
    const companyParam = params.get('companyId');
    if (companyParam) setCompanyId(companyParam);
    const divisionParam = params.get('divisionId');
    if (divisionParam) setDivisionId(divisionParam);
    const branchParam = params.get('branchId');
    if (branchParam) setBranchId(branchParam);
  }, []);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const [result, totals] = await Promise.all([
        backendPage<InventoryBalance>('/inventory-balances', {
          query: query({ page, limit: 25 }),
        }),
        backendGet<InventorySummary>('/inventory-balances/summary', { query: query() }),
      ]);
      setData(result);
      setSummary(totals);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inventory balances');
      setData(emptyPaginated<InventoryBalance>(page));
      setSummary(blankSummary());
    } finally {
      setLoading(false);
    }
  }, [canView, page, query]);

  useEffect(() => {
    load();
  }, [load]);

  const setFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };

  const resetFilters = () => {
    setCompanyId(workspace?.scope.companyId ?? '');
    setDivisionId(workspace?.scope.divisionId ?? '');
    setBranchId(workspace?.scope.branchId ?? '');
    setCategoryId('');
    setProductFamilyId('');
    setSearchInput('');
    setSearch('');
    setStockStatusFilter('');
    setCostStatus('');
    setStaleDays('');
    setPage(1);
  };

  const buildExportRows = (rows: InventoryBalance[]) =>
    rows.map((bal) => ({
      'Product Code': bal.product?.productCode ?? '',
      'Product Name': bal.product?.name ?? '',
      Category: bal.product?.category?.name ?? '',
      Family: bal.product?.productFamily?.name ?? '',
      Branch: bal.branch ? `${bal.branch.code ? `${bal.branch.code} - ` : ''}${bal.branch.name}` : '',
      Division: bal.division?.name ?? '',
      Company: bal.company?.name ?? '',
      'Stock Status': (stockStatus(bal) ?? '').replace(/_/g, ' '),
      'Cost Status': bal.costStatus === 'MISSING_COST' ? 'Missing cost' : 'Has cost',
      'Qty On Hand': fmtNum(bal.quantityOnHand),
      Reserved: fmtNum(bal.quantityReserved),
      Available: fmtNum(balanceAvailable(bal)),
      Reorder: fmtNum(bal.reorderLevel ?? bal.product?.reorderLevel ?? bal.product?.minimumStockLevel ?? 10),
      'Avg Cost': fmtNum(bal.averageCost),
      'Total Value': fmtNum(bal.totalValue),
      'Last Movement': fmtDate(bal.lastMovementAt),
      'Days Since Movement': bal.daysSinceMovement == null ? '' : String(bal.daysSinceMovement),
    }));

  const exportRegister = async (format: 'csv' | 'pdf') => {
    if (!canView) return;
    setExporting(format);
    try {
      const CAP = 5000;
      const result = await backendPage<InventoryBalance>('/inventory-balances', {
        query: query({ page: 1, limit: CAP }),
      });
      const rows = buildExportRows((result.data ?? []).slice(0, CAP));
      if (!rows.length) return;
      const columns = Object.keys(rows[0]);
      if (format === 'pdf') {
        await downloadTablePdf({
          title: 'Inventory Balances',
          subtitle: [
            companies.find((company) => company.id === companyId)?.name,
            categories.find((category) => category.id === categoryId)?.name,
            stockStatusFilter.replace(/_/g, ' '),
            costStatus.replace(/_/g, ' '),
          ]
            .filter(Boolean)
            .join(' · '),
          companyId: companyId || undefined,
          columns,
          rows: rows.map((row) => columns.map((column) => cellToString(row[column as keyof typeof row]))),
          numericColumns: [9, 10, 11, 12, 13, 14, 16],
          baseName: 'inventory-balances',
        });
      } else {
        downloadTextFile(
          `inventory-balances-${new Date().toISOString().slice(0, 10)}.csv`,
          'text/csv;charset=utf-8',
          rowsToCsv(rows, columns),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export inventory balances');
    } finally {
      setExporting(false);
    }
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Inventory Balances" subtitle="View stock on hand across branches" />
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">Access Restricted</p>
        </div>
      </div>
    );
  }

  const rows = data?.data ?? [];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Inventory Balances"
        subtitle="Stock workbench by product, category, family, branch, status, and cost."
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-7">
        <StatCard label="Total SKUs" value={summary.totalSkus} />
        <StatCard label="Stock Value" value={fmtTZS(summary.totalValue)} />
        <StatCard label="Out of Stock" value={summary.outOfStock} />
        <StatCard label="Low Stock" value={summary.lowStock} />
        <StatCard label="Oversold" value={summary.oversold} />
        <StatCard label="Missing Cost" value={summary.missingCost} />
        <StatCard label="Stale Stock" value={summary.staleStock} />
      </div>

      <PageToolbar
        search={searchInput}
        onSearch={(value) => setSearchInput(value)}
        searchPlaceholder="Search product name, code, SKU, barcode..."
        filters={
          <>
            <select
              value={companyId}
              onChange={(e) => {
                setFilter(setCompanyId, e.target.value);
                setDivisionId('');
                setBranchId('');
                setCategoryId('');
                setProductFamilyId('');
              }}
              className={filterSelectCls}
              style={filterStyle}
              aria-label="Filter by company"
            >
              <option value="">All Companies</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            <select
              value={divisionId}
              onChange={(e) => {
                setFilter(setDivisionId, e.target.value);
                setBranchId('');
                setProductFamilyId('');
              }}
              className={filterSelectCls}
              style={filterStyle}
              aria-label="Filter by division"
            >
              <option value="">All Divisions</option>
              {divisions.map((division) => (
                <option key={division.id} value={division.id}>
                  {division.code ? `${division.code} - ` : ''}{division.name}
                </option>
              ))}
            </select>
            <select
              value={branchId}
              onChange={(e) => setFilter(setBranchId, e.target.value)}
              className={filterSelectCls}
              style={filterStyle}
              aria-label="Filter by branch"
            >
              <option value="">All Branches</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.code ? `${branch.code} - ` : ''}{branch.name}
                </option>
              ))}
            </select>
            <select
              value={categoryId}
              onChange={(e) => {
                setFilter(setCategoryId, e.target.value);
                setProductFamilyId('');
              }}
              className={filterSelectCls}
              style={filterStyle}
              aria-label="Filter by category"
            >
              <option value="">All Categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <select
              value={productFamilyId}
              onChange={(e) => setFilter(setProductFamilyId, e.target.value)}
              className={filterSelectCls}
              style={filterStyle}
              aria-label="Filter by product family"
            >
              <option value="">All Families</option>
              {families.map((family) => (
                <option key={family.id} value={family.id}>
                  {family.brand ? `${family.brand} - ` : ''}{family.name}
                </option>
              ))}
            </select>
            <select
              value={stockStatusFilter}
              onChange={(e) => setFilter(setStockStatusFilter, e.target.value)}
              className={filterSelectCls}
              style={filterStyle}
              aria-label="Filter by stock status"
            >
              <option value="">All Stock</option>
              <option value="IN_STOCK">In stock</option>
              <option value="LOW_STOCK">Low stock</option>
              <option value="OUT_OF_STOCK">Out of stock</option>
              <option value="OVERSOLD">Oversold</option>
            </select>
            <select
              value={costStatus}
              onChange={(e) => setFilter(setCostStatus, e.target.value)}
              className={filterSelectCls}
              style={filterStyle}
              aria-label="Filter by cost status"
            >
              <option value="">All Costs</option>
              <option value="HAS_COST">Has cost</option>
              <option value="MISSING_COST">Missing cost</option>
            </select>
            <select
              value={staleDays}
              onChange={(e) => setFilter(setStaleDays, e.target.value)}
              className={filterSelectCls}
              style={filterStyle}
              aria-label="Filter by stale movement"
            >
              <option value="">Any Movement Age</option>
              <option value="30">Stale 30+ days</option>
              <option value="60">Stale 60+ days</option>
              <option value="90">Stale 90+ days</option>
              <option value="180">Stale 180+ days</option>
            </select>
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              {data?.total ?? 0} records
            </span>
            <Btn variant="ghost" size="xs" onClick={resetFilters}>
              Reset
            </Btn>
            <Btn
              variant="secondary"
              size="xs"
              onClick={() => exportRegister('csv')}
              disabled={!rows.length || !!exporting}
            >
              {exporting === 'csv' ? 'Exporting...' : 'Export CSV'}
            </Btn>
            <Btn
              variant="secondary"
              size="xs"
              onClick={() => exportRegister('pdf')}
              disabled={!rows.length || !!exporting}
            >
              {exporting === 'pdf' ? 'Exporting...' : 'Export PDF'}
            </Btn>
          </div>
        }
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1300px] text-sm">
            <caption className="sr-only">Inventory balances by product and branch</caption>
            <thead>
              <tr
                className="bg-gray-50 text-left text-xs uppercase"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th scope="col" className={thCls}>Product</th>
                <th scope="col" className={thCls}>Category / Family</th>
                <th scope="col" className={thCls}>Branch</th>
                <th scope="col" className={thCls}>Division</th>
                <th scope="col" className={`${thCls} text-right`}>On Hand</th>
                <th scope="col" className={`${thCls} text-right`}>Reserved</th>
                <th scope="col" className={`${thCls} text-right`}>Available</th>
                <th scope="col" className={`${thCls} text-right`}>Reorder</th>
                <th scope="col" className={`${thCls} text-right`}>Avg Cost</th>
                <th scope="col" className={`${thCls} text-right`}>Value</th>
                <th scope="col" className={thCls}>Status</th>
                <th scope="col" className={thCls}>Last Movement</th>
                <th scope="col" className={`${thCls} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={13}>
                    <SkeletonTable rows={6} cols={13} />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={13}>
                    <EmptyState
                      title="No inventory balances"
                      description="No balances match the current filters."
                    />
                  </td>
                </tr>
              ) : (
                rows.map((balance) => (
                  <tr key={balance.id} className="hover:bg-slate-50">
                    <td className={tdCls}>
                      <div className="font-medium">{balance.product?.name ?? 'Unknown product'}</div>
                      <div className="font-mono text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {balance.product?.productCode ?? balance.product?.sku ?? balance.productId}
                      </div>
                    </td>
                    <td className={tdCls}>
                      <div>{balance.product?.category?.name ?? 'Uncategorized'}</div>
                      <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {balance.product?.productFamily?.name ?? 'No family'}
                      </div>
                    </td>
                    <td className={tdCls}>
                      {balance.branch
                        ? `${balance.branch.code ? `${balance.branch.code} - ` : ''}${balance.branch.name}`
                        : 'No branch'}
                    </td>
                    <td className={tdCls}>{balance.division?.name ?? 'Company-wide'}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtNum(balance.quantityOnHand)}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtNum(balance.quantityReserved)}</td>
                    <td
                      className={`${tdCls} text-right font-mono ${
                        balanceAvailable(balance) < 0 ? 'font-semibold text-red-600' : ''
                      }`}
                    >
                      {fmtNum(balanceAvailable(balance))}
                    </td>
                    <td className={`${tdCls} text-right font-mono`}>
                      {fmtNum(balance.reorderLevel ?? balance.product?.reorderLevel ?? balance.product?.minimumStockLevel ?? 10)}
                    </td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtTZS(balance.averageCost)}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtTZS(balance.totalValue)}</td>
                    <td className={tdCls}>
                      <div className="flex flex-col items-start gap-1">
                        <StockBadge balance={balance} />
                        <CostBadge balance={balance} />
                      </div>
                    </td>
                    <td className={tdCls}>
                      <div>{fmtDate(balance.lastMovementAt)}</div>
                      <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {balance.daysSinceMovement == null ? 'No movement history' : `${balance.daysSinceMovement} days ago`}
                      </div>
                    </td>
                    <td className={`${tdCls} text-right`}>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Link
                          href={`/inventory?tab=stock&view=movements&companyId=${encodeURIComponent(balance.companyId)}&productId=${encodeURIComponent(balance.productId)}`}
                          className="rounded-lg border px-2 py-1 text-xs"
                          style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
                        >
                          Movements
                        </Link>
                        <Link
                          href={`/inventory/products/${balance.productId}`}
                          className="rounded-lg border px-2 py-1 text-xs"
                          style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
                        >
                          Product
                        </Link>
                        {balance.product?.category?.id && (
                          <Btn
                            variant="ghost"
                            size="xs"
                            onClick={() => {
                              setCategoryId(balance.product?.category?.id ?? '');
                              setProductFamilyId('');
                              setPage(1);
                            }}
                          >
                            Same Category
                          </Btn>
                        )}
                        {balance.product?.productFamily?.id && (
                          <Btn
                            variant="ghost"
                            size="xs"
                            onClick={() => {
                              setProductFamilyId(balance.product?.productFamily?.id ?? '');
                              setPage(1);
                            }}
                          >
                            Same Family
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && data.totalPages > 1 && (
          <div
            className="flex items-center justify-between border-t px-5 py-3"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Page {data.page} of {data.totalPages} · {data.total} total
            </span>
            <div className="flex gap-2">
              <Btn
                variant="secondary"
                size="xs"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous
              </Btn>
              <Btn
                variant="secondary"
                size="xs"
                disabled={page >= data.totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
