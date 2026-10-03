'use client';
import { useState } from 'react';
import type { useHeldCarts } from '../core/hooks/use-held-carts';
import type { PosCartDraft } from '../core/pos-workspace-store';
import type { PosTranslate } from '../core/pos-types';
import { lineUnitPrice } from '../core/pos-price';
import { money, pendingTime } from '../core/pos-utils';

export type HeldCartActions = ReturnType<typeof useHeldCarts>;
export function HeldCarts({
  actions,
  empty,
  t,
  onResume,
}: {
  actions: HeldCartActions;
  empty: boolean;
  t: PosTranslate;
  onResume: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<PosCartDraft | null>(null);
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch {
      setError(t('posCartAttention'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="pos-full pos-records">
      <h2>{t('posHeldCarts')}</h2>
      <p className="pos-hint">{t('posHoldNote')}</p>
      {!empty && (
        <p className="pos-note" data-tone="warn">
          {t('posResumeEmpty')}
        </p>
      )}
      {error && (
        <p className="pos-note" data-tone="bad" role="alert">
          {error}
        </p>
      )}
      {actions.held.length === 0 && <p className="pos-empty">{t('posNoHeld')}</p>}
      {actions.held.map((item) => (
        <article key={item.id} className="pos-panel pos-held-card">
          <div className="pos-panel-head">
            <div>
              <h3>{item.name || t('posUnnamedCart')}</h3>
              <p className="pos-hint">
                {item.customer?.name ?? t('posWalkIn')} · {pendingTime(item.updatedAt)}
              </p>
            </div>
            <strong className="pos-num">
              {money(item.cart.reduce((sum, line) => sum + lineUnitPrice(line) * line.quantity, 0))}
            </strong>
          </div>
          <p>{item.cart.map((line) => `${line.quantity} × ${line.product.name}`).join(', ')}</p>
          {item.note && <p className="pos-hint">{item.note}</p>}
          <div className="pos-actions">
            <button
              type="button"
              className="pos-btn pos-btn-primary"
              disabled={busy || !empty}
              onClick={() =>
                void run(async () => {
                  await actions.resume(item);
                  onResume();
                })
              }
            >
              {t('posResume')}
            </button>
            <button
              type="button"
              className="pos-btn"
              disabled={busy}
              onClick={() => {
                setEditing(item);
                setName(item.name);
              }}
            >
              {t('posRename')}
            </button>
            <button
              type="button"
              className="pos-btn"
              disabled={busy}
              onClick={() => setConfirm(item.id)}
            >
              {t('posDiscardCart')}
            </button>
          </div>
          {editing?.id === item.id && (
            <form
              className="pos-actions"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await actions.rename(item, name);
                  setEditing(null);
                });
              }}
            >
              <label className="pos-field">
                {t('posCartName')}
                <input
                  autoFocus
                  className="pos-input"
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button type="submit" className="pos-btn" disabled={busy}>
                {t('posSave')}
              </button>
              <button type="button" className="pos-btn" onClick={() => setEditing(null)}>
                {t('posCancel')}
              </button>
            </form>
          )}
          {confirm === item.id && (
            <div role="group" aria-label={t('posDiscardCart')}>
              <p className="pos-note" data-tone="warn">
                {t('posDiscardConfirm')}
              </p>
              <div className="pos-actions">
                <button type="button" className="pos-btn" onClick={() => setConfirm(null)}>
                  {t('keepIt')}
                </button>
                <button
                  type="button"
                  className="pos-btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await actions.discard(item);
                      setConfirm(null);
                    })
                  }
                >
                  {t('posDiscardCart')}
                </button>
              </div>
            </div>
          )}
        </article>
      ))}
    </main>
  );
}
