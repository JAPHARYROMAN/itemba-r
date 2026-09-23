'use client';
import { useState } from 'react';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { Btn, Modal, PageSpinner, StatusBadge } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { inventoryViewHref } from './inventory-search';
import {
  adjustmentActions,
  adjustmentName,
  adjustmentScope,
  type AdjustmentAction,
  type StockAdjustment,
} from './inventory-adjustment-types';

import { AdjustmentLines } from './inventory-adjustment-lines';
import { InventoryActionReview } from './inventory-action-review';

export function adjustmentDate(value?: string | null) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC'
    : '—';
}
export function AdjustmentReview({
  id,
  onClose,
  onChanged,
  onAction,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  onAction?: (action: AdjustmentAction) => void;
}) {
  const { hasPermission } = useAuth();
  const allowed = hasPermission('inventory.view') || hasPermission('inventory.adjustments.create');
  const resource = useWorkspaceResource<StockAdjustment>(`/stock-adjustments/${id}`, {}, allowed);
  const [action, setAction] = useState<AdjustmentAction | null>(null);
  const row = resource.data;
  return (
    <>
      {!action && (
        <Modal
          open
          title={row ? adjustmentName(row) : 'Review adjustment'}
          subtitle="Review counted quantities, recorded differences and approval history."
          size="2xl"
          onClose={() => {
            if (!action) onClose();
          }}
          footer={
            <Btn variant="secondary" onClick={onClose} disabled={!!action}>
              Close review
            </Btn>
          }
        >
          {resource.loading ? (
            <PageSpinner label="Loading adjustment" />
          ) : resource.error ? (
            <div role="alert" className="workspace-notice">
              <p>{resource.error}</p>
              <Btn variant="secondary" onClick={resource.reload}>
                Retry adjustment
              </Btn>
            </div>
          ) : !row ? (
            <p>Adjustment is unavailable.</p>
          ) : (
            <div className="inventory-adjustment-stack">
              <div className="inventory-adjustment-heading">
                <StatusBadge value={row.status} />
                <span>
                  {row.company?.name || row.companyId} ·{' '}
                  {row.branch?.name || row.branchId || 'No branch'}
                </span>
              </div>
              <div>
                <span className="inventory-filter-label">Reason</span>
                <p>{row.reason || '—'}</p>
              </div>
              {row.notes && (
                <div>
                  <span className="inventory-filter-label">Notes</span>
                  <p className="inventory-adjustment-notes">{row.notes}</p>
                </div>
              )}
              <AdjustmentLines row={row} />
              <dl className="inventory-adjustment-trail">
                <div>
                  <dt>Created</dt>
                  <dd>
                    {row.createdBy?.fullName || '—'} · {adjustmentDate(row.createdAt)}
                  </dd>
                </div>
                <div>
                  <dt>Approved</dt>
                  <dd>
                    {row.approvedBy?.fullName || '—'} · {adjustmentDate(row.approvedAt)}
                  </dd>
                </div>
                <div>
                  <dt>Posted</dt>
                  <dd>
                    {row.postedBy?.fullName || '—'} · {adjustmentDate(row.postedAt)}
                  </dd>
                </div>
              </dl>
              <div className="inventory-adjustment-actions" aria-label="Adjustment actions">
                {(
                  Object.entries(adjustmentActions) as [
                    AdjustmentAction,
                    (typeof adjustmentActions)[AdjustmentAction],
                  ][]
                )
                  .filter(
                    ([, spec]) =>
                      spec.statuses.includes(row.status) && hasPermission(spec.permission),
                  )
                  .map(([key, spec]) => (
                    <Btn
                      key={key}
                      variant={
                        key === 'submit' || key === 'approve' || key === 'post'
                          ? 'primary'
                          : 'secondary'
                      }
                      onClick={() => (onAction ? onAction(key) : setAction(key))}
                    >
                      {spec.label}
                    </Btn>
                  ))}
                {row.status === 'POSTED' && hasPermission('inventory.movements.view') && (
                  <Link
                    className="workspace-action-link"
                    href={inventoryViewHref(adjustmentScope(row), 'stock', 'movements', {
                      referenceType: 'StockAdjustment',
                      referenceId: row.id,
                    })}
                  >
                    View stock movements
                  </Link>
                )}
                <Btn variant="ghost" onClick={resource.reload}>
                  Refresh record
                </Btn>
              </div>
            </div>
          )}
        </Modal>
      )}
      {action && (
        <InventoryActionReview
          kind="adjustment"
          id={id}
          action={action}
          onClose={() => setAction(null)}
          onSaved={() => {
            setAction(null);
            onChanged();
            if (action === 'delete') onClose();
            else resource.reload();
          }}
        />
      )}
    </>
  );
}
