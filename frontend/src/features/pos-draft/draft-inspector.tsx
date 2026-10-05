'use client';
import { useState, type ReactNode } from 'react';
import { ArrowUpRight, Check, PackageCheck, X } from 'lucide-react';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import type { Draft, DraftAction, DraftContext } from './types';
import { KIND_LABELS, STATUS_LABELS, money, postedHref } from './types';

function OfficeReference({
  enabled,
  href,
  children,
}: {
  enabled: boolean;
  href: string;
  children: ReactNode;
}) {
  return enabled ? <Link href={href}>{children}</Link> : <span>{children}</span>;
}

export function DraftInspector({
  draft,
  context,
  decide,
  onChanged,
  onClose,
  onCorrect,
  onReceipt,
  officeLinks = true,
}: {
  draft: Draft;
  context?: DraftContext | null;
  decide: (
    id: string,
    action: Exclude<DraftAction, 'correct'>,
    body: {
      revision: number;
      reason?: string;
      duplicateReason?: string;
      reviewedCandidateIds?: string[];
      fundsReturned?: boolean;
      reference?: string;
    },
  ) => Promise<Draft>;
  onChanged: (draft: Draft) => void;
  onClose: () => void;
  onCorrect?: (draft: Draft) => void;
  onReceipt?: (draft: Draft) => Promise<void>;
  officeLinks?: boolean;
}) {
  const [reason, setReason] = useState('');
  const [returnReason, setReturnReason] = useState(''),
    [returnReference, setReturnReference] = useState(''),
    [fundsReturned, setFundsReturned] = useState(false);
  const [duplicateReason, setDuplicateReason] = useState('');
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [busy, setBusy] = useState<DraftAction | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<Exclude<DraftAction, 'correct'> | null>(null);
  const actions = draft.allowedActions ?? [];
  const candidates = draft.duplicateCandidates ?? [];
  const link = postedHref(draft);
  const customer = context?.customers.find((item) => item.id === draft.payload.customerId);
  const order = context?.purchaseOrders.find((item) => item.id === draft.payload.purchaseOrderId);
  const duplicateChecked =
    !candidates.length ||
    (reviewed.length === candidates.length && duplicateReason.trim().length >= 5);
  const label = (action: Exclude<DraftAction, 'correct'>) =>
    action === 'approve'
      ? draft.status === 'SUBMITTED' && draft.originRole === 'CASHIER' && draft.kind === 'SALE'
        ? 'Approve and send to stockist'
        : 'Approve and post'
      : action === 'prepare'
        ? 'Confirm stock prepared'
        : action === 'direct-post'
          ? 'Post directly'
          : action === 'confirm-return'
            ? 'Confirm full funds returned'
            : 'Reject request';
  async function action(action: Exclude<DraftAction, 'correct'>) {
    if (busy) return;
    setError('');
    if (action === 'reject' && !reason.trim()) {
      setError('Enter a rejection reason.');
      return;
    }
    if (action === 'confirm-return' && (!fundsReturned || returnReason.trim().length < 5)) {
      setError('Confirm the full funds were returned and explain how the return was verified.');
      return;
    }
    if (['approve', 'direct-post'].includes(action) && !duplicateChecked) {
      setError('Review every possible duplicate and explain why this is a separate request.');
      return;
    }
    if (confirm !== action) {
      setConfirm(action);
      return;
    }
    setBusy(action);
    try {
      const result = await decide(draft.id, action, {
        revision: draft.revision,
        ...(action === 'reject' ? { reason: reason.trim() } : {}),
        ...(action === 'confirm-return'
          ? {
              reason: returnReason.trim(),
              reference: returnReference.trim() || undefined,
              fundsReturned: true,
            }
          : {}),
        ...(candidates.length && ['approve', 'direct-post'].includes(action)
          ? { reviewedCandidateIds: reviewed, duplicateReason: duplicateReason.trim() }
          : {}),
      });
      setConfirm(null);
      onChanged(result);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not update this request. Refresh and try again.',
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="pd-inspector" aria-label="Request details" tabIndex={-1}>
      <div className="pd-inspector-heading">
        <div>
          <span className="pd-eyebrow">{KIND_LABELS[draft.kind]}</span>
          <h2>
            {draft.kind === 'SALE' ? money(draft.amount, draft.currency) : KIND_LABELS[draft.kind]}
          </h2>
          <span className="pd-status" data-status={draft.status}>
            {STATUS_LABELS[draft.status] ?? draft.status}
          </span>
        </div>
        <button className="pd-icon-button" onClick={onClose} aria-label="Close request details">
          <X size={18} />
        </button>
      </div>
      <dl className="pd-facts">
        <div>
          <dt>From</dt>
          <dd>
            {draft.originUser?.fullName ?? draft.originUser?.name ?? draft.originRole.toLowerCase()}
          </dd>
        </div>
        <div>
          <dt>Business date</dt>
          <dd>{draft.businessDate}</dd>
        </div>
        <div>
          <dt>Branch</dt>
          <dd>
            {draft.branch?.name ??
              context?.branches.find((branch) => branch.id === draft.branchId)?.name ??
              'Assigned branch'}
          </dd>
        </div>
        <div>
          <dt>Captured</dt>
          <dd>{new Date(draft.capturedAt).toLocaleString()}</dd>
        </div>
        {Number(draft.pendingMoney) > 0 && (
          <div>
            <dt>Pending money</dt>
            <dd>{money(draft.pendingMoney, draft.currency)}</dd>
          </div>
        )}
      </dl>
      {draft.blockingReason && (
        <p className="pd-error" role="alert">
          {draft.blockingReason}
        </p>
      )}
      {draft.status !== 'POSTED' && draft.status !== 'REJECTED' && (
        <p className="pd-notice">
          {draft.status === 'AWAITING_STOCKIST'
            ? 'Approval is recorded. A stockist must confirm preparation before the final approval.'
            : draft.status === 'READY_FINAL'
              ? 'Stock preparation is confirmed. Final approval posts the transaction.'
              : 'This request has not posted money or stock.'}
        </p>
      )}
      {draft.status === 'REJECTED' && Number(draft.pendingMoney) > 0 && (
        <p className="pd-notice">
          This request was rejected. {money(draft.pendingMoney, draft.currency)} remains with the
          operator until the full funds are returned and an administrator verifies the return.
        </p>
      )}
      {draft.payload.customerId && (
        <p>
          <span className="pd-muted">Customer · </span>
          <OfficeReference
            enabled={officeLinks}
            href={`/sales-desk/customers/${encodeURIComponent(draft.payload.customerId)}`}
          >
            {customer?.name ?? (officeLinks ? 'Open customer' : 'Customer')}{' '}
            {officeLinks && <ArrowUpRight size={12} />}
          </OfficeReference>
        </p>
      )}
      {draft.payload.paymentMethod && (
        <p>
          <span className="pd-muted">Payment · </span>
          {draft.payload.paymentMethod.toLowerCase().replaceAll('_', ' ')}
        </p>
      )}
      {(draft.payload.paymentReference || draft.payload.reference) && (
        <p>
          <span className="pd-muted">Reference · </span>
          {draft.payload.paymentReference ?? draft.payload.reference}
        </p>
      )}
      {draft.payload.salesOrderId && (
        <p>
          <OfficeReference
            enabled={officeLinks}
            href={`/sales-desk/sales/${encodeURIComponent(draft.payload.salesOrderId)}`}
          >
            {officeLinks ? 'Open sale' : 'Sale'} {officeLinks && <ArrowUpRight size={12} />}
          </OfficeReference>{' '}
          · {money(draft.payload.amount, draft.currency)}
        </p>
      )}
      {draft.payload.purchaseOrderId && (
        <p>
          <OfficeReference
            enabled={officeLinks}
            href={`/operations/purchase-orders/${encodeURIComponent(draft.payload.purchaseOrderId)}`}
          >
            {order?.purchaseOrderNumber ?? (officeLinks ? 'Open purchase order' : 'Purchase order')}{' '}
            {officeLinks && <ArrowUpRight size={12} />}
          </OfficeReference>
          {order?.supplierName && ` · ${order.supplierName}`}
        </p>
      )}
      {order && (
        <section aria-label="Full purchase order receipt">
          <div className="pd-detail-lines">
            {order.lines.map((line) => (
              <div key={line.productId}>
                <strong>{line.name}</strong>
                <span>
                  {line.quantity} × {money(line.unitCost, order.currency)}
                </span>
                <small>{money(line.lineTotal, order.currency)}</small>
              </div>
            ))}
          </div>
          <p>
            <strong>{money(order.totalAmount, order.currency)}</strong> ·{' '}
            {order.purchaseType.toLowerCase().replaceAll('_', ' ')}
            {order.paymentTerms ? ` · ${order.paymentTerms}` : ''}
          </p>
          <p className="pd-notice">
            {draft.payload.fullOrderArrived
              ? 'The stockist confirmed that the whole order arrived.'
              : 'Full-order arrival has not been confirmed.'}
          </p>
        </section>
      )}
      {draft.payload.destinationBranchId && (
        <p>
          <span className="pd-muted">Destination · </span>
          {context?.branches.find((branch) => branch.id === draft.payload.destinationBranchId)
            ?.name ?? 'Destination branch'}
        </p>
      )}
      {draft.payload.lines?.length ? (
        <div className="pd-detail-lines">
          {draft.payload.lines.map((line) => {
            const product = context?.products.find((item) => item.id === line.productId);
            return (
              <div key={line.productId}>
                <OfficeReference
                  enabled={officeLinks}
                  href={`/inventory/products/${encodeURIComponent(line.productId)}`}
                >
                  {product?.name ?? (officeLinks ? 'Open product' : 'Product')}
                </OfficeReference>
                <strong>
                  {line.countedQuantity !== undefined
                    ? `Counted ${line.countedQuantity} · baseline ${line.baselineQuantity}`
                    : `${line.quantity} ${product?.unitSymbol ?? ''}`}
                </strong>
                {line.unitPrice !== undefined && (
                  <small>
                    {money(line.unitPrice, draft.currency)} each
                    {line.priceReason
                      ? ` · ${line.priceReason.toLowerCase().replaceAll('_', ' ')}`
                      : ''}
                  </small>
                )}
                {line.priceNote && <small>{line.priceNote}</small>}
                {line.listUnitPrice !== undefined && line.listUnitPrice !== line.unitPrice && (
                  <small>List price {money(line.listUnitPrice, draft.currency)} each</small>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
      {draft.payload.productId && (
        <p>
          <OfficeReference
            enabled={officeLinks}
            href={`/inventory/products/${encodeURIComponent(draft.payload.productId)}`}
          >
            {context?.products.find((item) => item.id === draft.payload.productId)?.name ??
              (officeLinks ? 'Open product' : 'Product')}
          </OfficeReference>{' '}
          · {draft.payload.quantity} ·{' '}
          {draft.payload.damageType?.toLowerCase().replaceAll('_', ' ')}
        </p>
      )}
      {draft.payload.reason && <p>{draft.payload.reason}</p>}
      {candidates.length > 0 && (
        <section className="pd-duplicate-review">
          <h3>Possible duplicates</h3>
          <p className="pd-muted">Check these requests before approving.</p>
          {candidates.map((candidate) => (
            <label key={candidate.id} className="pd-check">
              <input
                type="checkbox"
                checked={reviewed.includes(candidate.id)}
                onChange={(e) =>
                  setReviewed((current) =>
                    e.target.checked
                      ? [...current, candidate.id]
                      : current.filter((id) => id !== candidate.id),
                  )
                }
              />
              <span>
                <OfficeReference
                  enabled={officeLinks}
                  href={`/pos-draft/requests/${encodeURIComponent(candidate.id)}`}
                >
                  {candidate.businessDate} · {money(candidate.amount, draft.currency)}
                </OfficeReference>
                <small>
                  {STATUS_LABELS[candidate.status as keyof typeof STATUS_LABELS] ??
                    candidate.status}
                </small>
              </span>
            </label>
          ))}
          <label className="pd-field">
            Why is this a separate request?
            <textarea
              value={duplicateReason}
              onChange={(e) => setDuplicateReason(e.target.value)}
              rows={2}
            />
          </label>
        </section>
      )}
      {draft.decisions?.length ? (
        <section className="pd-decision-history">
          <h3>Decision history</h3>
          {draft.decisions.map((decision) => (
            <div key={decision.id}>
              <strong>{decision.action.toLowerCase().replaceAll('_', ' ')}</strong>
              <small>
                {decision.actor?.fullName ??
                  (decision.actorId === 'system:pos-draft-reservation-expiry' ? 'System' : '')}{' '}
                · {new Date(decision.createdAt).toLocaleString()}
              </small>
              {decision.reason && <p>{decision.reason}</p>}
            </div>
          ))}
        </section>
      ) : null}
      {officeLinks && link && (
        <Link className="pd-button pd-primary" href={link}>
          Open posted document <ArrowUpRight size={16} />
        </Link>
      )}
      {draft.status === 'POSTED' && draft.kind === 'SALE' && onReceipt && (
        <button
          className="pd-button"
          disabled={!!busy}
          onClick={() => {
            setBusy('approve');
            setError('');
            void onReceipt(draft)
              .catch((error) =>
                setError(
                  error instanceof Error ? error.message : 'Could not open the posted receipt.',
                ),
              )
              .finally(() => setBusy(null));
          }}
        >
          Print posted receipt
        </button>
      )}
      {actions.includes('reject') && (
        <label className="pd-field">
          Rejection reason
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setConfirm(null);
            }}
            placeholder="Explain what needs to change"
          />
        </label>
      )}
      {actions.includes('confirm-return') && (
        <section aria-label="Verify returned funds">
          <h3>Funds to return · {money(draft.pendingMoney, draft.currency)}</h3>
          <label className="pd-check">
            <input
              type="checkbox"
              checked={fundsReturned}
              onChange={(event) => {
                setFundsReturned(event.target.checked);
                setConfirm(null);
              }}
            />
            <span>I verified that the full pending funds were returned.</span>
          </label>
          <label className="pd-field">
            Return verification
            <textarea
              rows={2}
              value={returnReason}
              onChange={(event) => {
                setReturnReason(event.target.value);
                setConfirm(null);
              }}
              placeholder="Who received the return and how it was checked"
            />
          </label>
          <label className="pd-field">
            Return reference · optional
            <input
              value={returnReference}
              onChange={(event) => {
                setReturnReference(event.target.value);
                setConfirm(null);
              }}
            />
          </label>
          <p className="pd-muted">
            Confirmation clears this pending-funds task and records the verification. It does not
            post a cash receipt or payment.
          </p>
        </section>
      )}
      {confirm && (
        <p className="pd-notice" role="status">
          {label(confirm)}? Check the request above and select Confirm to continue.
        </p>
      )}
      {error && (
        <p className="pd-error" role="alert">
          {error}
        </p>
      )}
      <div className="pd-decision-actions">
        {actions
          .filter((action): action is Exclude<DraftAction, 'correct'> => action !== 'correct')
          .map((value) => (
            <button
              key={value}
              className={`pd-button ${value === 'reject' ? 'pd-danger' : 'pd-primary'}`}
              disabled={!!busy || (['approve', 'direct-post'].includes(value) && !duplicateChecked)}
              onClick={() => void action(value)}
            >
              {value === 'prepare' ? (
                <PackageCheck size={16} />
              ) : value === 'reject' ? (
                <X size={16} />
              ) : (
                <Check size={16} />
              )}
              {busy === value
                ? 'Saving…'
                : confirm === value
                  ? `Confirm · ${label(value)}`
                  : label(value)}
            </button>
          ))}
        {actions.includes('correct') && onCorrect && (
          <button className="pd-button" disabled={!!busy} onClick={() => onCorrect(draft)}>
            Correct request
          </button>
        )}
        {confirm && (
          <button className="pd-button" onClick={() => setConfirm(null)} disabled={!!busy}>
            Keep reviewing
          </button>
        )}
      </div>
    </section>
  );
}
