'use client';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { useAuth } from '@/hooks/use-auth';
import { productQuantity } from '@/components/workspace/product-form';
import { catalogueMoney } from '@/components/workspace/catalogue-types';
import { inventoryProductHref } from './inventory-search';
import { adjustmentScope, type StockAdjustment } from './inventory-adjustment-types';
export function AdjustmentLines({ row }: { row: StockAdjustment }) {
  const { hasPermission } = useAuth();
  return (
    <section aria-label="Adjustment lines" className="inventory-adjustment-stack">
      <h3>Counted stock · {row.lines?.length ?? '—'} lines</h3>
      {(row.lines || []).map((line, index) => (
        <article key={line.id} className="inventory-adjustment-line">
          <header>
            <strong>
              {index + 1}. {line.product?.name || line.productId}
            </strong>
            {line.product?.sku && <small>{line.product.sku}</small>}
          </header>
          <dl className="inventory-adjustment-quantities">
            <div>
              <dt>System quantity</dt>
              <dd>{productQuantity(line.systemQuantity)}</dd>
            </div>
            <div>
              <dt>Counted quantity</dt>
              <dd>{productQuantity(line.countedQuantity)}</dd>
            </div>
            <div>
              <dt>Difference</dt>
              <dd>
                {line.varianceQuantity != null && Number(line.varianceQuantity) > 0 ? '+' : ''}
                {productQuantity(line.varianceQuantity)}
              </dd>
            </div>
            <div>
              <dt>Unit</dt>
              <dd>{line.unit?.symbol || line.unit?.name || '—'}</dd>
            </div>
            <div>
              <dt>Recorded unit cost</dt>
              <dd>{catalogueMoney(line.unitCost)}</dd>
            </div>
          </dl>
          {line.reason && <p className="inventory-adjustment-notes">{line.reason}</p>}
          {hasPermission('products.view') && (
            <Link
              className="workspace-action-link"
              href={inventoryProductHref(adjustmentScope(row), line.productId)}
            >
              Open product
            </Link>
          )}
        </article>
      ))}
    </section>
  );
}
