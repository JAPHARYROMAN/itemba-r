'use client';
import { useId } from 'react';
import type { PosPayment, PosTranslate, Session } from '../core/pos-types';
import { money } from '../core/pos-utils';
export function SplitPayments({
  session,
  payments,
  onChange,
  total,
  t,
}: {
  session: Session;
  payments: PosPayment[];
  onChange: (value: PosPayment[]) => void;
  total: number;
  t: PosTranslate;
}) {
  const id = useId();
  const sum = payments.reduce((n, v) => n + v.amount, 0);
  return (
    <fieldset className="pos-split">
      <legend>{t('posSplitPayments')}</legend>
      <p className="pos-hint">{t('posSplitHint')}</p>
      {session.paymentMethods
        .filter((m) => m.code !== 'CREDIT')
        .map((m, index) => {
          const p = payments.find((p) => p.method === m.code);
          const update = (amount: number, reference?: string) =>
            onChange([
              ...payments.filter((p) => p.method !== m.code),
              { method: m.code, amount, reference },
            ]);
          return (
            <div className="pos-field" key={m.code}>
              <label htmlFor={`${id}-${index}`}>{m.label}</label>
              <input
                id={`${id}-${index}`}
                className="pos-input pos-num"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={p?.amount || ''}
                placeholder="0"
                onChange={(e) => update(Number(e.target.value), p?.reference)}
              />
              {m.requiresReference && (p?.amount ?? 0) > 0 && (
                <>
                  <label htmlFor={`${id}-${index}-ref`}>
                    {t('reference')} · {m.label}
                  </label>
                  <input
                    id={`${id}-${index}-ref`}
                    className="pos-input"
                    maxLength={120}
                    value={p?.reference ?? ''}
                    onChange={(e) => update(p!.amount, e.target.value)}
                  />
                </>
              )}
            </div>
          );
        })}
      <div className="pos-total-row">
        <span>{t('posAllocated')}</span>
        <strong>{money(sum)}</strong>
      </div>
      <div className="pos-total-row">
        <span>{t(sum > total ? 'posOverallocated' : 'stillOwed')}</span>
        <strong>{money(Math.abs(total - sum))}</strong>
      </div>
      {sum < total && <p className="pos-hint">{t('posPartialHint')}</p>}
    </fieldset>
  );
}
