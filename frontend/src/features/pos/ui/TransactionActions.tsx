'use client';

import { sharePdfDocument } from '../core/pos-receipt';
import { useCallback, useEffect, useId, useState } from 'react';
import { backendGet, backendPost } from '@/lib/api-client';
import type { MobilePosLiteBinding } from '@/lib/mobile-pos-lite-store';
import type { PosTranslate, Session } from '../core/pos-types';
import { money, terminalHeaders } from '../core/pos-utils';
import { posRefusalStatus } from '../core/pos-errors';
import { terminalOperation } from '../core/terminal-control';
import {
  clearPosAction,
  readPosAction,
  savePosAction,
  type PosAction,
} from '../core/pos-actions-store';

export type TransactionDetail = {
  actions?: Array<{ requestId: string; kind: string; result: { number?: string } }>;
  id: string;
  number: string;
  total: number;
  outstanding: number;
  tenders: Array<{ method: string; amount: number; reference: string | null }>;
  collections: Array<{ number: string; amount: number; method: string }>;
  returns: Array<{
    number: string;
    total: number;
    debtReduced: number;
    refunds: Array<{ number: string; amount: number; status: string }>;
  }>;
  lines: Array<{
    id: string;
    name: string;
    quantity: number;
    returnable: number;
    unitPrice: number;
    stock: boolean;
  }>;
  canCollect: boolean;
  canReturn: boolean;
  canRefund: boolean;
};
export function TransactionActions({
  binding,
  session,
  saleId,
  online,
  owned,
  t,
  onChanged,
  onDetail,
}: {
  binding: MobilePosLiteBinding;
  session: Session;
  saleId: string | null;
  online: boolean;
  owned: boolean;
  t: PosTranslate;
  onChanged: () => void;
  onDetail?: (detail: TransactionDetail | null) => void;
}) {
  const id = useId();
  const key = `pos-action-v1:${session.terminal.id}:${session.company.id}:${session.division.id}:${session.branch.id}:${session.rep.id}`;
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [pending, setPending] = useState<PosAction | null>(null);
  const [form, setForm] = useState<'collection' | 'return' | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(
    session.paymentMethods.find((m) => m.code !== 'CREDIT')?.code ?? 'CASH',
  );
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [dispositions, setDispositions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setPending(null);
    readPosAction(key)
      .then((value) => {
        if (active) setPending(value);
      })
      .catch(() => {
        if (active) setError(t('posSaveFailed'));
      });
    return () => {
      active = false;
    };
  }, [key, t]);
  useEffect(() => {
    let active = true;
    setDetail(null);
    onDetail?.(null);
    setForm(null);
    setError('');
    setAmount('');
    setReference('');
    setReason('');
    setQuantities({});
    setDispositions({});
    if (saleId && online)
      backendGet<TransactionDetail>(`/mobile-pos-lite/transactions/${saleId}`, {
        headers: terminalHeaders(binding),
      })
        .then((value) => {
          if (active) {
            setDetail(value);
            onDetail?.(value);
          }
        })
        .catch((e: unknown) => {
          if (active) setError(e instanceof Error ? e.message : t('posHistoryFailed'));
        });
    return () => {
      active = false;
    };
  }, [binding, saleId, online, revision, t, onDetail]);
  const acknowledge = useCallback(
    async (action: PosAction, result: { number?: string }) => {
      await clearPosAction(key, action.requestId);
      setPending(null);
      setForm(null);
      setDone(result.number ?? t('posPaid'));
      setRevision((v) => v + 1);
      onChanged();
    },
    [key, t, onChanged],
  );
  async function send(action: PosAction) {
    if (!online || !owned || busy) return;
    setBusy(true);
    setError('');
    setDone('');
    try {
      await terminalOperation(session.terminal.code, async () => {
        // Durable intent precedes every POST. Retry first observes the original key.
        await savePosAction(key, action);
        setPending(action);
        const outcome = await backendGet<{ state: string; result?: { number?: string } }>(
          `/mobile-pos-lite/transactions/requests/${action.requestId}`,
          { headers: terminalHeaders(binding) },
        );
        if (outcome.state === 'confirmed' && outcome.result)
          return acknowledge(action, outcome.result);
        const result = await backendPost<{ number?: string }>(
          `/mobile-pos-lite/transactions/${action.saleId}/${action.kind}`,
          action.body,
          { headers: terminalHeaders(binding) },
        );
        await acknowledge(action, result);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('posRecoveryNote'));
      // Keep uncertain and refused intents for explicit reconciliation; never auto replay.
      if (posRefusalStatus(e)) {
        const refused = { ...action, rejected: true };
        await savePosAction(key, refused)
          .then(() => setPending(refused))
          .catch(() => undefined);
      }
      const saved = await readPosAction(key).catch(() => null);
      if (saved) setPending(saved);
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    if (!pending || !online || busy) return;
    setBusy(true);
    setError('');
    try {
      const outcome = await backendGet<{ state: string; result?: { number?: string } }>(
        `/mobile-pos-lite/transactions/requests/${pending.requestId}`,
        { headers: terminalHeaders(binding) },
      );
      if (outcome.state === 'confirmed' && outcome.result)
        await acknowledge(pending, outcome.result);
      else if (pending.rejected) {
        await clearPosAction(key, pending.requestId);
        setPending(null);
        setError(t('posActionRejected'));
      } else setError(t('posActionNotFound'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('posRecoveryNote'));
    } finally {
      setBusy(false);
    }
  }
  const selectedLines = detail?.lines.filter((l) => Number(quantities[l.id]) > 0) ?? [];
  const estimate = selectedLines.reduce((n, l) => n + Number(quantities[l.id]) * l.unitPrice, 0);
  const returnValid =
    selectedLines.length > 0 &&
    selectedLines.every((l) => Number(quantities[l.id]) <= l.returnable) &&
    reason.trim().length >= 3 &&
    (estimate <= (detail?.outstanding ?? 0) || detail?.canRefund);
  const referenceNeeded =
    method !== 'CASH' && (form === 'collection' || estimate > (detail?.outstanding ?? 0));
  return (
    <section className="pos-lifecycle" aria-label={t('posPaymentsReturns')}>
      <h3>{t('posPaymentsReturns')}</h3>
      {done && (
        <p role="status" className="pos-note" data-tone="ok">
          {t('posRecorded')}: {done}
        </p>
      )}
      {error && (
        <p role="alert" className="pos-note" data-tone="warn">
          {error}
        </p>
      )}
      {pending ? (
        <div className="pos-note" data-tone="warn">
          <p>{t('posActionRecovery')}</p>
          <p>
            {pending.kind} · {pending.saleId}
          </p>
          <div className="pos-actions">
            <button type="button" className="pos-btn" disabled={!online || busy} onClick={check}>
              {t('posCheckOutcome')}
            </button>
            <button
              type="button"
              className="pos-btn"
              disabled={!online || !owned || busy || pending.rejected}
              onClick={() => send(pending)}
            >
              {t('posRetryOriginal')}
            </button>
          </div>
        </div>
      ) : detail ? (
        <>
          <div className="pos-total-row">
            <span>{t('stillOwed')}</span>
            <strong>{money(detail.outstanding)}</strong>
          </div>
          {detail.tenders.map((p, i) => (
            <p className="pos-hint" key={i}>
              {p.method} · {money(p.amount)}
              {p.reference ? ` · ${p.reference}` : ''}
            </p>
          ))}
          {detail.collections.map((p) => (
            <p className="pos-hint" key={p.number}>
              {p.number} · {p.method} · {money(p.amount)}
            </p>
          ))}
          {detail.returns.map((r) => (
            <p className="pos-hint" key={r.number}>
              {r.number} · {money(r.total)} · {t('posDebtReduced')}: {money(r.debtReduced)}
              {r.refunds.map((p) => ` · ${p.number} ${money(p.amount)} ${p.status}`).join('')}
            </p>
          ))}
          {detail.actions?.map((a) => (
            <button
              type="button"
              className="pos-btn"
              disabled={!online || busy}
              key={a.requestId}
              onClick={async () => {
                setBusy(true);
                try {
                  if (
                    !(await sharePdfDocument(
                      binding,
                      `/api/backend/mobile-pos-lite/transactions/requests/${a.requestId}/receipt`,
                      `POS-${a.result.number ?? a.requestId}.pdf`,
                    ))
                  )
                    setError(t('posReceiptFailed'));
                } catch {
                  setError(t('posReceiptFailed'));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {a.result.number} · PDF
            </button>
          ))}
          {!form && (
            <div className="pos-actions">
              {detail.canCollect && detail.outstanding > 0 && (
                <button
                  type="button"
                  className="pos-btn"
                  disabled={!owned || !online}
                  onClick={() => {
                    setForm('collection');
                    setAmount(String(detail.outstanding));
                  }}
                >
                  {t('posCollectPayment')}
                </button>
              )}
              {detail.canReturn && detail.lines.some((l) => l.returnable > 0) && (
                <button
                  type="button"
                  className="pos-btn"
                  disabled={!owned || !online}
                  onClick={() => setForm('return')}
                >
                  {t('posReturnRefund')}
                </button>
              )}
            </div>
          )}
          {form && (
            <form
              className="pos-action-form"
              onSubmit={(e) => {
                e.preventDefault();
                const requestId = crypto.randomUUID();
                const body =
                  form === 'collection'
                    ? { requestId, method, amount: Number(amount), reference }
                    : {
                        requestId,
                        reason: reason.trim(),
                        refundMethod: method,
                        reference,
                        lines: selectedLines.map((l) => ({
                          lineId: l.id,
                          quantity: Number(quantities[l.id]),
                          disposition: dispositions[l.id] ?? 'RESTOCK',
                        })),
                      };
                void send({
                  requestId,
                  saleId: detail.id,
                  kind: form === 'collection' ? 'collections' : 'returns',
                  body,
                });
              }}
            >
              {form === 'collection' ? (
                <label className="pos-field" htmlFor={id + '-amount'}>
                  {t('posCollectionAmount')}
                  <input
                    id={id + '-amount'}
                    className="pos-input"
                    autoFocus
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={detail.outstanding}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
              ) : (
                <>
                  {detail.lines
                    .filter((l) => l.returnable > 0)
                    .map((l) => (
                      <div className="pos-field" key={l.id}>
                        <label htmlFor={id + l.id}>
                          {l.name} · {t('posReturnable')}: {l.returnable}
                        </label>
                        <input
                          id={id + l.id}
                          className="pos-input"
                          type="number"
                          min="0"
                          max={l.returnable}
                          step="0.01"
                          value={quantities[l.id] ?? ''}
                          placeholder="0"
                          onChange={(e) => setQuantities({ ...quantities, [l.id]: e.target.value })}
                        />
                        {l.stock && (
                          <>
                            <label htmlFor={id + l.id + '-stock'}>{t('posDisposition')}</label>
                            <select
                              id={id + l.id + '-stock'}
                              className="pos-input"
                              value={dispositions[l.id] ?? 'RESTOCK'}
                              onChange={(e) =>
                                setDispositions({ ...dispositions, [l.id]: e.target.value })
                              }
                            >
                              <option value="RESTOCK">{t('posRestock')}</option>
                              <option value="DAMAGED">{t('posDamaged')}</option>
                            </select>
                          </>
                        )}
                      </div>
                    ))}
                  <label className="pos-field" htmlFor={id + '-reason'}>
                    {t('posReturnReason')}
                    <textarea
                      id={id + '-reason'}
                      className="pos-input"
                      minLength={3}
                      maxLength={500}
                      required
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <p className="pos-hint">
                    {t('posDebtReduced')}: {money(Math.min(estimate, detail.outstanding))} ·{' '}
                    {t('posRefundAmount')}: {money(Math.max(0, estimate - detail.outstanding))}
                  </p>
                </>
              )}
              <label className="pos-field" htmlFor={id + '-method'}>
                {t(form === 'return' ? 'posRefundMethod' : 'payment')}
                <select
                  id={id + '-method'}
                  className="pos-input"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  {session.paymentMethods
                    .filter((m) => m.code !== 'CREDIT')
                    .map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.label}
                      </option>
                    ))}
                </select>
              </label>
              {method !== 'CASH' && (
                <label className="pos-field" htmlFor={id + '-ref'}>
                  {t('reference')}
                  <input
                    id={id + '-ref'}
                    className="pos-input"
                    required={referenceNeeded}
                    maxLength={120}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>
              )}
              <p className="pos-note" data-tone="warn">
                {t('posActionReview')}
              </p>
              <div className="pos-actions">
                <button
                  type="submit"
                  className="pos-btn pos-btn-primary"
                  disabled={
                    busy ||
                    !owned ||
                    !online ||
                    (referenceNeeded && !reference.trim()) ||
                    (form === 'collection'
                      ? !(Number(amount) > 0 && Number(amount) <= detail.outstanding)
                      : !returnValid)
                  }
                >
                  {busy ? t('completing') : t('posConfirmTransaction')}
                </button>
                <button
                  type="button"
                  className="pos-btn"
                  disabled={busy}
                  onClick={() => setForm(null)}
                >
                  {t('posCancel')}
                </button>
              </div>
            </form>
          )}
        </>
      ) : online && saleId ? (
        <p role="status">{t('opening')}</p>
      ) : (
        <p className="pos-hint">{t('posSelectTransaction')}</p>
      )}
    </section>
  );
}
