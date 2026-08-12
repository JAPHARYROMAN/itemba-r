'use client';

import { useMemo, useState } from 'react';
import { Package, RotateCw, Search } from 'lucide-react';
import type { PosStockItem, PosStockSnapshot } from '@/lib/mobile-pos-lite-store';
import type { PosTranslate, Session } from '../pos-types';
import { money, pendingTime } from '../pos-utils';

/**
 * Stoo — the branch-stock screen (spec-inventory §2; Phase 4, read-only).
 * Kaunta-shell-only: the classic shell never mounts it, so there is no
 * slabMode prop — the slab always owns the verb here (MAUZO MAPYA).
 *
 * The snapshot is the truth on this screen: search and the Zote/Kidogo/Imeisha
 * chips are pure local filters (keyboard-wedge scans work because barcode is
 * in the filter), the server's problems-first order is never re-sorted, and
 * the freshness clock keys off the CLIENT fetchedAt. Offline renders the
 * snapshot behind the clock; past 24h the numbers drop but the status word
 * stays (color is never the sole channel — critique A8).
 *
 * Manager presentation gate (spec-inventory §2): the server always sends the
 * unclamped truth; reps see negatives as 0 + red Imeisha, managers see the
 * true negative + purple Zaidi ya rekodi and the threshold line.
 */

/** Quantities hide entirely once the snapshot is older than a day (§2). */
const STOCK_HIDE_QUANTITIES_MS = 24 * 60 * 60 * 1000;

type StockFilter = 'all' | 'low' | 'out';

function statusMeta(
  status: PosStockItem['status'],
  isManagerView: boolean,
  t: PosTranslate,
): { word: string; color: string } {
  // Reps never meet the oversold concept — a negative book is office noise;
  // it presents as plain Imeisha (out of stock).
  const effective = !isManagerView && status === 'OVERSOLD' ? 'OUT_OF_STOCK' : status;
  switch (effective) {
    case 'OVERSOLD':
      // Managers only. Purple is the deliberate outside-the-four-color-law
      // signal for "book disagrees with shelf" (design §4 Stoo row);
      // --aurora-restricted is the existing purple token in both themes.
      return { word: t('stockOversold'), color: 'var(--aurora-restricted)' };
    case 'OUT_OF_STOCK':
      return { word: t('stockOut'), color: 'var(--aurora-danger)' };
    case 'LOW_STOCK':
      return { word: t('stockLow'), color: 'var(--aurora-accent-text)' };
    default:
      return { word: t('stockInStock'), color: 'var(--aurora-success)' };
  }
}

export function StooScreen({
  shellClass,
  session,
  online,
  snapshot,
  loading,
  refresh,
  t,
}: {
  shellClass: string;
  session: Session;
  online: boolean;
  snapshot: PosStockSnapshot | null;
  loading: boolean;
  /** Manual refetch in place (freshness chip + tryAgain) — bypasses the age check. */
  refresh: () => void;
  t: PosTranslate;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  // The sheet tracks an id, not a row (LeoScreen ritual-sheet pattern): a
  // refreshed snapshot re-reads the item, a vanished product dissolves it.
  const [detailId, setDetailId] = useState<string | null>(null);

  const isManagerView = Boolean(session.stockCountsEnabled || session.purchasesEnabled);
  const hideQuantities = snapshot
    ? Date.now() - snapshot.fetchedAt > STOCK_HIDE_QUANTITIES_MS
    : false;
  /** Rep gate: negatives render as 0 — the truth stays in the snapshot. */
  const displayQty = (value: number) => (isManagerView ? value : Math.max(0, value));

  const visibleItems = useMemo(() => {
    if (!snapshot) return [];
    const term = query.trim().toLocaleLowerCase();
    // Filter only — the server's problems-first order is preserved verbatim.
    return snapshot.items.filter((item) => {
      if (filter === 'low' && item.status !== 'LOW_STOCK') return false;
      if (filter === 'out' && item.status !== 'OUT_OF_STOCK' && item.status !== 'OVERSOLD') {
        return false;
      }
      if (
        term &&
        ![item.name, item.code, item.barcode ?? ''].some((value) =>
          value.toLocaleLowerCase().includes(term),
        )
      ) {
        return false;
      }
      return true;
    });
  }, [snapshot, query, filter]);

  const detailItem = detailId
    ? (snapshot?.items.find((item) => item.productId === detailId) ?? null)
    : null;

  const filterChips: Array<{ id: StockFilter; label: string }> = [
    { id: 'all', label: t('stockAll') },
    { id: 'low', label: t('stockLowChip') },
    { id: 'out', label: t('stockOutChip') },
  ];

  return (
    <main
      className={`min-h-screen px-4 py-4${shellClass}`}
      style={{ background: 'var(--aurora-bg)' }}
    >
      <div className="mx-auto max-w-md">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
            {t('stockTab')}
          </h1>
          {snapshot && (
            <FreshnessChip
              fetchedAt={snapshot.fetchedAt}
              online={online}
              loading={loading}
              refresh={refresh}
              t={t}
            />
          )}
        </div>

        {!snapshot ? (
          loading ? (
            <div className="mt-10 text-center">
              <RotateCw
                className="mx-auto h-6 w-6 animate-spin"
                style={{ color: 'var(--aurora-primary)' }}
                aria-hidden="true"
              />
            </div>
          ) : (
            /* No usable snapshot: the honest error card + the one shared
             * retry, refetching in place (never leave-and-re-enter). Offline
             * the button is disabled — the ribbon already names the weather. */
            <div
              className="mt-6 rounded-lg border px-4 py-4"
              style={{ borderColor: 'var(--aurora-border)' }}
            >
              <p className="text-sm font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
                {t('stockLoadError')}
              </p>
              <button
                type="button"
                onClick={refresh}
                disabled={!online}
                className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg border px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
                style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-primary-text)' }}
              >
                {t('tryAgain')}
              </button>
            </div>
          )
        ) : (
          <>
            {hideQuantities && (
              <span
                className="mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold"
                style={{
                  background: 'var(--aurora-bg-subtle)',
                  color: 'var(--aurora-text-secondary)',
                }}
              >
                {t('stockStaleHidden')}
              </span>
            )}

            {/* Local filter only — no remote call while typing. Focus collapses
             * the slab via the shell's global keyboard rule; nothing to wire. */}
            <div className="relative mt-4">
              <Search
                size={19}
                className="absolute left-4 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--aurora-text-muted)' }}
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="aurora-input min-h-14 w-full rounded-lg py-3 pl-12 pr-4 text-base"
                placeholder={t('stockSearchPlaceholder')}
              />
            </div>

            {/* Client-side chips (the `?low=` param is CUT — critique D4). */}
            <div className="mt-3 flex gap-2">
              {filterChips.map((chip) => {
                const selected = filter === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setFilter(chip.id)}
                    aria-pressed={selected}
                    className="min-h-12 flex-1 rounded-lg border px-3 text-sm font-semibold"
                    style={
                      selected
                        ? {
                            borderColor: 'var(--aurora-success)',
                            background: 'var(--aurora-success-subtle)',
                            color: 'var(--aurora-success-text)',
                          }
                        : {
                            borderColor: 'var(--aurora-border)',
                            background: 'var(--aurora-card)',
                            color: 'var(--aurora-text)',
                          }
                    }
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>

            {snapshot.items.length === 0 ? (
              <div
                className="mt-6 rounded-lg border px-4 py-8 text-center"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <Package
                  className="mx-auto h-8 w-8"
                  style={{ color: 'var(--aurora-text-muted)' }}
                  aria-hidden="true"
                />
                <p
                  className="mt-3 text-sm font-medium"
                  style={{ color: 'var(--aurora-text-secondary)' }}
                >
                  {t('stockEmpty')}
                </p>
              </div>
            ) : visibleItems.length === 0 ? (
              <p
                className="mt-6 rounded-lg border px-4 py-6 text-center text-sm font-medium"
                style={{
                  borderColor: 'var(--aurora-border)',
                  color: 'var(--aurora-text-secondary)',
                }}
              >
                {t('stockFilterEmpty')}
              </p>
            ) : (
              <div className="aurora-stagger mt-4 space-y-2">
                {visibleItems.map((item) => {
                  const meta = statusMeta(item.status, isManagerView, t);
                  return (
                    <button
                      key={item.productId}
                      type="button"
                      onClick={() => setDetailId(item.productId)}
                      className="flex min-h-14 w-full items-center gap-3 rounded-lg border p-3 text-left"
                      style={{
                        background: 'var(--aurora-card)',
                        borderColor: 'var(--aurora-border)',
                      }}
                    >
                      <StockTile name={item.name} imageUrl={item.imageUrl} size="row" />
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate text-[17px] font-medium"
                          style={{ color: 'var(--aurora-text)' }}
                        >
                          {item.name}
                        </span>
                        <span
                          className="block truncate text-sm font-semibold"
                          style={{ color: 'var(--aurora-text-muted)' }}
                        >
                          {item.code}
                        </span>
                      </span>
                      <span className="flex flex-shrink-0 flex-col items-end">
                        {/* >24h stale: only the number drops — never the word. */}
                        {!hideQuantities && (
                          <span
                            className="aurora-money text-[22px] font-bold leading-7"
                            style={{ color: 'var(--aurora-text)' }}
                          >
                            {displayQty(item.available)} {item.unitSymbol}
                          </span>
                        )}
                        <span
                          className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-semibold"
                          style={{ color: meta.color }}
                        >
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 flex-shrink-0 rounded-full"
                            style={{ background: meta.color }}
                          />
                          {meta.word}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {detailItem && (
        <StockDetailSheet
          item={detailItem}
          isManagerView={isManagerView}
          hideQuantities={hideQuantities}
          displayQty={displayQty}
          onClose={() => setDetailId(null)}
          t={t}
        />
      )}
    </main>
  );
}

/**
 * The freshness clock (spec-inventory §2.1): client `fetchedAt`, aging colors
 * green → brass → grey, day-old copy always framed as "mwisho kuonekana" —
 * never present-tense certainty. Tapping it is the manual refresh (online
 * only; bypasses the 10-minute age check).
 */
function FreshnessChip({
  fetchedAt,
  online,
  loading,
  refresh,
  t,
}: {
  fetchedAt: number;
  online: boolean;
  loading: boolean;
  refresh: () => void;
  t: PosTranslate;
}) {
  const age = Date.now() - fetchedAt;
  const { label, tone } =
    age < 60_000
      ? { label: t('stockFreshNow'), tone: 'green' as const }
      : age < 3_600_000
        ? {
            label: t('stockFreshMinutes', { count: Math.floor(age / 60_000) }),
            tone: 'green' as const,
          }
        : age < STOCK_HIDE_QUANTITIES_MS
          ? {
              label: t('stockFreshHours', { count: Math.floor(age / 3_600_000) }),
              tone: 'brass' as const,
            }
          : {
              label: t('stockLastSeen', {
                time: pendingTime(new Date(fetchedAt).toISOString()),
              }),
              tone: 'grey' as const,
            };
  const toneStyle =
    tone === 'green'
      ? { background: 'var(--aurora-success-subtle)', color: 'var(--aurora-success-text)' }
      : tone === 'brass'
        ? { background: 'var(--aurora-accent-subtle)', color: 'var(--aurora-accent-text)' }
        : { background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-secondary)' };

  return (
    <button
      type="button"
      onClick={refresh}
      disabled={!online || loading}
      className="inline-flex min-h-8 flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed"
      style={toneStyle}
    >
      {loading && <RotateCw size={13} className="animate-spin" aria-hidden="true" />}
      {label}
    </button>
  );
}

/**
 * 44px lazy photo tile with the designed brass initial-letter fallback
 * (design §6): `onError` and offline collapse to the initial, never a hole.
 */
function StockTile({
  name,
  imageUrl,
  size,
}: {
  name: string;
  imageUrl: string | null;
  size: 'row' | 'sheet';
}) {
  const [broken, setBroken] = useState(false);
  const sizeClass = size === 'sheet' ? 'h-24 w-24 rounded-xl text-3xl' : 'h-11 w-11 rounded-md';
  if (imageUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- authenticated proxy image; next/image optimization would strip the cookie path
      <img
        src={`/api/backend${imageUrl}`}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className={`${sizeClass} flex-shrink-0 object-cover`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${sizeClass} flex flex-shrink-0 items-center justify-center font-bold uppercase`}
      style={{ background: 'var(--aurora-accent-subtle)', color: 'var(--aurora-accent-text)' }}
    >
      {name.trim().charAt(0) || '?'}
    </span>
  );
}

/**
 * Row tap → the product-lookup moment (spec-inventory §2.5): photo, identity,
 * price (brass at Title size on the accent-subtle chip — the brass-text-only-
 * at-Title-and-above rule — or the grey no-price chip), the on-hand split,
 * the status word, and the manager-only threshold line. Dismiss = scrim tap;
 * no navigation event. In the >24h-stale state the sheet still shows the
 * price (catalog data ages differently) but no quantities.
 */
function StockDetailSheet({
  item,
  isManagerView,
  hideQuantities,
  displayQty,
  onClose,
  t,
}: {
  item: PosStockItem;
  isManagerView: boolean;
  hideQuantities: boolean;
  displayQty: (value: number) => number;
  onClose: () => void;
  t: PosTranslate;
}) {
  const meta = statusMeta(item.status, isManagerView, t);
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
        aria-label={item.name}
        className="animate-slide-up absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl p-5"
        style={{ background: 'var(--aurora-card)' }}
      >
        <div className="mx-auto max-w-md">
          <div className="flex items-start gap-4">
            <StockTile name={item.name} imageUrl={item.imageUrl} size="sheet" />
            <div className="min-w-0">
              <p
                className="text-[22px] font-bold leading-7"
                style={{ color: 'var(--aurora-text)' }}
              >
                {item.name}
              </p>
              <p
                className="mt-1 text-sm font-semibold"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                {item.code}
                {item.barcode ? ` · ${item.barcode}` : ''}
              </p>
            </div>
          </div>

          {item.sellingPrice !== null ? (
            <p
              className="mt-4 inline-flex items-baseline gap-2 rounded-lg px-4 py-2"
              style={{ background: 'var(--aurora-accent-subtle)' }}
            >
              <span
                className="text-sm font-semibold"
                style={{ color: 'var(--aurora-accent-text)' }}
              >
                {t('stockPrice')}
              </span>
              <span
                className="aurora-money text-[22px] font-bold"
                style={{ color: 'var(--aurora-accent-text)' }}
              >
                {money(item.sellingPrice)}
              </span>
            </p>
          ) : (
            <p
              className="mt-4 inline-flex rounded-lg px-4 py-2 text-sm font-semibold"
              style={{
                background: 'var(--aurora-bg-subtle)',
                color: 'var(--aurora-text-secondary)',
              }}
            >
              {t('stockNoPrice')}
            </p>
          )}

          {!hideQuantities && (
            <p className="mt-3 text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
              {`${t('stockOnHand')}: ${displayQty(item.quantityOnHand)} ${item.unitSymbol} · ${t('stockReserved')}: ${displayQty(item.quantityReserved)}`}
            </p>
          )}

          <p
            className="mt-2 inline-flex items-center gap-1.5 text-base font-semibold"
            style={{ color: meta.color }}
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
              style={{ background: meta.color }}
            />
            {meta.word}
          </p>

          {isManagerView && (
            <p
              className="mt-2 text-sm font-semibold"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
              {t('stockThreshold', { count: item.threshold })}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
