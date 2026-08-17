'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Btn, Card, EmptyState, PageSpinner, showToast } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendGet } from '@/lib/api-client';
import { downloadTablePdf } from '@/lib/export-download';
import { downloadTextFile, rowsToCsv } from '@/lib/report-export';
import { useInventoryWorkspace } from './inventory-workspace-context';

type ReportDefinition = {
  key: string;
  title: string;
  description: string;
  endpoint: string;
  source: 'operations' | 'westsides';
  columns: string[];
};

const REPORTS: ReportDefinition[] = [
  {
    key: 'stock-valuation',
    title: 'Stock valuation',
    description: 'Stock on hand, availability, average cost, and total stock value.',
    endpoint: '/operations-reports/stock-valuation',
    source: 'operations',
    columns: ['productCode', 'product', 'category', 'branch', 'quantityOnHand', 'availableQuantity', 'averageCost', 'totalValue', 'stockStatus'],
  },
  {
    key: 'low-stock',
    title: 'Low stock',
    description: 'Products at or below their reorder or minimum stock level.',
    endpoint: '/operations-reports/low-stock',
    source: 'operations',
    columns: ['productCode', 'product', 'category', 'branch', 'quantityOnHand', 'availableQuantity', 'reorderLevel', 'shortageQuantity', 'totalValue'],
  },
  {
    key: 'stock-ageing',
    title: 'Stock ageing',
    description: 'Slow-moving stock and value exposure by product and branch.',
    endpoint: '/operations-reports/stock-ageing',
    source: 'operations',
    columns: ['productCode', 'product', 'category', 'branch', 'quantityOnHand', 'totalValue', 'daysSinceMovement'],
  },
  {
    key: 'inventory-movements',
    title: 'Inventory movements',
    description: 'Stock receipts, issues, transfers, adjustments, costs, and references.',
    endpoint: '/operations-reports/inventory-movements',
    source: 'operations',
    columns: ['movementNumber', 'movementDate', 'movementType', 'branch', 'productCode', 'product', 'quantity', 'unit', 'unitCost', 'totalCost', 'referenceType'],
  },
  {
    key: 'stock-adjustments',
    title: 'Stock adjustments',
    description: 'Count evidence showing system, counted, and variance quantities.',
    endpoint: '/operations-reports/stock-adjustments',
    source: 'operations',
    columns: ['adjustmentNumber', 'date', 'branch', 'status', 'productCode', 'product', 'systemQuantity', 'countedQuantity', 'varianceQuantity', 'unit'],
  },
  {
    key: 'batch-status',
    title: 'Batch status',
    description: 'Batch quantity, cost, expiry exposure, and current status.',
    endpoint: '/westsides/reports/batch-status',
    source: 'westsides',
    columns: ['batchNumber', 'productName', 'sku', 'remainingQuantity', 'unitCost', 'expiryDate', 'status'],
  },
  {
    key: 'stock-damage',
    title: 'Stock damage',
    description: 'Damage and breakage by type, status, quantity, and estimated value.',
    endpoint: '/westsides/reports/stock-damage-report',
    source: 'westsides',
    columns: ['damageType', 'status', 'reportCount', 'quantity', 'estimatedValue'],
  },
];

function normalizeRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (!payload || typeof payload !== 'object') return [];
  const object = payload as Record<string, unknown>;
  if (Array.isArray(object.rows)) return object.rows as Record<string, unknown>[];
  if (Array.isArray(object.items)) return object.items as Record<string, unknown>[];
  const list = Object.values(object).find((value) => Array.isArray(value));
  if (Array.isArray(list)) return list as Record<string, unknown>[];
  return [object];
}

function columnsFor(rows: Record<string, unknown>[], report: ReportDefinition) {
  const available = new Set(
    rows.flatMap((row) =>
      Object.keys(row).filter((key) => !key.endsWith('Id') && !key.startsWith('_')),
    ),
  );
  const preferred = report.columns.filter((column) => available.has(column));
  return [...preferred, ...Array.from(available).filter((column) => !preferred.includes(column))];
}

function heading(value: string) {
  return value
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function printableValue(column: string, value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value instanceof Date) return value.toLocaleDateString('en-GB');
  if (typeof value === 'number') {
    return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 2 }).format(value);
  }
  if (typeof value === 'object') return '';
  if (/(date|expiry|movementat)$/i.test(column)) {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString('en-GB');
  }
  return String(value).replace(/_/g, ' ');
}

export default function InventoryReports() {
  const workspace = useInventoryWorkspace();
  const { hasPermission } = useAuth();
  const [activeKey, setActiveKey] = useState('stock-valuation');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState<false | 'csv' | 'pdf'>(false);

  const visibleReports = useMemo(
    () =>
      REPORTS.filter((report) =>
        report.source === 'operations'
          ? hasPermission('operations.reports.view')
          : hasPermission('westsides.reports.view'),
      ),
    [hasPermission],
  );
  const activeReport =
    visibleReports.find((report) => report.key === activeKey) ?? visibleReports[0];

  useEffect(() => {
    if (activeReport && activeReport.key !== activeKey) setActiveKey(activeReport.key);
  }, [activeKey, activeReport]);

  const load = useCallback(async () => {
    // Inventory reports are company-scoped. Do not issue an accidental
    // unscoped request while the operator is still choosing a workspace scope.
    if (!activeReport || !workspace?.scope.companyId) {
      setRows([]);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const payload = await backendGet<unknown>(activeReport.endpoint, {
        query: {
          companyId: workspace?.scope.companyId || undefined,
          divisionId: workspace?.scope.divisionId || undefined,
          branchId: workspace?.scope.branchId || undefined,
          locationId: workspace?.scope.branchId || undefined,
        },
      });
      setRows(normalizeRows(payload));
    } catch (reason) {
      setRows([]);
      setError(reason instanceof Error ? reason.message : 'Could not load the selected report');
    } finally {
      setLoading(false);
    }
  }, [activeReport, workspace?.scope.branchId, workspace?.scope.companyId, workspace?.scope.divisionId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!activeReport) {
    return <EmptyState title="Reports unavailable" description="Your role does not include inventory report access." />;
  }

  if (!workspace?.scope.companyId) {
    return (
      <EmptyState
        title="Select a company to run reports"
        description="Choose a company above. You can leave Branch blank to report across all of its branches."
      />
    );
  }

  const columns = columnsFor(rows, activeReport);
  const scopeLabel = [
    'Selected company',
    workspace?.scope.divisionId ? 'Selected division' : '',
    workspace?.scope.branchId ? 'Selected branch' : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const exportReport = async (format: 'csv' | 'pdf') => {
    if (!rows.length) return;
    setExporting(format);
    try {
      if (format === 'csv') {
        const exportRows = rows.map((row) =>
          Object.fromEntries(columns.map((column) => [heading(column), printableValue(column, row[column])])),
        );
        downloadTextFile(
          `${activeReport.key}-${new Date().toISOString().slice(0, 10)}.csv`,
          'text/csv;charset=utf-8',
          rowsToCsv(exportRows, columns.map(heading)),
        );
      } else {
        await downloadTablePdf({
          title: activeReport.title,
          subtitle: scopeLabel,
          companyId: workspace?.scope.companyId || undefined,
          columns: columns.map(heading),
          rows: rows.map((row) => columns.map((column) => printableValue(column, row[column]))),
          baseName: activeReport.key,
        });
      }
    } catch (reason) {
      showToast('error', 'Could not export report', reason instanceof Error ? reason.message : undefined);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visibleReports.map((report) => {
          const active = report.key === activeReport.key;
          return (
            <button
              key={report.key}
              type="button"
              onClick={() => setActiveKey(report.key)}
              className="rounded-lg border p-4 text-left transition-colors"
              style={{
                borderColor: active ? 'var(--aurora-primary)' : 'var(--aurora-border)',
                background: active ? 'var(--aurora-primary-subtle)' : 'var(--aurora-card)',
              }}
            >
              <span className="block text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                {report.title}
              </span>
              <span className="mt-1 block text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
                {report.description}
              </span>
            </button>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--aurora-border)' }}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
              {activeReport.title}
            </h2>
            <p className="text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>{scopeLabel}</p>
          </div>
          <div className="flex gap-2">
            <Btn variant="secondary" size="sm" onClick={() => void load()} loading={loading}>Refresh</Btn>
            <Btn variant="secondary" size="sm" onClick={() => void exportReport('csv')} disabled={!rows.length || exporting !== false}>Export CSV</Btn>
            <Btn variant="secondary" size="sm" onClick={() => void exportReport('pdf')} disabled={!rows.length || exporting !== false} loading={exporting === 'pdf'}>Export PDF</Btn>
          </div>
        </div>

        {error ? (
          <div role="alert" className="m-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : loading ? (
          <PageSpinner label="Running report" />
        ) : !rows.length ? (
          <EmptyState title="No report rows" description="No records match the selected inventory scope." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase" style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}>
                  {columns.map((column) => <th key={column} className="whitespace-nowrap px-4 py-3 font-medium">{heading(column)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={`${activeReport.key}-${rowIndex}`} className="border-b" style={{ borderColor: 'var(--aurora-border-subtle)' }}>
                    {columns.map((column) => <td key={column} className="whitespace-nowrap px-4 py-3">{printableValue(column, row[column])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
