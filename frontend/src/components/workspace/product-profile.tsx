'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import Image from 'next/image';
import { Package } from 'lucide-react';
import {
  Btn,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
  PermissionDeniedState,
  StatusBadge,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useWorkspaceState } from './workspace-session';
import {
  useInventoryDefinitionEditor,
  useInventoryStateKey,
} from '@/features/inventory/inventory-drafts';
import { ProfileSections } from './partner-profile-controls';
import { productLabel, priceSourceLabel, productQuantity } from './product-form';
import { catalogueMoney } from './catalogue-types';
import type { Product } from './product-types';
import './workspace.css';
import './partner-profile.css';
import './product-workspace.css';

type Amount = number | string | null;
interface Balance {
  id: string;
  branchId?: string | null;
  locationId?: string | null;
  branch?: { name: string; code?: string | null } | null;
  location?: { name: string; code?: string | null } | null;
  quantityOnHand: Amount;
  quantityReserved: Amount;
  averageCost: Amount;
  totalValue: Amount;
  lastMovementAt?: string | null;
}
interface Movement {
  id: string;
  movementNumber?: string;
  movementDate: string;
  movementType: string;
  quantity: Amount;
  unitCost: Amount;
  totalCost: Amount;
  referenceNumber?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
  branch?: { name: string } | null;
  createdBy?: { fullName: string } | null;
}
interface LedgerRow {
  salesOrderId: string;
  salesOrderNumber: string;
  orderDate: string;
  customerName?: string | null;
  quantity: Amount;
  unitPrice: Amount;
  unitCostAtSale?: Amount;
  cogsAmount: Amount;
  grossProfitAmount: Amount;
  grossMarginPct?: Amount;
  profitCostSource?: string | null;
}
const number = (value: Amount | undefined) =>
  value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const date = (value?: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';
const available = (r: Balance) =>
  number(r.quantityOnHand) === null || number(r.quantityReserved) === null
    ? null
    : Number(r.quantityOnHand) - Number(r.quantityReserved);
const total = (rows: Balance[], field: 'quantityOnHand' | 'quantityReserved' | 'totalValue') =>
  rows.some((r) => number(r[field]) === null)
    ? null
    : rows.reduce((sum, r) => sum + Number(r[field]), 0);
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
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="partner-profile-detail">
      <p style={{ color: 'var(--aurora-text-secondary)' }}>{label}</p>
      <p>{children ?? '—'}</p>
    </div>
  );
}
function Pages({
  page,
  total,
  setPage,
}: {
  page: number;
  total: number;
  setPage: (page: number) => void;
}) {
  const count = Math.max(1, Math.ceil(total / 20));
  if (count < 2) return null;
  return (
    <nav aria-label="History pages" className="product-profile-pagination">
      <span>
        Page {page} of {count} · {total} records
      </span>
      <div>
        <Btn variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </Btn>
        <Btn
          variant="secondary"
          size="sm"
          disabled={page >= count}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Btn>
      </div>
    </nav>
  );
}
function Table({
  caption,
  headers,
  children,
}: {
  caption: string;
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className="product-profile-table-scroll">
      <table className="partner-profile-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function Stock({ product }: { product: Product }) {
  const result = useWorkspaceChoices<Balance>('/inventory-balances', {
    companyId: product.companyId,
    productId: product.id,
  });
  const stateKey = useInventoryStateKey('product.' + product.id + '.stock');
  const [page, setPage] = useWorkspaceState(stateKey + '.page', 1);
  if (result.loading) return <PageSpinner />;
  if (result.error) return <ErrorState message={result.error} onRetry={result.retry} />;
  if (!result.rows.length)
    return (
      <EmptyState
        title="No stock balances"
        description="No stock balances have been recorded for this product."
      />
    );
  const onHand = total(result.rows, 'quantityOnHand'),
    reserved = total(result.rows, 'quantityReserved');
  const current = Math.min(page, Math.max(1, Math.ceil(result.rows.length / 20)));
  return (
    <>
      <p className="partner-profile-history-note">
        All accessible branches and locations in this company. Totals include every balance record (
        {result.rows.length}).
      </p>
      <div className="workspace-summary">
        <div>
          <span>On hand</span>
          <strong>{productQuantity(onHand)}</strong>
        </div>
        <div>
          <span>Reserved</span>
          <strong>{productQuantity(reserved)}</strong>
        </div>
        <div>
          <span>Available</span>
          <strong>
            {productQuantity(onHand === null || reserved === null ? null : onHand - reserved)}
          </strong>
        </div>
        <div>
          <span>Stock value</span>
          <strong>{catalogueMoney(total(result.rows, 'totalValue'))}</strong>
        </div>
      </div>
      <Table
        caption="Stock by branch and location"
        headers={[
          'Branch / location',
          'On hand',
          'Reserved',
          'Available',
          'Average cost',
          'Total value',
          'Last movement',
        ]}
      >
        {result.rows.slice((current - 1) * 20, current * 20).map((r) => (
          <tr key={r.id}>
            <td data-label="Branch / location">
              <div>
                {r.branch?.name || r.branchId || 'Company-wide'}
                {(r.location || r.locationId) && <small>{r.location?.name || r.locationId}</small>}
              </div>
            </td>
            <td data-label="On hand">{productQuantity(number(r.quantityOnHand))}</td>
            <td data-label="Reserved">{productQuantity(number(r.quantityReserved))}</td>
            <td data-label="Available">{productQuantity(available(r))}</td>
            <td data-label="Average cost">{catalogueMoney(number(r.averageCost))}</td>
            <td data-label="Total value">{catalogueMoney(number(r.totalValue))}</td>
            <td data-label="Last movement">{date(r.lastMovementAt)}</td>
          </tr>
        ))}
      </Table>
      <Pages page={current} total={result.rows.length} setPage={setPage} />
    </>
  );
}
function Movements({ product, canReadSales }: { product: Product; canReadSales: boolean }) {
  const stateKey = useInventoryStateKey('product.' + product.id + '.movements');
  const [page, setPage] = useWorkspaceState(stateKey + '.page', 1);
  const result = useWorkspaceResource<{ data: Movement[]; total: number }>('/inventory-movements', {
    companyId: product.companyId,
    productId: product.id,
    page,
    limit: 20,
  });
  useEffect(() => {
    if (result.data && page > 1 && !result.data.data.length) setPage((p) => p - 1);
  }, [result.data, page, setPage]);
  if (result.loading) return <PageSpinner />;
  if (result.error) return <ErrorState message={result.error} onRetry={result.reload} />;
  const rows = result.data?.data || [];
  return (
    <>
      <p className="partner-profile-history-note">
        Stock movements across all accessible branches in this company.
      </p>
      {!rows.length ? (
        <EmptyState title="No movements" description="No stock movements on this page." />
      ) : (
        <Table
          caption="Product movement history"
          headers={[
            'Movement',
            'Date',
            'Branch',
            'Type',
            'Quantity',
            'Unit cost',
            'Total cost',
            'Reference',
            'Recorded by',
          ]}
        >
          {rows.map((r) => {
            const qty = number(r.quantity);
            const label =
              r.referenceNumber ||
              (r.referenceType && r.referenceId
                ? `${productLabel(r.referenceType)} · ${r.referenceId.slice(0, 8)}`
                : '—');
            return (
              <tr key={r.id}>
                <td data-label="Movement">
                  <div>
                    {r.movementNumber || r.id.slice(0, 8)}
                    {r.notes && <small>{r.notes}</small>}
                  </div>
                </td>
                <td data-label="Date">{date(r.movementDate)}</td>
                <td data-label="Branch">{r.branch?.name || '—'}</td>
                <td data-label="Type">{productLabel(r.movementType)}</td>
                <td data-label="Quantity">
                  {qty === null
                    ? '—'
                    : `${INBOUND.has(r.movementType) ? '+' : OUTBOUND.has(r.movementType) ? '−' : ''}${productQuantity(INBOUND.has(r.movementType) || OUTBOUND.has(r.movementType) ? Math.abs(qty) : qty)}`}
                </td>
                <td data-label="Unit cost">{catalogueMoney(number(r.unitCost))}</td>
                <td data-label="Total cost">{catalogueMoney(number(r.totalCost))}</td>
                <td data-label="Reference">
                  {canReadSales && r.referenceType === 'SalesOrder' && r.referenceId ? (
                    <Link href={`/operations/sales-orders/${r.referenceId}`}>{label}</Link>
                  ) : (
                    label
                  )}
                </td>
                <td data-label="Recorded by">{r.createdBy?.fullName || '—'}</td>
              </tr>
            );
          })}
        </Table>
      )}
      <Pages page={page} total={result.data?.total || 0} setPage={setPage} />
      <Link
        className="product-profile-related"
        href={`/inventory?tab=stock&view=movements&companyId=${encodeURIComponent(product.companyId)}`}
      >
        Open inventory movements →
      </Link>
    </>
  );
}
function Profit({ product, canReadSales }: { product: Product; canReadSales: boolean }) {
  const result = useWorkspaceResource<LedgerRow[]>(`/profit/products/${product.id}/ledger`, {
    companyId: product.companyId,
  });
  const stateKey = useInventoryStateKey('product.' + product.id + '.profit');
  const [page, setPage] = useWorkspaceState(stateKey + '.page', 1);
  if (result.loading) return <PageSpinner />;
  if (result.error) return <ErrorState message={result.error} onRetry={result.reload} />;
  const rows = result.data || [],
    current = Math.min(page, Math.max(1, Math.ceil(rows.length / 20)));
  return (
    <>
      <p className="partner-profile-history-note">
        The latest 250 sales lines returned by the profit ledger, using recorded sale costs. This is
        a recent history, not a lifetime total.
      </p>
      {!rows.length ? (
        <EmptyState
          title="No confirmed sales"
          description="There are no sales lines in this product’s profit ledger."
        />
      ) : (
        <Table
          caption="Product profitability"
          headers={[
            'Order',
            'Customer',
            'Quantity',
            'Unit price',
            'Unit cost',
            'Cost of sales',
            'Gross profit',
            'Margin',
            'Cost source',
          ]}
        >
          {rows.slice((current - 1) * 20, current * 20).map((r, i) => (
            <tr key={`${r.salesOrderId}-${current}-${i}`}>
              <td data-label="Order">
                <div>
                  {canReadSales ? (
                    <Link href={`/operations/sales-orders/${r.salesOrderId}`}>
                      {r.salesOrderNumber}
                    </Link>
                  ) : (
                    r.salesOrderNumber
                  )}
                  <small>{date(r.orderDate)}</small>
                </div>
              </td>
              <td data-label="Customer">{r.customerName || 'Walk-in'}</td>
              <td data-label="Quantity">{productQuantity(number(r.quantity))}</td>
              <td data-label="Unit price">{catalogueMoney(number(r.unitPrice))}</td>
              <td data-label="Unit cost">{catalogueMoney(number(r.unitCostAtSale))}</td>
              <td data-label="Cost of sales">{catalogueMoney(number(r.cogsAmount))}</td>
              <td data-label="Gross profit">{catalogueMoney(number(r.grossProfitAmount))}</td>
              <td data-label="Margin">
                {number(r.grossMarginPct) === null
                  ? '—'
                  : `${Number(r.grossMarginPct).toFixed(2)}%`}
              </td>
              <td data-label="Cost source">
                {r.profitCostSource ? productLabel(r.profitCostSource) : '—'}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pages page={current} total={rows.length} setPage={setPage} />
      <Link className="product-profile-related" href="/operations/profit">
        Open profitability workspace →
      </Link>
    </>
  );
}
type Section = 'Overview' | 'Stock by branch' | 'Movement history' | 'Profitability';
function Content({
  product,
  imageVersion,
  onEdit,
  onRefresh,
  backHref,
  section,
  setSection,
}: {
  product: Product;
  imageVersion: number;
  onEdit: () => void;
  onRefresh: () => void;
  backHref: string;
  section: Section;
  setSection: (value: Section) => void;
}) {
  const { hasPermission } = useAuth();
  const sections: Section[] = ['Overview'];
  if (hasPermission('inventory.view')) sections.push('Stock by branch');
  if (hasPermission('inventory.movements.view')) sections.push('Movement history');
  if (hasPermission('profit.view') || hasPermission('operations.reports.view'))
    sections.push('Profitability');
  const active = sections.includes(section) ? section : 'Overview';
  const family = product.productFamily
    ? [product.productFamily.brand, product.productFamily.name].filter(Boolean).join(' · ')
    : product.productFamilyId || 'No family';
  const selling = number(
    product.effectiveSellingPrice !== undefined
      ? product.effectiveSellingPrice
      : product.defaultSellingPrice,
  );
  const cost = number(
    product.effectivePurchasePrice !== undefined
      ? product.effectivePurchasePrice
      : product.defaultPurchasePrice,
  );
  const margin =
    selling !== null && selling > 0 && cost !== null
      ? (((selling - cost) / selling) * 100).toFixed(2) + '%'
      : '—';
  const unit = (value: Product['baseUnit'], id?: string | null) =>
    value ? `${value.name} (${value.symbol})` : id || '—';
  return (
    <>
      <header className="partner-profile-heading">
        <PageHeader
          title={product.name}
          subtitle={[product.productCode, product.category?.name, family]
            .filter(Boolean)
            .join(' · ')}
          breadcrumbs={[{ label: 'Products', href: backHref }, { label: product.name }]}
        />
        <div className="partner-profile-actions">
          <Link className="workspace-action" href={backHref}>
            Back to products
          </Link>
          <Btn variant="secondary" onClick={onRefresh}>
            Refresh
          </Btn>
          {hasPermission('products.update') && <Btn onClick={onEdit}>Edit product</Btn>}
          <StatusBadge status={product.status} />
        </div>
      </header>
      <div className="product-profile-overview">
        <div className="product-profile-image">
          {product.imageUrl ? (
            <Image
              unoptimized
              src={`/api/backend/products/${product.id}/image?v=${imageVersion}`}
              alt={product.name}
              width={84}
              height={84}
            />
          ) : (
            <Package size={32} aria-hidden="true" />
          )}
        </div>
        <div className="workspace-summary">
          <div>
            <span>Selling price</span>
            <strong>{catalogueMoney(selling)}</strong>
          </div>
          <div>
            <span>Purchase cost</span>
            <strong>{catalogueMoney(cost)}</strong>
          </div>
          <div>
            <span>Estimated gross margin</span>
            <strong>{margin}</strong>
          </div>
          <div>
            <span>Price source</span>
            <strong>{priceSourceLabel(product.priceSource)}</strong>
          </div>
        </div>
      </div>
      <Card padding="none">
        <ProfileSections items={sections} value={active} onChange={setSection} />
        <section
          id="partner-profile-section"
          aria-label={active}
          className="partner-profile-content"
        >
          {active === 'Overview' && (
            <>
              <h3>Product details</h3>
              <div className="product-profile-fields">
                <Field label="Code">{product.productCode || '—'}</Field>
                <Field label="SKU">{product.sku || '—'}</Field>
                <Field label="Barcode">{product.barcode || '—'}</Field>
                <Field label="Type">{productLabel(product.productType)}</Field>
                <Field label="Company">{product.company?.name || product.companyId}</Field>
                <Field label="Division">
                  {product.division?.name || product.divisionId || 'Company-wide'}
                </Field>
                <Field label="Category">{product.category?.name || product.categoryId}</Field>
                <Field label="Family">{family}</Field>
                <Field label="Variant">
                  {[
                    product.variantName,
                    product.variantColor,
                    product.variantSize,
                    product.variantFinish,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </Field>
                <Field label="Base unit">{unit(product.baseUnit, product.baseUnitId)}</Field>
                <Field label="Purchase unit">
                  {unit(product.purchaseUnit, product.purchaseUnitId)}
                </Field>
                <Field label="Sales unit">{unit(product.salesUnit, product.salesUnitId)}</Field>
                <Field label="Wholesale price">
                  {catalogueMoney(
                    number(
                      product.effectiveWholesalePrice !== undefined
                        ? product.effectiveWholesalePrice
                        : product.wholesalePrice,
                    ),
                  )}
                </Field>
                <Field label="Retail price">
                  {catalogueMoney(
                    number(
                      product.effectiveRetailPrice !== undefined
                        ? product.effectiveRetailPrice
                        : product.retailPrice,
                    ),
                  )}
                </Field>
                <Field label="Tax">
                  {product.isTaxable
                    ? `Taxable · ${number(product.taxRate) === null ? 'rate not set' : `${product.taxRate}%`}`
                    : product.isTaxable === false
                      ? 'Not taxable'
                      : 'Not set'}
                </Field>
                <Field label="Tracking">
                  {[
                    product.trackInventory && 'Inventory',
                    product.trackBatch && 'Batch',
                    product.trackExpiry && 'Expiry',
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'None'}
                </Field>
                <Field label="Minimum stock">
                  {productQuantity(number(product.minimumStockLevel))}
                </Field>
                <Field label="Maximum stock">
                  {productQuantity(number(product.maximumStockLevel))}
                </Field>
                <Field label="Reorder level">{productQuantity(number(product.reorderLevel))}</Field>
              </div>
              <Field label="Description">{product.description || '—'}</Field>
              <p className="partner-profile-history-note">
                Estimated margin uses the effective selling price and purchase cost. Actual sale
                margins are shown in the profitability history when available.
              </p>
              {(hasPermission('inventory.view') ||
                hasPermission('grn.list') ||
                hasPermission('purchases.view')) && (
                <div className="product-profile-links">
                  <h3>Related workspaces</h3>
                  <p>Open a register to review or create transactions.</p>
                  <div>
                    {hasPermission('inventory.view') && (
                      <Link
                        href={`/inventory?tab=controls&view=adjustments&companyId=${encodeURIComponent(product.companyId)}`}
                      >
                        Stock adjustments →
                      </Link>
                    )}
                    {hasPermission('grn.list') && (
                      <Link href="/procurement/grns">Goods received →</Link>
                    )}
                    {hasPermission('purchases.view') && (
                      <Link href="/operations/purchase-orders">Purchase orders →</Link>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
          {active === 'Stock by branch' && <Stock product={product} />}
          {active === 'Movement history' && (
            <Movements product={product} canReadSales={hasPermission('sales.view')} />
          )}
          {active === 'Profitability' && (
            <Profit product={product} canReadSales={hasPermission('sales.view')} />
          )}
        </section>
      </Card>
    </>
  );
}
export function ProductProfile({ productId, backHref }: { productId: string; backHref: string }) {
  const { hasPermission, loading } = useAuth();
  const allowed =
    !loading &&
    [
      'products.view',
      'inventory.view',
      'inventory.adjustments.create',
      'pos.create',
      'sales.create',
      'purchases.create',
      'operations.dashboard.view',
    ].some((permission) => hasPermission(permission));
  const resource = useWorkspaceResource<Product>(
    `/products/${productId}`,
    {},
    allowed && !!productId,
  );
  const [notice, setNotice] = useState(''),
    [imageVersion, setImageVersion] = useState(() => Date.now());
  const stateKey = useInventoryStateKey('product.' + productId);
  const [section, setSection] = useWorkspaceState<Section>(stateKey + '.section', 'Overview');
  const entry = useInventoryDefinitionEditor(
    ['product'],
    (message) => {
      setNotice(message);
      setImageVersion(Date.now());
      resource.reload();
    },
    productId,
  );
  if (loading) return <PageSpinner />;
  if (!allowed)
    return (
      <PermissionDeniedState description="Your current role does not allow viewing product profiles." />
    );
  return (
    <div className="business-workspace partner-profile product-profile">
      {entry.drafts}
      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      {resource.loading ? (
        <PageSpinner />
      ) : resource.error || !resource.data ? (
        <>
          <PageHeader title="Product" />
          <Link href={backHref}>Back to products</Link>
          <ErrorState message={resource.error || 'Product not found.'} onRetry={resource.reload} />
        </>
      ) : (
        <Content
          product={resource.data}
          imageVersion={imageVersion}
          onRefresh={resource.reload}
          onEdit={() => {
            setNotice('');
            if (resource.data) entry.open({ kind: 'product', record: resource.data });
          }}
          backHref={backHref}
          section={section}
          setSection={setSection}
        />
      )}
    </div>
  );
}
