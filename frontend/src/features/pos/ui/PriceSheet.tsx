'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { POS_PRICE_REASONS, checkPrice, formatPct, lineUnitPrice } from '../core/pos-price';
import type {
  CartLine,
  CartLinePrice,
  PosPriceReason,
  PosTranslate,
  Session,
} from '../core/pos-types';
import type { PosStringKey } from '../core/pos-i18n';
import { money } from '../core/pos-utils';

const REASON_KEYS: Record<PosPriceReason, PosStringKey> = {
  REGULAR_CUSTOMER: 'posReasonREGULAR_CUSTOMER',
  BULK_OFFER: 'posReasonBULK_OFFER',
  DAMAGED: 'posReasonDAMAGED',
  OTHER: 'posReasonOTHER',
};

/**
 * Change one cart line's price (approved canvas, "Phone · edit a price").
 * Shows the list price and the change as a percentage, never a cost: the
 * phone does not know one. Saving needs a reason; a drop past the terminal
 * limit cannot be saved (the server would refuse it anyway).
 */
export function PriceSheet({
  line,
  session,
  t,
  onSave,
  onClose,
}: {
  line: CartLine;
  session: Session;
  t: PosTranslate;
  onSave: (price: CartLinePrice | null) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listPrice = line.product.sellingPrice;
  const [value, setValue] = useState(String(Math.round(lineUnitPrice(line))));
  const [reason, setReason] = useState<PosPriceReason | null>(line.price?.reason ?? null);
  const [note, setNote] = useState(line.price?.note ?? '');

  useEffect(() => {
    inputRef.current?.select();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const charged = Number(value);
  const check = checkPrice(session, listPrice, charged);
  const changed = check.kind === 'rise' || check.kind === 'drop';
  const canSave = check.kind === 'same' || (changed && reason !== null);
  const noDropAllowed = !session.priceEditUnlimited && (session.maxPriceDropPct ?? 0) <= 0;

  let status: { tone: 'ok' | 'warn' | 'bad'; text: string } | null = null;
  if (check.kind === 'rise')
    status = { tone: 'ok', text: t('posPriceRise', { pct: formatPct(check.pct) }) };
  if (check.kind === 'drop')
    status = {
      tone: 'ok',
      text:
        check.limit === null
          ? t('posPriceDropFree', { pct: formatPct(check.pct) })
          : t('posPriceDropOk', { pct: formatPct(check.pct), limit: formatPct(check.limit) }),
    };
  if (check.kind === 'overLimit')
    status = {
      tone: 'bad',
      text: noDropAllowed
        ? t('posPriceNoDrop')
        : t('posPriceDropOver', { pct: formatPct(check.pct), limit: formatPct(check.limit) }),
    };

  function save() {
    if (!canSave) return;
    if (check.kind === 'same') {
      onSave(null);
      return;
    }
    onSave({
      unitPrice: charged,
      reason: reason as PosPriceReason,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  }

  return (
    <div className="pos-sheet-layer">
      <button
        type="button"
        className="pos-sheet-scrim"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
      />
      <section className="pos-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="pos-sheet-grip" aria-hidden="true" />
        <div className="pos-sheet-head">
          <h2 id={titleId}>{t('posEditPrice')}</h2>
          <span>{line.product.name}</span>
        </div>
        <div className="pos-sheet-list">
          <span>{t('posListPrice')}</span>
          <strong className="pos-num">{money(listPrice)}</strong>
        </div>
        <div className="pos-field">
          <label htmlFor={`${titleId}-price`}>{t('posNewPrice')}</label>
          <input
            id={`${titleId}-price`}
            ref={inputRef}
            className="pos-input pos-input-money pos-num"
            inputMode="numeric"
            pattern="[0-9]*"
            value={value}
            onChange={(event) => setValue(event.target.value.replace(/\D/g, '').slice(0, 10))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
            }}
          />
          {status && (
            <p className="pos-note pos-num" data-tone={status.tone} role="status">
              {status.text}
            </p>
          )}
        </div>
        {changed && (
          <fieldset className="pos-reasons">
            <legend className="pos-field-label">{t('posReason')}</legend>
            <div>
              {POS_PRICE_REASONS.map((code) => (
                <button
                  key={code}
                  type="button"
                  className="pos-reason"
                  aria-pressed={reason === code}
                  onClick={() => setReason(code)}
                >
                  {t(REASON_KEYS[code])}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {changed && (
          <div className="pos-field">
            <label htmlFor={`${titleId}-note`}>{t('posPriceNote')}</label>
            <input
              id={`${titleId}-note`}
              className="pos-input"
              maxLength={120}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        )}
        <p className="pos-hint">{t('posPriceRecorded')}</p>
        <div className="pos-actions">
          <button type="button" className="pos-btn" onClick={() => onSave(null)}>
            {t('posResetPrice')}
          </button>
          <button
            type="button"
            className="pos-btn pos-btn-primary"
            disabled={!canSave}
            onClick={save}
          >
            {t('posSave')}
          </button>
        </div>
      </section>
    </div>
  );
}
