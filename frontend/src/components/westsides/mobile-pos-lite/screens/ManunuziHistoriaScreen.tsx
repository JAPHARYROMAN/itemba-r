'use client';

import { useState } from 'react';
import { Truck } from 'lucide-react';
import type { PosPurchaseHistory, PosPurchaseHistoryPurchase } from '../hooks/use-pos-history';
import type { PosTranslate } from '../pos-types';

/**
 * Historia ya Manunuzi — the branch's 7-day receiving book
 * (spec-history-reports §3.2). Managers only: the screen is reached from
 * Manunuzi, which is itself gated on `mobile_pos_lite.purchase`, so a rep
 * never meets an entry control she cannot use.
 *
 * ══ THE COST-BLINDNESS LAW (§0) ══ REVIEW-BLOCKING ══════════════════════════
 * NO COST, TOTAL OR VALUE MAY APPEAR ON THIS SCREEN. Not a unit cost, not a
 * line total, not an order total, not a subtotal, not a paid or outstanding
 * amount, not an average cost, not a margin — and not a client-side SUM of any
 * of them, which is the same leak wearing a different hat. A manager sees
 * supplier · date · reference · goods-received number · products · quantities,
 * and nothing else.
 *
 * The reason is not squeamishness about numbers: manager phones get stolen,
 * and a stolen phone must still reveal nothing about what this business pays
 * its suppliers. That is why Historia was cut from v1 at all, and why the
 * owner's 2026-08-14 revival of purchase VIEWING kept the protection intact.
 *
 * The payload carries no such field to render (`use-pos-history.ts` documents
 * the exact key set the endpoint sends), so the guarantee is structural rather
 * than a habit of this file — but if one ever appears there, it does not
 * appear HERE. Do not add a total to the hero. There is no hero: the absence
 * is the feature.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** `dd/MM HH:mm` — the moment she tapped POKEA, which is what she remembers. */
function recordedStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ManunuziHistoriaScreen({
  shellClass,
  online,
  history,
  loading,
  failed,
  refresh,
  t,
}: {
  shellClass: string;
  online: boolean;
  history: PosPurchaseHistory | null;
  loading: boolean;
  failed: boolean;
  refresh: () => void;
  t: PosTranslate;
}) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = detailId
    ? (history?.purchases.find((purchase) => purchase.id === detailId) ?? null)
    : null;

  return (
    <main
      className={`min-h-screen px-4 py-4${shellClass}`}
      style={{ background: 'var(--aurora-bg)' }}
    >
      <div className="mx-auto max-w-md">
        <h1 className="text-[22px] font-bold" style={{ color: 'var(--aurora-text)' }}>
          {t('purchaseHistoryTitle')}
        </h1>
        <p
          className="mt-0.5 text-sm font-semibold"
          style={{ color: 'var(--aurora-text-secondary)' }}
        >
          {t('historyDays')}
        </p>

        {/* Offline there is no local source and nothing is pretended: no rows,
         * no stale snapshot, no Retry (the `online` listener refetches and the
         * ribbon already names the condition). The kikaratasi badge still
         * shows on the ribbon if a slip is parked — the unsent slip is visible
         * even when the history is not. */}
        {!online ? (
          <p
            className="mt-6 rounded-lg border px-4 py-4 text-sm font-medium"
            style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-secondary)' }}
          >
            {t('needsNetwork')}
          </p>
        ) : !history && loading ? (
          <div className="mt-6 space-y-2">
            {[0, 1, 2].map((index) => (
              <div key={index} className="aurora-skeleton h-14 rounded-lg" aria-hidden="true" />
            ))}
          </div>
        ) : !history ? (
          failed && (
            <div
              className="mt-6 rounded-lg border px-4 py-4"
              style={{ borderColor: 'var(--aurora-border)' }}
            >
              <p className="text-sm font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
                {t('purchaseHistoryLoadError')}
              </p>
              <button
                type="button"
                onClick={refresh}
                className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg border px-4 text-sm font-bold"
                style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-primary-text)' }}
              >
                {t('tryAgain')}
              </button>
            </div>
          )
        ) : history.purchases.length === 0 ? (
          <div
            className="mt-6 rounded-lg border px-4 py-8 text-center"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <Truck
              className="mx-auto h-8 w-8"
              style={{ color: 'var(--aurora-text-muted)' }}
              aria-hidden="true"
            />
            <p
              className="mt-3 text-sm font-medium"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
              {t('purchaseHistoryEmpty')}
            </p>
          </div>
        ) : (
          <div className="aurora-stagger mt-4 space-y-2">
            {history.purchases.map((purchase) => (
              <button
                key={purchase.id}
                type="button"
                onClick={() => setDetailId(purchase.id)}
                aria-label={purchase.purchaseOrderNumber}
                className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border p-3 text-left"
                style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
              >
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-[17px] font-medium"
                    style={{ color: 'var(--aurora-text)' }}
                  >
                    {purchase.supplierName}
                  </span>
                  <span
                    className="mt-0.5 block truncate text-sm font-semibold"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    {`${purchase.purchaseOrderNumber} · ${recordedStamp(purchase.recordedAt)}`}
                  </span>
                  {purchase.status === 'INCOMPLETE' && (
                    /* Brass, never red: no action of hers can finish it, and
                     * red is reserved for a server rejection needing a person.
                     * Hiding it would make a stock movement she made
                     * unexplainable to her. */
                    <span
                      className="mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{
                        background: 'var(--aurora-accent-subtle)',
                        color: 'var(--aurora-accent-text)',
                      }}
                    >
                      {t('purchaseIncomplete')}
                    </span>
                  )}
                </span>
                {/* Quantities, never money — the right-aligned slot where a
                 * total would normally sit carries a COUNT OF PRODUCTS. */}
                <span
                  className="flex-shrink-0 text-sm font-bold"
                  style={{ color: 'var(--aurora-text-secondary)' }}
                >
                  {t('items', { count: purchase.lines.length })}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {detail && <PurchaseDetailSheet purchase={detail} onClose={() => setDetailId(null)} t={t} />}
    </main>
  );
}

/**
 * The delivery in full, at zero extra round trips — the list payload already
 * carries its lines. Each line is `qty unitSymbol × name` AND NOTHING ELSE:
 * there is no price column here and there never may be one.
 */
function PurchaseDetailSheet({
  purchase,
  onClose,
  t,
}: {
  purchase: PosPurchaseHistoryPurchase;
  onClose: () => void;
  t: PosTranslate;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label={t('back')}
        onClick={onClose}
        className="absolute inset-0 h-full w-full"
        style={{ background: 'rgb(0 0 0 / 0.4)' }}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={purchase.supplierName}
        className="animate-slide-up absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl p-5"
        style={{ background: 'var(--aurora-card)' }}
      >
        <div className="mx-auto max-w-md">
          <p className="text-[22px] font-bold leading-7" style={{ color: 'var(--aurora-text)' }}>
            {purchase.supplierName}
          </p>
          <p className="mt-1 text-sm font-semibold" style={{ color: 'var(--aurora-text-muted)' }}>
            {recordedStamp(purchase.recordedAt)}
          </p>

          <p className="mt-3 text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
            {`${t('poNumberLabel')}: ${purchase.purchaseOrderNumber}`}
          </p>
          <p className="mt-1 text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
            {`${t('grnNumberLabel')}: ${purchase.grnNumber ?? '—'}`}
          </p>
          {purchase.status === 'INCOMPLETE' && (
            <span
              className="mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold"
              style={{
                background: 'var(--aurora-accent-subtle)',
                color: 'var(--aurora-accent-text)',
              }}
            >
              {t('purchaseIncomplete')}
            </span>
          )}

          <div className="mt-4 space-y-2">
            {purchase.lines.map((line, index) => (
              <p
                key={`${line.productId}-${index}`}
                className="rounded-lg border px-3 py-3 text-base font-medium"
                style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
              >
                {`${line.quantity} ${line.unitSymbol} × ${line.name}`}
              </p>
            ))}
          </div>

          {/* The standing note, and it is not decoration: a manager who cannot
           * find the cost must learn the absence is deliberate, or she reports
           * the screen as broken and someone "fixes" it. There is no setting,
           * no long-press and no manager-only reveal behind this line — the
           * payload does not contain the number. */}
          <p
            className="mt-5 text-sm font-semibold"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            {t('purchaseNoCostsNote')}
          </p>
        </div>
      </section>
    </div>
  );
}
