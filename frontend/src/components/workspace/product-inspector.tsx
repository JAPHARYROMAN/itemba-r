'use client';

import { useId, useRef, useState } from 'react';
import { Btn, FormInput, StatusBadge, type ScopeValue } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendPatch } from '@/lib/api-client';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useInventoryDefinitionForm } from '@/features/inventory/inventory-definition-form';
import { inventoryViewHref } from '@/features/inventory/inventory-search';
import { DraftFormNotice } from './workspace-drafts';
import { WorkspaceLink } from './workspace-navigation';
import { useUnsavedWork, useUnsavedWorkScopeId } from './unsaved-work-provider';
import { ProductEditor } from './product-editor';
import { ProductThumbnail } from './product-thumbnail';
import { productLabel, productQuantity } from './product-form';
import {
  productNumber,
  productRenameBody,
  productStock,
  productStockStatus,
} from './product-stock';
import type { Product, ProductCreateResponse } from './product-types';
import './product-inspector.css';

function ProductRename({
  record,
  onClose,
  onSaved,
}: {
  record: Product;
  onClose: () => void;
  onSaved: (record: Product) => void;
}) {
  const { hasPermission } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const draft = useInventoryDefinitionForm({
    baseline: { name: record.name },
    kind: 'product',
    title: 'Rename product',
    describe: (value) => value.name || record.name,
    record,
    busy,
    onClose,
  });
  return (
    <form
      className="product-rename"
      {...draft.guard.capture}
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending.current || !hasPermission('products.update')) return;
        pending.current = true;
        setBusy(true);
        setError('');
        try {
          draft.validateReview();
          const body = productRenameBody(record, draft.form.name);
          await draft.saveNow();
          const updated = await backendPatch<Product>(`/products/${record.id}`, body);
          draft.markSaved();
          onSaved(updated);
          onClose();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Unable to rename this product.');
        } finally {
          pending.current = false;
          setBusy(false);
        }
      }}
    >
      <FormInput
        label="New product name"
        value={draft.form.name}
        required
        disabled={busy}
        onChange={(event) =>
          draft.setForm((previous) => ({ ...previous, name: event.target.value }))
        }
      />
      <DraftFormNotice draft={draft} />
      {error && (
        <p role="alert" className="workspace-notice">
          {error}
        </p>
      )}
      <div className="inventory-actions">
        <Btn type="submit" loading={busy}>
          Save name
        </Btn>
        <Btn variant="secondary" disabled={busy} onClick={() => draft.guard.requestClose(onClose)}>
          Cancel rename
        </Btn>
      </div>
    </form>
  );
}

interface BranchBalance {
  id: string;
  productId: string;
  branchId: string;
  quantityOnHand?: number | string | null;
  quantityReserved?: number | string | null;
}

export function ProductInspector({
  record,
  scope,
  branchLabel,
  profileHref,
  imageVersion,
  retrievedAt,
  onSaved,
  onRefresh,
  onAdjust,
  onDelete,
}: {
  record: Product;
  scope: ScopeValue;
  branchLabel: string;
  profileHref: string;
  imageVersion: number;
  retrievedAt: number | null;
  onSaved: (record: ProductCreateResponse) => void;
  onRefresh: () => void;
  onAdjust: () => void;
  onDelete: () => void;
}) {
  const { hasPermission } = useAuth();
  const { request } = useUnsavedWork();
  const workScope = useUnsavedWorkScopeId();
  const id = useId();
  const [tab, setTab] = useState<'stock' | 'edit' | 'activity'>('stock');
  const [renaming, setRenaming] = useState(false);
  const [saved, setSaved] = useState<{ baseline: string | undefined; record: Product } | null>(
    null,
  );
  const product = saved && saved.baseline === record.updatedAt ? saved.record : record;
  const canEdit = hasPermission('products.update');
  const balance = useWorkspaceResource<{ data: BranchBalance[]; total: number }>(
    '/inventory-balances',
    {
      companyId: product.companyId,
      branchId: scope.branchId,
      productId: product.id,
      page: 1,
      limit: 20,
    },
    !!scope.branchId &&
      product.trackInventory &&
      !product.inventoryBalance &&
      hasPermission('inventory.view'),
  );
  const matching = balance.data?.data.find(
    (row) => row.productId === product.id && row.branchId === scope.branchId,
  );
  const onHand = productNumber(matching?.quantityOnHand);
  const reserved = productNumber(matching?.quantityReserved);
  const absentBalance = balance.data?.total === 0 && balance.data.data.length === 0;
  const stockRecord: Product = matching
    ? {
        ...product,
        inventoryBalance: { quantityOnHand: onHand, quantityReserved: reserved },
        availableQuantity: onHand !== null && reserved !== null ? onHand - reserved : null,
      }
    : absentBalance
      ? {
          ...product,
          inventoryBalance: { quantityOnHand: 0, quantityReserved: 0 },
          availableQuantity: 0,
        }
      : product;
  const stock = productStock(stockRecord);
  const currentScope = { ...scope, companyId: product.companyId };
  const unit = product.baseUnit?.symbol || product.baseUnit?.name || 'unit not set';
  const tabs: Array<typeof tab> =
    canEdit || tab === 'edit' ? ['stock', 'edit', 'activity'] : ['stock', 'activity'];
  const changeTab = (next: typeof tab, focus = false) =>
    request(
      () => {
        setRenaming(false);
        setTab(next);
        if (focus) document.getElementById(`${id}-${next}-tab`)?.focus();
      },
      undefined,
      'close',
      { scope: workScope },
    );
  const savedProduct = (updated: ProductCreateResponse) => {
    setSaved({ baseline: record.updatedAt, record: updated });
    onSaved(updated);
  };
  return (
    <section className="product-inspector" aria-label={`${product.name} inspector`}>
      <header className="product-inspector-heading">
        <ProductThumbnail record={product} version={imageVersion} />
        <div>
          <h2>{product.name}</h2>
          <p>
            {[product.productCode, product.sku].filter(Boolean).join(' · ') || 'No product code'}
          </p>
          <StatusBadge value={product.status} />
        </div>
      </header>
      {canEdit && tab !== 'edit' && !renaming && (
        <Btn variant="secondary" size="sm" onClick={() => setRenaming(true)}>
          Rename
        </Btn>
      )}
      {canEdit && renaming && (
        <ProductRename record={product} onClose={() => setRenaming(false)} onSaved={savedProduct} />
      )}
      <div className="product-inspector-tabs" role="tablist" aria-label="Product inspector views">
        {tabs.map((value) => (
          <button
            type="button"
            role="tab"
            key={value}
            id={`${id}-${value}-tab`}
            aria-controls={`${id}-panel`}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => changeTab(value)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const index = tabs.indexOf(value);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
              const nextTab = tabs[next];
              changeTab(nextTab, true);
            }}
          >
            {productLabel(value)}
          </button>
        ))}
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${tab}-tab`}
        className="product-inspector-panel"
      >
        {tab === 'edit' ? (
          <ProductEditor
            key={product.updatedAt || product.id}
            record={product}
            presentation="panel"
            onClose={() => setTab('stock')}
            onSaved={(updated) => {
              savedProduct(updated);
              setTab('stock');
            }}
          />
        ) : tab === 'stock' ? (
          <>
            <p className="product-stock-context">
              {scope.branchId ? branchLabel : 'Select a branch to see stock quantities.'}
              {retrievedAt && (
                <span>Retrieved {new Date(retrievedAt).toLocaleTimeString('en-GB')}</span>
              )}
            </p>
            <div className="product-stock-metrics">
              {(
                [
                  ['On hand', stock.onHand],
                  ['Reserved', stock.reserved],
                  ['Available', stock.available],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>
                    {scope.branchId && product.trackInventory ? productQuantity(value) : '—'}
                  </strong>
                  <small>{unit}</small>
                </div>
              ))}
            </div>
            <p
              className="product-stock-state"
              data-stock-status={productStockStatus(stockRecord, scope.branchId)}
            >
              {productStockStatus(stockRecord, scope.branchId)}
            </p>
            {balance.loading && <p role="status">Loading branch stock…</p>}
            {balance.error && (
              <p role="alert">
                {balance.error}{' '}
                <Btn variant="secondary" onClick={balance.reload}>
                  Retry stock
                </Btn>
              </p>
            )}
            <dl className="product-inspector-facts">
              <div>
                <dt>Category</dt>
                <dd>{product.category?.name || product.categoryId}</dd>
              </div>
              <div>
                <dt>Family</dt>
                <dd>
                  {product.productFamily
                    ? [product.productFamily.brand, product.productFamily.name]
                        .filter(Boolean)
                        .join(' · ')
                    : 'No family'}
                </dd>
              </div>
              <div>
                <dt>SKU</dt>
                <dd>{product.sku || '—'}</dd>
              </div>
              <div>
                <dt>Barcode</dt>
                <dd>{product.barcode || '—'}</dd>
              </div>
              <div>
                <dt>Reorder level</dt>
                <dd>
                  {productQuantity(product.reorderLevel)} {unit}
                </dd>
              </div>
              <div>
                <dt>Tracking</dt>
                <dd>
                  {[
                    product.trackInventory && 'Inventory',
                    product.trackBatch && 'Batches',
                    product.trackExpiry && 'Expiry',
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Not tracked'}
                </dd>
              </div>
              <div>
                <dt>Tax</dt>
                <dd>
                  {product.isTaxable
                    ? `Taxable · ${productQuantity(product.taxRate)}%`
                    : 'Not taxable'}
                </dd>
              </div>
              <div>
                <dt>Description</dt>
                <dd>{product.description || '—'}</dd>
              </div>
            </dl>
            <div className="product-inspector-actions">
              {hasPermission('inventory.adjustments.create') && product.trackInventory && (
                <Btn disabled={!scope.branchId} onClick={onAdjust}>
                  Adjust stock
                </Btn>
              )}
              <Btn
                variant="secondary"
                onClick={() => {
                  balance.reload();
                  onRefresh();
                }}
              >
                Refresh product
              </Btn>
            </div>
          </>
        ) : (
          <div className="product-activity-links">
            <p>Open the records for this exact product in the selected scope.</p>
            {hasPermission('inventory.movements.view') && (
              <WorkspaceLink
                href={inventoryViewHref(currentScope, 'stock', 'movements', {
                  productId: product.id,
                })}
              >
                Stock movements
              </WorkspaceLink>
            )}
            {(hasPermission('product_batches.view') || hasPermission('product_batches.manage')) && (
              <WorkspaceLink
                href={inventoryViewHref(currentScope, 'stock', 'batches', {
                  productId: product.id,
                })}
              >
                Batches & expiry
              </WorkspaceLink>
            )}
            {hasPermission('stock_damage.view') && (
              <WorkspaceLink
                href={inventoryViewHref(currentScope, 'controls', 'damage', {
                  productId: product.id,
                })}
              >
                Stock damage
              </WorkspaceLink>
            )}
            <WorkspaceLink href={profileHref}>Full product profile</WorkspaceLink>
          </div>
        )}
      </div>
      {tab !== 'activity' && <WorkspaceLink href={profileHref}>Full product profile</WorkspaceLink>}
      {hasPermission('products.delete') && (
        <Btn variant="ghost" onClick={onDelete}>
          Delete product
        </Btn>
      )}
    </section>
  );
}
