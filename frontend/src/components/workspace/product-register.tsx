'use client';

import { useId, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { ErrorState, PageSpinner, StatusBadge, type ScopeValue } from '@/components/ui';
import { WorkspaceSplit } from './workspace-split';
import { ProductInspector } from './product-inspector';
import { ProductThumbnail } from './product-thumbnail';
import { productQuantity } from './product-form';
import { productStock, productStockStatus } from './product-stock';
import type { Product, ProductCreateResponse } from './product-types';
import './product-inspector.css';

export function ProductRegister({
  records,
  total,
  page,
  selectedId,
  selected,
  loading,
  error,
  detailLoading,
  detailError,
  onRetry,
  onDetailRetry,
  onSelect,
  onClose,
  onPage,
  scope,
  branchLabel,
  retrievedAt,
  imageVersion,
  profileHref,
  onSaved,
  onAdjust,
  onDelete,
}: {
  records: Product[];
  total: number;
  page: number;
  selectedId: string | null;
  selected?: Product;
  loading: boolean;
  error: string;
  detailLoading: boolean;
  detailError: string;
  onRetry: () => void;
  onDetailRetry: () => void;
  onSelect: (record: Product) => void;
  onClose: () => void;
  onPage: (page: number) => void;
  scope: ScopeValue;
  branchLabel: string;
  retrievedAt: number | null;
  imageVersion: number;
  profileHref: (record: Product) => string;
  onSaved: (record: ProductCreateResponse) => void;
  onAdjust: (record: Product) => void;
  onDelete: (record: Product) => void;
}) {
  const { hasPermission } = useAuth();
  const canAdjust = !!scope.branchId && hasPermission('inventory.adjustments.create');
  const [compact, setCompact] = useState(true);
  const id = useId();
  return (
    <div className="product-register" data-compact={compact}>
      <WorkspaceSplit selectedKey={selectedId} onClose={onClose}>
        <section className="record-list" aria-label="Products">
          <div className="record-list-heading">
            <span>Products</span>
            <div className="record-view-controls">
              <span>
                {loading ? 'Loading…' : error ? 'Unavailable' : `${total.toLocaleString()} records`}
              </span>
              <button type="button" aria-pressed={compact} onClick={() => setCompact(!compact)}>
                Compact rows
              </button>
            </div>
          </div>
          {loading ? (
            <PageSpinner label="Loading products" />
          ) : error ? (
            <ErrorState message={error} onRetry={onRetry} />
          ) : !records.length ? (
            <div className="record-empty">
              <h2>Nothing here yet</h2>
              <p>No products match this view. Adjust the filters or add a product.</p>
            </div>
          ) : (
            <div
              className="product-register-scroll"
              role="region"
              aria-label="Products records"
              tabIndex={0}
            >
              <table className="product-register-table">
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Unit</th>
                    <th scope="col">On hand</th>
                    <th scope="col">Reserved</th>
                    <th scope="col">Available</th>
                    <th scope="col">Status</th>
                    {canAdjust && <th scope="col">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => {
                    const stock = productStock(record);
                    return (
                      <tr key={record.id} data-selected={record.id === selectedId}>
                        <td data-column-label="Product">
                          <button
                            id={`${id}-inspect-${record.id}`}
                            type="button"
                            aria-label={`Inspect ${record.name}`}
                            aria-expanded={record.id === selectedId}
                            onClick={(event) => {
                              event.currentTarget.focus();
                              onSelect(record);
                            }}
                            className="product-register-identity"
                          >
                            <ProductThumbnail record={record} version={imageVersion} />
                            <span>
                              <strong>{record.name}</strong>
                              <small>
                                {[
                                  record.productCode,
                                  record.sku,
                                  record.variantName,
                                  record.variantColor,
                                  record.variantSize,
                                  record.variantFinish,
                                ]
                                  .filter(Boolean)
                                  .join(' · ') || 'No product code'}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td data-column-label="Unit">
                          {record.baseUnit?.symbol || record.baseUnit?.name || '—'}
                        </td>
                        {(
                          [
                            ['On hand', stock.onHand],
                            ['Reserved', stock.reserved],
                            ['Available', stock.available],
                          ] as const
                        ).map(([label, value]) => (
                          <td key={label} data-column-label={label} data-numeric>
                            {scope.branchId && record.trackInventory ? productQuantity(value) : '—'}
                          </td>
                        ))}
                        <td data-column-label="Status">
                          <StatusBadge value={record.status} />
                          <small
                            className="product-register-stock-state"
                            data-stock-status={productStockStatus(record, scope.branchId)}
                          >
                            {productStockStatus(record, scope.branchId)}
                          </small>
                        </td>
                        {canAdjust && (
                          <td data-column-label="Actions">
                            {record.trackInventory && (
                              <button
                                type="button"
                                className="product-row-adjust"
                                aria-label={`Adjust stock for ${record.name}`}
                                onClick={() => onAdjust(record)}
                              >
                                Adjust stock
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {total > 20 && !error && (
            <footer className="record-pagination">
              <span>
                Page {page} of {Math.ceil(total / 20)}
              </span>
              <button disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>
                Previous
              </button>
              <button disabled={loading || page * 20 >= total} onClick={() => onPage(page + 1)}>
                Next
              </button>
            </footer>
          )}
        </section>
        {selected ? (
          <ProductInspector
            key={selected.id}
            record={selected}
            scope={scope}
            branchLabel={branchLabel}
            profileHref={profileHref(selected)}
            imageVersion={imageVersion}
            retrievedAt={retrievedAt}
            onSaved={onSaved}
            onRefresh={onDetailRetry}
            onAdjust={() => onAdjust(selected)}
            onDelete={() => onDelete(selected)}
          />
        ) : detailError ? (
          <ErrorState message={detailError} onRetry={onDetailRetry} />
        ) : detailLoading ? (
          <PageSpinner label="Loading selected product" />
        ) : selectedId ? (
          <p className="workspace-notice">This product is unavailable in the selected scope.</p>
        ) : null}
      </WorkspaceSplit>
    </div>
  );
}
