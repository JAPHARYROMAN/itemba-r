'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Btn, FormTextarea, Modal, PageSpinner, StatusBadge, showToast } from '@/components/ui';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { catalogueMoney } from '@/components/workspace/catalogue-types';
import { productLabel } from '@/components/workspace/product-form';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendDelete, backendGet, backendPatch } from '@/lib/api-client';
import { AdjustmentLines } from './inventory-adjustment-lines';
import {
  adjustmentActions,
  adjustmentName,
  type AdjustmentAction,
  type StockAdjustment,
} from './inventory-adjustment-types';
import {
  DAMAGE_ACTIONS,
  damageQuantity,
  type DamageAction,
  type StockDamage,
} from './inventory-damage-types';

type Record = StockAdjustment | StockDamage;
type Props = (
  | { kind: 'adjustment'; action: AdjustmentAction }
  | { kind: 'damage'; action: DamageAction }
) & {
  id: string;
  draftSource?: WorkspaceDraft;
  onClose: () => void;
  onSaved: () => void;
};
/** Compare the values displayed for this decision, including the version when available. */
function snapshot(row: Record) {
  const common = [row.id, row.updatedAt, row.status, row.companyId, row.branchId, row.notes];
  return JSON.stringify(
    'damageNumber' in row
      ? [
          ...common,
          row.productId,
          row.unitId,
          row.batchId,
          row.quantity,
          row.damageType,
          row.estimatedValue,
        ]
      : [...common, row.divisionId, row.reason, row.lines],
  );
}
function DamageDetails({ row }: { row: StockDamage }) {
  return (
    <>
      <strong>{row.product?.name || row.productId}</strong>
      <dl className="inventory-damage-review-grid">
        <div>
          <dt>Company</dt>
          <dd>{row.company?.name || row.companyId}</dd>
        </div>
        <div>
          <dt>Branch</dt>
          <dd>{row.branch?.name || row.branchId || '—'}</dd>
        </div>
        <div>
          <dt>Damaged quantity</dt>
          <dd>{damageQuantity(row)}</dd>
        </div>
        <div>
          <dt>Damage type</dt>
          <dd>{productLabel(row.damageType)}</dd>
        </div>
        <div>
          <dt>Estimated value</dt>
          <dd>{catalogueMoney(row.estimatedValue)}</dd>
        </div>
        <div>
          <dt>Batch</dt>
          <dd>{row.batch?.batchNumber || row.batchId || 'No linked batch'}</dd>
        </div>
        <div>
          <dt>Reported by</dt>
          <dd>{row.reportedBy?.fullName || row.reportedById || '—'}</dd>
        </div>
      </dl>
      {row.notes && <p className="inventory-damage-notes">{row.notes}</p>}
    </>
  );
}

export function InventoryActionReview({ kind, id, action, draftSource, onClose, onSaved }: Props) {
  const { hasPermission } = useAuth();
  const permission = useRef(hasPermission);
  useLayoutEffect(() => {
    permission.current = hasPermission;
  }, [hasPermission]);
  const spec =
    kind === 'adjustment'
      ? adjustmentActions[action as AdjustmentAction]
      : DAMAGE_ACTIONS[action as DamageAction];
  const readPermissions =
    kind === 'adjustment'
      ? ['inventory.view', 'inventory.adjustments.create']
      : ['stock_damage.view'];
  const allowed = hasPermission(spec.permission) && readPermissions.some((p) => hasPermission(p));
  const path =
    kind === 'adjustment'
      ? `/stock-adjustments/${encodeURIComponent(id)}`
      : `/westsides/stock-damage/${encodeURIComponent(id)}`;
  const result = useWorkspaceResource<Record>(path, {}, allowed);
  const [current, setCurrent] = useState<Record | null>(null);
  const row = allowed ? current || result.data : null;
  const stateKey = row ? snapshot(row) : draftSource?.context.stateKey || '';
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  useEffect(() => {
    if (row && openingKey === null) setOpeningKey(snapshot(row));
  }, [row, openingKey]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(false),
    mounted = useRef(true),
    reader = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reader.current?.abort();
    };
  }, []);
  const name = row
    ? 'damageNumber' in row
      ? row.damageNumber
      : adjustmentName(row)
    : draftSource?.summary || id;
  const draft = useWorkspaceDraftForm(
    { reason: '' },
    {
      appId: 'inventory',
      title: spec.label,
      describe: () => name,
      context: { kind: `${kind}-action`, recordId: id, action, stateKey },
      draftId: draftSource?.id,
      busy,
      onClose,
      needsReview:
        !!row &&
        ((!!draftSource && (!row.updatedAt || draftSource.context.stateKey !== stateKey)) ||
          (openingKey !== null && openingKey !== stateKey)),
      reviewKey: stateKey,
    },
  );
  const eligible =
    !!row && ('statuses' in spec ? spec.statuses.includes(row.status) : row.status === spec.status);
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  async function confirm() {
    if (pending.current || !allowed || !row || !eligible || result.loading || result.error) return;
    pending.current = true;
    setError('');
    // Claimed synchronously. saveNow() below awaits, and a second confirmation
    // inside that window would otherwise clear the guard above and run the
    // action twice.
        setBusy(true);
    try {
      draft.validateReview();
      await draft.saveNow();
      if (kind === 'adjustment' && action === 'reject' && !draft.form.reason.trim())
        throw new Error('Enter a reason for rejecting this adjustment.');
      if (kind === 'adjustment' && action === 'reject' && draft.form.reason.trim().length > 1000)
        throw new Error('Keep the rejection reason within 1,000 characters.');
      const controller = new AbortController();
      reader.current?.abort();
      reader.current = controller;
      const latest = await backendGet<Record>(path, { signal: controller.signal });
      if (!mounted.current || controller.signal.aborted) return;
      if (
        !permission.current(spec.permission) ||
        !readPermissions.some((p) => permission.current(p))
      )
        throw new Error(
          'Your current role no longer permits this action. Your draft is still kept.',
        );
      if (latest.id !== id)
        throw new Error('The current record could not be verified. Refresh before continuing.');
      if (snapshot(latest) !== stateKey) {
        setCurrent(latest);
        return;
      }
      if (kind === 'adjustment' && action === 'delete') await backendDelete(path);
      else if (kind === 'adjustment')
        await backendPatch(
          `${path}/${action}`,
          action === 'reject' ? { reason: draft.form.reason.trim() } : undefined,
        );
      else await backendPatch(`${path}/${action}`);
      if (mounted.current) {
        draft.markSaved();
        showToast(
          'success',
          kind === 'adjustment' ? 'Adjustment updated' : 'Damage report updated',
          name,
        );
        onSaved();
      }
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : 'Unable to complete this action.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const refresh = () => {
    if (pending.current) return;
    setCurrent(null);
    setError('');
    result.reload();
  };
  return (
    <Modal
      open
      title={spec.label}
      subtitle={name}
      size={kind === 'adjustment' ? '2xl' : 'lg'}
      onClose={close}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            {kind === 'adjustment' ? 'Back to review' : 'Back to register'}
          </Btn>
          {draft.canRetain && (
            <Btn variant="secondary" disabled={busy} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn
            variant={action === 'reject' || action === 'delete' ? 'danger' : 'primary'}
            loading={busy}
            disabled={
              !allowed ||
              !eligible ||
              result.loading ||
              !!result.error ||
              !draft.reviewed ||
              !!draft.availabilityError
            }
            onClick={() => void confirm()}
          >
            {spec.label}
          </Btn>
        </>
      }
    >
      <div
        className={kind === 'adjustment' ? 'inventory-adjustment-stack' : 'inventory-damage-stack'}
        {...draft.guard.capture}
      >
        <p>{spec.effect}</p>
        <DraftFormNotice draft={draft} />
        {!allowed ? (
          <p role="alert" className="workspace-notice">
            Your role does not permit this review action. You can keep the draft for later.
          </p>
        ) : result.loading ? (
          <PageSpinner
            label={`Loading current ${kind === 'adjustment' ? 'adjustment' : 'damage report'}`}
          />
        ) : result.error ? (
          <div role="alert" className="workspace-notice">
            <p>{result.error}</p>
            <Btn variant="secondary" onClick={refresh}>
              {kind === 'adjustment' ? 'Retry adjustment' : 'Retry report'}
            </Btn>
          </div>
        ) : row ? (
          <>
            <div className="inventory-damage-review-heading">
              <StatusBadge value={row.status} />
              <strong>{name}</strong>
            </div>
            {!eligible && (
              <p role="alert" className="workspace-notice">
                This {kind === 'adjustment' ? 'adjustment' : 'report'} is now{' '}
                {productLabel(row.status)}. Return to the register and refresh before choosing
                another action.
              </p>
            )}
            {'damageNumber' in row ? (
              <DamageDetails row={row} />
            ) : (
              <>
                <p>
                  {row.company?.name || row.companyId} ·{' '}
                  {row.branch?.name || row.branchId || 'No branch'}
                </p>
                <p>{row.reason}</p>
                {row.notes && <p className="inventory-adjustment-notes">{row.notes}</p>}
                <AdjustmentLines row={row} />
              </>
            )}
          </>
        ) : (
          <p role="alert">This record is unavailable.</p>
        )}
        {kind === 'adjustment' && action === 'reject' && (
          <FormTextarea
            label="Rejection reason"
            maxLength={1000}
            required
            value={draft.form.reason}
            disabled={busy || !allowed || !eligible}
            onChange={(e) => draft.setForm({ reason: e.target.value })}
          />
        )}
        {error && (
          <div role="alert" className="workspace-notice">
            <p>{error}</p>
            <Btn variant="ghost" disabled={busy} onClick={refresh}>
              {kind === 'adjustment' ? 'Refresh adjustment status' : 'Refresh report status'}
            </Btn>
          </div>
        )}
        {busy && <p role="status">Checking the current record and completing the action…</p>}
      </div>
    </Modal>
  );
}
