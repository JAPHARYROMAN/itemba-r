'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Btn,
  FormDateField,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  StatusBadge,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendGet, backendPatch, backendPost } from '@/lib/api-client';
import { formatAccountMoney } from '@/lib/account-consolidation';
import { notifyDeskSaved } from '@/components/workspace/linked-desk-changes';
import { useFormGuard } from '@/components/workspace/unsaved-work-provider';
import { useRequestGuard } from '@/hooks/use-request-guard';

export type AccountDocument = {
  id: string;
  companyId: string;
  currency: string;
  amount: number | string;
  outstandingAmount: number | string;
  status: string;
  sourceType?: string | null;
};

export type PaymentReplacement = {
  originalPaymentId: string;
  originalPaymentNumber: string;
  amount: string;
  paymentDate: string;
  cashAccountId: string;
  notes: string;
};

type Adjustment = {
  id: string;
  direction: 'INCREASE' | 'DECREASE';
  amount: number | string;
  currency: string;
  reason: string;
  transactionDate: string;
  status: 'POSTED' | 'REVERSED';
  reversalReason?: string | null;
};

type Payment = {
  id: string;
  kind: 'CUSTOMER_PAYMENT' | 'SUPPLIER_PAYMENT' | 'LEGACY_JOURNAL';
  paymentNumber: string;
  paymentDate: string;
  amount: number | string;
  allocatedAmount: number | string;
  currency: string;
  status: string;
  cashAccountId: string | null;
  cashAccountName: string | null;
  notes?: string | null;
  reversalReason?: string | null;
  canReverse: boolean;
  canCorrect: boolean;
  reversalEndpoint: string | null;
  reversalUnavailableReason: string | null;
  allocations: Array<{ documentId: string; documentNumber: string; amount: number | string }>;
};

type OffsetAccount = {
  id: string;
  companyId?: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  isActive?: boolean;
  isHeader?: boolean;
};

type Reversing =
  | { kind: 'adjustment'; row: Adjustment }
  | { kind: 'payment'; row: Payment; replace: boolean };
type AdjustmentForm = {
  direction: 'INCREASE' | 'DECREASE';
  amount: string;
  transactionDate: string;
  offsetAccountId: string;
  reason: string;
};
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const blankForm = (status?: string): AdjustmentForm => ({
  direction: status === 'PAID' ? 'INCREASE' : 'DECREASE',
  amount: '',
  transactionDate: today(),
  offsetAccountId: '',
  reason: '',
});
const list = <T,>(value: T[] | { data: T[] }): T[] => (Array.isArray(value) ? value : value.data);
const reasonValid = (reason: string) => reason.trim().length >= 3 && reason.trim().length <= 500;
const cents = (amount: number | string) => Math.round(Number(amount) * 100);
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'The request failed. Please try again.';

export function adjustmentUnavailableReason(document: AccountDocument) {
  if (document.sourceType === 'Expense') return 'Adjust this balance from the Expenses workflow.';
  if (document.sourceType === 'AccountAdjustment')
    return 'Reverse the original account adjustment to change this item.';
  if (['CANCELLED', 'VOIDED', 'WRITTEN_OFF'].includes(document.status))
    return 'Resolve this document’s cancellation or write-off before adjusting its balance.';
  return null;
}

/** Document-scoped history keeps corrections tied to their original accounting records. */
export function AccountTransactions({
  kind,
  document,
  initialMode = 'history',
  onClose,
  onChanged,
  onReplace,
}: {
  kind: 'receivables' | 'payables';
  document: AccountDocument;
  initialMode?: 'history' | 'adjust';
  onClose: () => void;
  onChanged: () => void;
  onReplace: (replacement: PaymentReplacement, restored: AccountDocument) => void;
}) {
  const { hasPermission } = useAuth();
  const canView = hasPermission(`${kind}.view`);
  const canManage = hasPermission(`${kind}.manage`);
  const paymentKind = kind === 'receivables' ? 'customer-payments' : 'supplier-payments';
  const canReversePayments = hasPermission(`${paymentKind}.manage`);
  const canReversePayment = (payment: Payment) =>
    payment.kind === 'LEGACY_JOURNAL' ? canManage : canReversePayments;
  const base = `/${kind}/${encodeURIComponent(document.id)}`;
  const [current, setCurrent] = useState(document);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [recordReady, setRecordReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState(() => blankForm(document.status));
  const [showForm, setShowForm] = useState(initialMode === 'adjust' && canManage);
  const [offsets, setOffsets] = useState<OffsetAccount[]>([]);
  const [offsetError, setOffsetError] = useState('');
  const [offsetLoading, setOffsetLoading] = useState(false);
  const [offsetRevision, setOffsetRevision] = useState(0);
  const [reversing, setReversing] = useState<Reversing | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [reversalDate, setReversalDate] = useState(today);
  const [pendingReplacement, setPendingReplacement] = useState<Payment | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const intent = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const beginRequest = useRequestGuard();
  const draft = useFormGuard({ form, reversalReason }, (value) => {
    setForm(value.form);
    setReversalReason(value.reversalReason);
  });
  const unavailable = adjustmentUnavailableReason(current);

  const load = useCallback(async () => {
    if (!canView) return null;
    const request = beginRequest();
    setLoading(true);
    setRecordReady(false);
    const results = await Promise.allSettled([
      backendGet<AccountDocument>(base, { signal: request.signal }),
      backendGet<Adjustment[] | { data: Adjustment[] }>(`${base}/adjustments`, {
        signal: request.signal,
      }),
      backendGet<Payment[] | { data: Payment[] }>(`${base}/payments`, { signal: request.signal }),
    ]);
    if (!request.current()) return null;
    const [record, adjustmentResult, paymentResult] = results;
    if (record.status === 'fulfilled') setCurrent(record.value);
    setRecordReady(record.status === 'fulfilled');
    if (adjustmentResult.status === 'fulfilled') setAdjustments(list(adjustmentResult.value));
    if (paymentResult.status === 'fulfilled') setPayments(list(paymentResult.value));
    const failure = results.find((result) => result.status === 'rejected');
    setError(failure?.status === 'rejected' ? message(failure.reason) : '');
    setLoading(false);
    return record.status === 'fulfilled' ? record.value : null;
  }, [base, beginRequest, canView]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!showForm || !canView || !canManage || unavailable) return;
    const controller = new AbortController();
    setOffsetLoading(true);
    setOffsetError('');
    backendGet<OffsetAccount[] | { data: OffsetAccount[] }>(`${base}/adjustments/offset-accounts`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted)
          setOffsets(
            list(value).filter(
              (account) =>
                account.isActive !== false &&
                !account.isHeader &&
                (!account.companyId || account.companyId === current.companyId),
            ),
          );
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setOffsetError(message(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setOffsetLoading(false);
      });
    return () => controller.abort();
  }, [base, canManage, canView, current.companyId, offsetRevision, showForm, unavailable]);

  const changed = () => {
    onChanged();
    notifyDeskSaved('cash-desk');
  };
  const replace = (payment: Payment, restored: AccountDocument) => {
    draft.markSaved();
    onReplace(
      {
        originalPaymentId: payment.id,
        originalPaymentNumber: payment.paymentNumber,
        amount: Number(payment.allocatedAmount).toFixed(2),
        paymentDate: payment.paymentDate.slice(0, 10),
        cashAccountId: payment.cashAccountId ?? '',
        notes: `Replacement for reversed payment ${payment.paymentNumber}.`,
      },
      restored,
    );
  };

  const submitAdjustment = async () => {
    if (!canManage || unavailable || !recordReady || inFlight.current) return;
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || cents(amount) <= 0)
      return setError('Enter a positive adjustment amount.');
    if (form.direction === 'DECREASE' && cents(amount) > cents(current.outstandingAmount))
      return setError('A decrease cannot exceed the current outstanding balance.');
    if (!form.transactionDate) return setError('Adjustment date is required.');
    if (!reasonValid(form.reason)) return setError('Enter a reason between 3 and 500 characters.');
    if (!offsets.some((account) => account.id === form.offsetAccountId))
      return setError('Choose an eligible offset account.');
    const payload = { ...form, amount, reason: form.reason.trim() };
    const fingerprint = JSON.stringify(payload);
    // Keep the intent after an uncertain response: a changed retry must conflict
    // with the original payload on the server, rather than create a second item.
    if (!intent.current) intent.current = { fingerprint, requestId: crypto.randomUUID() };
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await backendPost(`${base}/adjustments`, { ...payload, requestId: intent.current.requestId });
      intent.current = null;
      draft.markSaved();
      setShowForm(false);
      setForm(blankForm(current.status));
      setNotice('Balance adjustment posted. No cash was moved.');
      changed();
      await load();
    } catch (failure) {
      setError(message(failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const submitReversal = async () => {
    if (!reversing || inFlight.current) return;
    if (!reasonValid(reversalReason))
      return setError('Enter a reversal reason between 3 and 500 characters.');
    if (reversing.kind === 'adjustment' && !reversalDate)
      return setError('Reversal date is required.');
    if (
      reversing.kind === 'adjustment'
        ? !canManage
        : !canReversePayment(reversing.row) || !reversing.row.canReverse
    )
      return;
    const selection = reversing;
    if (
      selection.kind === 'payment' &&
      selection.replace &&
      (!selection.row.canCorrect || selection.row.kind === 'LEGACY_JOURNAL' || !canManage)
    )
      return;
    const canonicalEndpoint =
      selection.kind === 'payment'
        ? selection.row.kind === 'LEGACY_JOURNAL'
          ? `${base}/payments/${encodeURIComponent(selection.row.id)}/reverse`
          : `/${paymentKind}/${encodeURIComponent(selection.row.id)}/reverse`
        : null;
    if (selection.kind === 'payment' && selection.row.reversalEndpoint !== canonicalEndpoint)
      return setError(
        selection.row.reversalUnavailableReason ??
          'Reverse this transaction in its original workflow.',
      );
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await backendPatch(
        selection.kind === 'adjustment'
          ? `${base}/adjustments/${encodeURIComponent(selection.row.id)}/reverse`
          : canonicalEndpoint!,
        {
          reason: reversalReason.trim(),
          ...(selection.kind === 'adjustment' ? { transactionDate: reversalDate } : {}),
        },
      );
      draft.markSaved();
      if (selection.kind === 'payment')
        setPayments((rows) =>
          rows.map((row) =>
            row.id === selection.row.id && row.kind === selection.row.kind
              ? { ...row, status: 'REVERSED', canReverse: false, canCorrect: false }
              : row,
          ),
        );
      else
        setAdjustments((rows) =>
          rows.map((row) => (row.id === selection.row.id ? { ...row, status: 'REVERSED' } : row)),
        );
      setReversing(null);
      setReversalReason('');
      setNotice(
        selection.kind === 'payment'
          ? 'Payment reversed. Its original record remains in history.'
          : 'Balance adjustment reversed. No cash was moved.',
      );
      changed();
      const restored = await load();
      if (selection.kind === 'payment' && selection.replace) {
        if (restored) replace(selection.row, restored);
        else setPendingReplacement(selection.row);
      }
    } catch (failure) {
      setError(message(failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (!canView)
    return (
      <Modal open title="Account transactions" onClose={onClose}>
        <p>Access restricted.</p>
      </Modal>
    );
  const balance = cents(current.outstandingAmount);
  const impact = Number.isFinite(Number(form.amount)) ? cents(form.amount) : 0;
  const after = form.direction === 'INCREASE' ? balance + impact : Math.max(0, balance - impact);
  const beginReversal = (selection: Reversing) => {
    setReversing(selection);
    setShowForm(false);
    setReversalReason('');
    setReversalDate(today());
    setError('');
  };

  return (
    <Modal
      open
      title="Account transactions"
      subtitle={`${kind === 'receivables' ? 'Receivable' : 'Payable'} · ${current.currency}`}
      size="2xl"
      onClose={() => {
        if (!busy) draft.requestClose(onClose);
      }}
      onChangeCapture={draft.touch}
      footer={
        <Btn variant="secondary" disabled={busy} onClick={() => draft.requestClose(onClose)}>
          Close
        </Btn>
      }
    >
      <div className="space-y-5">
        {notice && <p role="status">{notice}</p>}
        {error && (
          <div role="alert">
            {error}{' '}
            <Btn variant="ghost" size="xs" disabled={busy} onClick={() => void load()}>
              Refresh history
            </Btn>
          </div>
        )}
        {loading && <p role="status">Loading account transactions…</p>}
        <p>
          Current outstanding:{' '}
          <strong>{formatAccountMoney(current.outstandingAmount, current.currency)}</strong>
        </p>
        {canManage && (
          <Btn
            variant="secondary"
            disabled={busy || loading || !recordReady || !!unavailable}
            onClick={() => {
              setShowForm(true);
              setReversing(null);
              setError('');
            }}
          >
            New balance adjustment
          </Btn>
        )}
        {unavailable && <p>{unavailable}</p>}
        {pendingReplacement && (
          <div>
            <p>The payment was reversed. Refresh the balance before entering its replacement.</p>
            <Btn
              disabled={busy}
              onClick={async () => {
                const restored = await load();
                if (restored) replace(pendingReplacement, restored);
              }}
            >
              Continue replacement
            </Btn>
          </div>
        )}
        {showForm && canManage && !unavailable && (
          <section aria-label="New balance adjustment" className="space-y-3 rounded-lg border p-4">
            <h3 className="font-semibold">Non-cash balance adjustment</h3>
            <p>
              This changes the account balance without receiving or paying cash. An increase creates
              a separate account item. A decrease applies only to this item’s outstanding balance.
            </p>
            <FormSelect
              disabled={busy}
              label="Adjustment direction"
              value={form.direction}
              onChange={(event) =>
                setForm({ ...form, direction: event.target.value as AdjustmentForm['direction'] })
              }
              options={[
                { value: 'DECREASE', label: 'Decrease amount owed' },
                { value: 'INCREASE', label: 'Increase amount owed' },
              ]}
            />
            <FormInput
              disabled={busy}
              label="Adjustment amount"
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
              required
            />
            <FormDateField
              disabled={busy}
              label="Adjustment date"
              value={form.transactionDate}
              onChange={(value) => setForm({ ...form, transactionDate: value })}
              required
            />
            <FormSelect
              label="Offset account"
              value={form.offsetAccountId}
              onChange={(event) => setForm({ ...form, offsetAccountId: event.target.value })}
              disabled={busy || offsetLoading || !!offsetError}
              placeholder={offsetLoading ? 'Loading accounts…' : 'Choose offset account'}
              options={offsets.map((account) => ({
                value: account.id,
                label: `${account.accountCode} · ${account.accountName} · ${account.accountType}`,
              }))}
              required
            />
            {offsetError && (
              <p role="alert">
                {offsetError}{' '}
                <Btn
                  variant="ghost"
                  size="xs"
                  onClick={() => setOffsetRevision((value) => value + 1)}
                >
                  Retry accounts
                </Btn>
              </p>
            )}
            <FormTextarea
              disabled={busy}
              label="Adjustment reason"
              value={form.reason}
              maxLength={500}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
              required
            />
            <p aria-label="Adjustment impact">
              Before: {formatAccountMoney(balance / 100, current.currency)}. After
              {form.direction === 'INCREASE' ? ' including the separate new item' : ''}:{' '}
              {formatAccountMoney(after / 100, current.currency)}.
            </p>
            <Btn
              loading={busy}
              disabled={loading || !recordReady || offsetLoading || !!offsetError}
              onClick={() => void submitAdjustment()}
            >
              Post balance adjustment
            </Btn>
            <Btn variant="ghost" disabled={busy} onClick={() => setShowForm(false)}>
              Cancel adjustment
            </Btn>
          </section>
        )}
        {reversing && (
          <section aria-label="Transaction reversal" className="space-y-3 rounded-lg border p-4">
            <h3 className="font-semibold">
              {reversing.kind === 'payment' && reversing.replace
                ? 'Reverse and replace payment'
                : 'Reverse transaction'}
            </h3>
            <p>
              {reversing.kind === 'adjustment'
                ? 'This reverses the non-cash adjustment and preserves its original record.'
                : `This reverses the entire payment ${reversing.row.paymentNumber} (${formatAccountMoney(reversing.row.amount, reversing.row.currency)}), restoring every allocation.`}
            </p>
            {reversing.kind === 'payment' && reversing.row.allocations.length > 1 && (
              <ul>
                {reversing.row.allocations.map((allocation) => (
                  <li key={allocation.documentId}>
                    {allocation.documentNumber}:{' '}
                    {formatAccountMoney(allocation.amount, reversing.row.currency)}
                  </li>
                ))}
              </ul>
            )}
            {reversing.kind === 'payment' && reversing.replace && (
              <p>
                The original payment is reversed first. Then review the replacement amount, date and
                cash / bank account and submit a new payment.
              </p>
            )}
            <FormTextarea
              disabled={busy}
              label="Reversal reason"
              value={reversalReason}
              maxLength={500}
              onChange={(event) => setReversalReason(event.target.value)}
              required
            />
            {reversing.kind === 'adjustment' && (
              <FormDateField
                disabled={busy}
                label="Reversal date"
                value={reversalDate}
                onChange={setReversalDate}
                required
              />
            )}
            <Btn variant="danger" loading={busy} onClick={() => void submitReversal()}>
              {reversing.kind === 'payment' && reversing.replace
                ? 'Reverse and review replacement'
                : 'Confirm reversal'}
            </Btn>
            <Btn variant="ghost" disabled={busy} onClick={() => setReversing(null)}>
              Cancel reversal
            </Btn>
          </section>
        )}
        <section aria-label="Payment history" className="space-y-3">
          <h3 className="font-semibold">Payments</h3>
          {!loading && !payments.length && <p>No payment transactions recorded.</p>}
          {payments.map((payment) => (
            <article
              key={`${payment.kind}:${payment.id}`}
              className="rounded-lg border p-3 space-y-2"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <strong>{payment.paymentNumber}</strong>
                <StatusBadge status={payment.status} />
              </div>
              <p>
                {payment.paymentDate.slice(0, 10)} ·{' '}
                {formatAccountMoney(payment.allocatedAmount, payment.currency)} allocated here ·{' '}
                {payment.cashAccountName || 'Cash account not recorded'}
              </p>
              {payment.reversalUnavailableReason && <p>{payment.reversalUnavailableReason}</p>}
              {payment.status === 'REVERSED' && payment.reversalReason && (
                <p>Reversal reason: {payment.reversalReason}</p>
              )}
              {payment.canReverse && canReversePayment(payment) && (
                <Btn
                  variant="danger"
                  size="xs"
                  disabled={busy || loading}
                  onClick={() => beginReversal({ kind: 'payment', row: payment, replace: false })}
                >
                  Reverse {payment.paymentNumber}
                </Btn>
              )}
              {payment.canReverse &&
                payment.canCorrect &&
                payment.kind !== 'LEGACY_JOURNAL' &&
                canReversePayment(payment) &&
                canManage && (
                  <Btn
                    variant="secondary"
                    size="xs"
                    disabled={busy || loading}
                    onClick={() => beginReversal({ kind: 'payment', row: payment, replace: true })}
                  >
                    Correct {payment.paymentNumber}
                  </Btn>
                )}
              {payment.canReverse && !payment.canCorrect && (
                <p>
                  {payment.kind === 'LEGACY_JOURNAL'
                    ? 'After reversal, close this history and use Pay to record a corrected payment.'
                    : payment.allocations.length > 1
                      ? 'Replacement requires the payment allocation workflow because this payment covers multiple account items.'
                      : 'Record a replacement from the original payment workflow so all allocations and advances stay together.'}
                </p>
              )}
            </article>
          ))}
        </section>
        <section aria-label="Adjustment history" className="space-y-3">
          <h3 className="font-semibold">Balance adjustments</h3>
          {!loading && !adjustments.length && <p>No balance adjustments recorded.</p>}
          {adjustments.map((adjustment) => (
            <article key={adjustment.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex flex-wrap justify-between gap-2">
                <strong>
                  {adjustment.direction === 'INCREASE' ? 'Increase' : 'Decrease'} ·{' '}
                  {formatAccountMoney(adjustment.amount, adjustment.currency)}
                </strong>
                <StatusBadge status={adjustment.status} />
              </div>
              <p>
                {adjustment.transactionDate.slice(0, 10)} · {adjustment.reason}
              </p>
              {adjustment.status === 'REVERSED' && adjustment.reversalReason && (
                <p>Reversal reason: {adjustment.reversalReason}</p>
              )}
              {canManage && adjustment.status === 'POSTED' && (
                <Btn
                  variant="danger"
                  size="xs"
                  disabled={busy || loading}
                  onClick={() => beginReversal({ kind: 'adjustment', row: adjustment })}
                >
                  Reverse adjustment
                </Btn>
              )}
            </article>
          ))}
        </section>
      </div>
    </Modal>
  );
}
