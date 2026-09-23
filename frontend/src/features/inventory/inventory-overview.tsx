'use client';
import { useState } from 'react';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import {
  Btn,
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
  PermissionDeniedState,
  type ScopeValue,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useInventoryWorkspace } from './inventory-workspace-context';
import { InventoryScope } from './inventory-scope';
import { inventoryViewHref } from './inventory-search';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { productLabel, productQuantity } from '@/components/workspace/product-form';
import { catalogueMoney } from '@/components/workspace/catalogue-types';
import { downloadTextFile, rowsToCsv } from '@/lib/report-export';
import { downloadTablePdf } from '@/lib/export-download';
import '@/components/workspace/workspace.css';
import './inventory-workspace.css';

interface Totals {
  totalSkus: number;
  out: number;
  low: number;
  negative: number;
  totalValue: number;
}
interface Movement {
  id: string;
  movementNumber?: string;
  movementDate: string;
  movementType: string;
  quantity: number | string | null;
  product?: { name: string; productCode?: string | null } | null;
  branch?: { name: string } | null;
  referenceNumber?: string | null;
  notes?: string | null;
}
const INBOUND = new Set([
  'OPENING_STOCK',
  'PURCHASE_RECEIPT',
  'SALES_RETURN',
  'TRANSFER_IN',
  'ADJUSTMENT_IN',
  'PRODUCTION_IN',
]);
const OUTBOUND = new Set([
  'SALE_ISSUE',
  'PURCHASE_RETURN',
  'TRANSFER_OUT',
  'ADJUSTMENT_OUT',
  'DAMAGE',
  'WASTAGE',
  'INTERNAL_USE',
  'PRODUCTION_OUT',
]);
export function movementQuantity(r: Movement) {
  if (r.quantity == null || r.quantity === '' || !Number.isFinite(Number(r.quantity))) return null;
  const n = Number(r.quantity);
  return INBOUND.has(r.movementType)
    ? Math.abs(n)
    : OUTBOUND.has(r.movementType)
      ? -Math.abs(n)
      : n;
}
const date = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';
const LINKS = [
  ['stock', 'live', 'Live stock', 'Availability across branches', 'inventory.view'],
  ['stock', 'balances', 'Balances', 'Stock on hand and valuation', 'inventory.view'],
  ['stock', 'movements', 'Movements', 'Receipts, issues and transfers', 'inventory.movements.view'],
  ['controls', 'adjustments', 'Stock adjustments', 'Counts and corrections', 'inventory.view'],
  ['catalog', 'products', 'Products', 'Prices, variants and inventory settings', 'products.view'],
  [
    'catalog',
    'categories',
    'Categories & families',
    'Organise the product catalogue',
    'product_categories.view',
  ],
  [
    'catalog',
    'units',
    'Units & conversions',
    'Consistent measures for every product',
    'units.view',
  ],
];
function OverviewData({ scope }: { scope: ScopeValue }) {
  const { hasPermission } = useAuth();
  const canMovements = hasPermission('inventory.movements.view');
  const live = useWorkspaceResource<{ totals: Totals }>('/inventory-balances/live', { ...scope });
  const pending = useWorkspaceResource<{ total: number }>('/stock-adjustments', {
    ...scope,
    status: 'PENDING_APPROVAL',
    page: 1,
    limit: 1,
  });
  const movements = useWorkspaceResource<{ data: Movement[]; total: number }>(
    '/inventory-movements',
    { ...scope, page: 1, limit: 6 },
    canMovements,
  );
  const [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState('');
  const rows = movements.data?.data || [];
  const exportRecent = async (format: 'csv' | 'pdf') => {
    if (!canMovements || !rows.length || movements.loading || movements.error || exporting) return;
    setExporting(true);
    setExportError('');
    const data = rows.map((r) => ({
      Movement: r.movementNumber || r.id,
      Date: date(r.movementDate),
      Product: [r.product?.productCode, r.product?.name].filter(Boolean).join(' · '),
      Type: productLabel(r.movementType),
      Quantity: movementQuantity(r),
    }));
    try {
      if (format === 'csv')
        downloadTextFile(
          'recent-inventory-movements.csv',
          'text/csv;charset=utf-8',
          rowsToCsv(data),
        );
      else
        await downloadTablePdf({
          title: 'Recent inventory movements',
          subtitle: `Latest ${rows.length} movements in the selected scope`,
          companyId: scope.companyId,
          columns: ['Movement', 'Date', 'Product', 'Type', 'Quantity'],
          rows: data.map((r) => [
            r.Movement,
            r.Date,
            r.Product,
            r.Type,
            r.Quantity === null ? '—' : String(r.Quantity),
          ]),
          numericColumns: [4],
          baseName: 'recent-inventory-movements',
        });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Unable to export recent movements.');
    } finally {
      setExporting(false);
    }
  };
  return (
    <>
      <div className="inventory-section-heading">
        <div>
          <h2>Stock health</h2>
          <p>Balances and activity for the selected company, division and branch.</p>
        </div>
        <Btn
          variant="secondary"
          onClick={() => {
            live.reload();
            pending.reload();
            movements.reload();
          }}
          disabled={live.loading || pending.loading || movements.loading}
        >
          Refresh inventory
        </Btn>
      </div>
      {live.loading ? (
        <PageSpinner label="Loading stock health" />
      ) : live.error ? (
        <ErrorState message={live.error} onRetry={live.reload} />
      ) : (
        live.data && (
          <div className="workspace-summary inventory-health-summary">
            <div>
              <span>Stock value</span>
              <strong>{catalogueMoney(live.data.totals.totalValue)}</strong>
            </div>
            <div>
              <span>Stock positions</span>
              <strong>{productQuantity(live.data.totals.totalSkus)}</strong>
              <small>Product and branch pairs</small>
            </div>
            <div>
              <span>Low stock</span>
              <strong>{productQuantity(live.data.totals.low)}</strong>
            </div>
            <div>
              <span>Out of stock</span>
              <strong>{productQuantity(live.data.totals.out)}</strong>
            </div>
            <div>
              <span>Negative on hand</span>
              <strong>{productQuantity(live.data.totals.negative)}</strong>
            </div>
          </div>
        )
      )}
      <div className="inventory-attention">
        <div>
          <h3>Pending adjustments</h3>
          {pending.loading ? (
            <p role="status">Loading pending adjustments…</p>
          ) : pending.error ? (
            <div role="alert">
              <p>{pending.error}</p>
              <Btn variant="secondary" size="sm" onClick={pending.reload}>
                Retry adjustments
              </Btn>
            </div>
          ) : (
            <p>{pending.data?.total ?? '—'} awaiting approval in this scope.</p>
          )}
        </div>
        <Link href={inventoryViewHref(scope, 'controls', 'adjustments')}>Review adjustments →</Link>
      </div>
      {canMovements && (
        <section className="inventory-recent" aria-label="Recent inventory activity">
          <div className="inventory-section-heading">
            <div>
              <h2>Recent movements</h2>
              <p>Latest six movements. Exports contain this preview only.</p>
            </div>
            <div className="inventory-actions">
              <Btn
                variant="secondary"
                size="sm"
                disabled={!rows.length || exporting || movements.loading}
                onClick={() => void exportRecent('csv')}
              >
                Export recent CSV
              </Btn>
              <Btn
                variant="secondary"
                size="sm"
                disabled={!rows.length || exporting || movements.loading}
                onClick={() => void exportRecent('pdf')}
              >
                Export recent PDF
              </Btn>
              <Link href={inventoryViewHref(scope, 'stock', 'movements')}>
                View all movements →
              </Link>
            </div>
          </div>
          {exportError && (
            <p role="alert" className="workspace-notice">
              {exportError}
            </p>
          )}
          <RecordBrowser<Movement>
            title="Recent movements"
            records={rows}
            total={rows.length}
            loading={movements.loading}
            error={movements.error}
            onRetry={movements.reload}
            name={(r) => r.product?.name || 'Product unavailable'}
            reference={(r) =>
              [r.movementNumber, r.product?.productCode].filter(Boolean).join(' · ')
            }
            fields={[
              { label: 'Date', value: (r) => date(r.movementDate) },
              { label: 'Quantity', value: (r) => productQuantity(movementQuantity(r)) },
            ]}
            details={[
              { label: 'Type', value: (r) => productLabel(r.movementType) },
              { label: 'Branch', value: (r) => r.branch?.name || '—' },
              { label: 'Reference', value: (r) => r.referenceNumber || '—' },
              { label: 'Notes', value: (r) => r.notes || '—' },
            ]}
            empty="No recent movements. Stock movements for this scope will appear here."
          />
        </section>
      )}
      <nav className="inventory-destinations" aria-label="Inventory workspaces">
        {LINKS.filter((l) => hasPermission(l[4])).map(([tab, view, label, description]) => (
          <Link key={view} href={inventoryViewHref(scope, tab, view)}>
            <span>
              {label}
              <span aria-hidden="true"> →</span>
            </span>
            <small>{description}</small>
          </Link>
        ))}
      </nav>
    </>
  );
}
export default function InventoryOverview() {
  const { hasPermission, loading } = useAuth();
  const workspace = useInventoryWorkspace();
  const [local, setLocal] = useState<ScopeValue>({ companyId: '', divisionId: '', branchId: '' });
  const scope = workspace?.scope || local;
  if (loading) return <PageSpinner />;
  if (!hasPermission('inventory.view'))
    return (
      <PermissionDeniedState description="Your current role does not allow viewing inventory." />
    );
  return (
    <div className="business-workspace inventory-overview">
      <PageHeader title="Inventory" subtitle="Stock health, recent activity and your next steps." />
      {!workspace && <InventoryScope value={local} onChange={setLocal} />}
      {scope.companyId ? (
        <OverviewData key={JSON.stringify(scope)} scope={scope} />
      ) : (
        <EmptyState
          title="Choose a company"
          description="Select a company to see its stock health and recent activity."
        />
      )}
    </div>
  );
}
