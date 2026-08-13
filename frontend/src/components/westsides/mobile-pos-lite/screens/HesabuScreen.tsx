'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, RotateCw, Search, Trash2 } from 'lucide-react';
import type { PosStockItem, PosStockSnapshot } from '@/lib/mobile-pos-lite-store';
import {
  COUNT_LIMIT_WARN_WINDOW,
  COUNT_MAX_LINES,
  type PosCount,
  type PosCountRefusal,
  type PosCountResult,
  type PosCountUnresolvedLine,
} from '../hooks/use-pos-count';
import { posErrorKey, posErrorMessage } from '../pos-errors';
import type { PosTranslate } from '../pos-types';
import { MuhuriStamp } from '../pos-ui';
import { pendingTime } from '../pos-utils';
import { StockTile } from './StooScreen';

/**
 * Hesabu — count mode (spec-inventory §3; Phase 5). Stoo's list re-rendered
 * with the right side replaced by a CountInput, and everything that could
 * anchor the count taken away.
 *
 * BLIND ENTRY is the whole point: while counting, no row shows a quantity, a
 * status word or a status dot, and the Kidogo/Imeisha chips are dead (they are
 * status filters, so they would leak exactly what is hidden). Search stays
 * live — finding a product is not anchoring, and keyboard-wedge scans work by
 * construction. Variance appears for the first time on the review step, as a
 * PREVIEW against the snapshot's `quantityOnHand` (never `available`: the
 * server's systemQuantity is physical stock, so previewing against
 * onHand−reserved would make every reserved branch disagree with the truth
 * that comes back).
 *
 * The screen owns no network and no storage: `count` is the sheet's state
 * machine (one prop — every member is one surface of the same sheet, and the
 * shell's slab already reads it) and the snapshot is Stoo's.
 */

/**
 * Sum of |preview variance| above which the confirm demands a second,
 * differently-labeled tap (spec-inventory §3). Tunable: raise it if managers
 * meet the warning on routine closing counts, lower it if surprises get
 * waved through.
 */
export const COUNT_VARIANCE_CONFIRM_THRESHOLD = 20;

/** Integers only, v1 — decimals return with weighed-goods support (§3). */
const COUNT_INPUT_MAX = 1_000_000;

export function HesabuScreen({
  shellClass,
  online,
  snapshot,
  refresh,
  stockLoading,
  stockLoadFailed,
  pendingCount,
  syncing,
  sendQueue,
  count,
  onBackToStoo,
  t,
}: {
  shellClass: string;
  online: boolean;
  snapshot: PosStockSnapshot | null;
  /** Stoo's manual refetch, reused by the no-snapshot error card. */
  refresh: () => void;
  /** …and its in-flight flag: a verb with no visible effect is a dead verb. */
  stockLoading: boolean;
  /** True once a `/stock` fetch has failed — the retry's own answer. */
  stockLoadFailed: boolean;
  pendingCount: number;
  syncing: boolean;
  sendQueue: () => void;
  count: PosCount;
  onBackToStoo: () => void;
  t: PosTranslate;
}) {
  const [query, setQuery] = useState('');
  /**
   * The ANZA HESABU MPYA question. It lives here rather than in the hook
   * because it is a screen state, and it is a QUESTION because the answer
   * deletes counted work — the one destructive control Hesabu offers over a
   * sheet in hand.
   */
  const [newCountAsked, setNewCountAsked] = useState(false);
  const askNewCount = () => setNewCountAsked(true);

  /**
   * Count mode re-sorts the snapshot ALPHABETICALLY, deliberately breaking
   * Stoo's "no client re-sort" rule (§2.4): the server ranks problems first
   * (OVERSOLD → OUT → LOW → IN), so counting top-to-bottom down the delivered
   * order tells the manager which products the office already suspects —
   * status leaking through row position, which is the same anchoring the
   * hidden numbers and the dead chips exist to prevent. A neutral order is
   * the only order a blind count can have.
   */
  const sortedItems = useMemo(
    () => [...(snapshot?.items ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [snapshot],
  );

  const visibleItems = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return sortedItems;
    return sortedItems.filter((item) =>
      [item.name, item.code, item.barcode ?? ''].some((value) =>
        value.toLocaleLowerCase().includes(term),
      ),
    );
  }, [sortedItems, query]);

  /** Only counted lines, each with its preview variance vs quantityOnHand. */
  const countedRows = useMemo(
    () =>
      sortedItems
        .filter((item) => item.productId in count.lines)
        .map((item) => ({
          item,
          countedQuantity: count.lines[item.productId],
          variance: count.lines[item.productId] - item.quantityOnHand,
        })),
    [sortedItems, count.lines],
  );

  /**
   * The counted lines with no row in the snapshot (§7 case 5, resolved by the
   * hook). They carry no variance — there is no systemQuantity to compare
   * against — which is exactly why neither the review nor the slab will move
   * while one exists: `varianceTotal` behind the threshold double-confirm must
   * cover every line the payload carries, and the hook refuses to submit until
   * this list is empty.
   */
  const unresolvedRows = count.unresolved;
  const removeLine = (productId: string) => count.setLine(productId, null);

  const varianceTotal = countedRows.reduce((sum, row) => sum + Math.abs(row.variance), 0);

  const nameFor = (productId: string) =>
    snapshot?.items.find((item) => item.productId === productId)?.name ?? productId;

  return (
    <main
      className={`min-h-screen px-4 py-4${shellClass}`}
      style={{ background: 'var(--aurora-bg)' }}
    >
      <div className="mx-auto max-w-md">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
            {t('countTitle')}
          </h1>
          {count.step !== 'done' && (
            <span
              className="inline-flex flex-shrink-0 rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                background: 'var(--aurora-primary-subtle)',
                color: 'var(--aurora-primary-text)',
              }}
            >
              {t('countProgress', { count: count.countedCount })}
            </span>
          )}
        </div>

        {count.step === 'done' && count.result ? (
          <CountReceipt result={count.result} nameFor={nameFor} onBackToStoo={onBackToStoo} t={t} />
        ) : !snapshot ? (
          /* No snapshot means no rows — and NOTHING is known to be wrong with
           * the count. This is its own state, deliberately not the
           * counted-but-vanished block: that block's copy ("hazipo tena stoo")
           * would be false here, and its only control would delete the sheet
           * the manager walked the storeroom to fill. The retry is the whole
           * remedy, so it is the only thing offered. */
          <StockUnavailableCard
            countHeld={count.stockUnavailable}
            online={online}
            refresh={refresh}
            loading={stockLoading}
            loadFailed={stockLoadFailed}
            t={t}
          />
        ) : count.step === 'review' ? (
          <ReviewList
            rows={countedRows}
            unresolvedRows={unresolvedRows}
            onRemoveLine={removeLine}
            online={online}
            pendingCount={pendingCount}
            syncing={syncing}
            sendQueue={sendQueue}
            errorRaw={count.errorRaw}
            refusal={count.refusal}
            draftKept={count.draftKept}
            onStartNewCount={askNewCount}
            needsNetwork={count.needsNetwork}
            onBack={count.backToEntry}
            t={t}
          />
        ) : (
          <>
            {/* Entry warning half of the queued-sales gate (§3): a count taken
             * over unsent CASH sales books their stock as shrinkage. Capture
             * itself is never blocked — blind entry touches no balances, and
             * the storeroom is offline by design. */}
            {pendingCount > 0 && (
              <QueueGate syncing={syncing} online={online} sendQueue={sendQueue} t={t} />
            )}

            {/* Counted lines whose product left the snapshot (§7 case 5). They
             * ride in the payload, so this block is the only place the manager
             * can reach them. It renders ONLY against a snapshot that loaded —
             * see the no-snapshot branch above. */}
            {unresolvedRows.length > 0 && (
              <UnresolvedLines rows={unresolvedRows} onRemove={removeLine} t={t} />
            )}

            {/* The ceiling, before it costs her the count (§1.2 DTO cap). */}
            <LimitNotice countedCount={count.countedCount} t={t} />

            {/* Custody is a claim about the LAST write, never about the
             * intention behind it. `draftKept` is null until a write has
             * resolved (nothing to claim yet), true when one landed, and false
             * the moment storage refuses — at which point the honest line is
             * the opposite one, because a phone that will not keep the sheet
             * will not keep the idempotency key either and the send is refused
             * with it (usePosCount.submit). */}
            {count.countedCount > 0 && count.draftKept === true && (
              <p className="mt-3 text-sm font-medium" style={{ color: 'var(--aurora-text-muted)' }}>
                {t('countDraftSaved')}
              </p>
            )}
            {count.countedCount > 0 && count.draftKept === false && (
              <p
                className="mt-3 rounded-lg border px-4 py-3 text-sm font-semibold"
                style={{ borderColor: 'var(--aurora-danger)', color: 'var(--aurora-text)' }}
              >
                {t('countDraftSaveFailed')}
              </p>
            )}

            {/* The end of the sheet, reachable with the sheet in hand. Before
             * this the only way out of a count was to clear every counted field
             * one at a time — which is what the retired-chain copy was asking a
             * manager holding 350 lines to do. */}
            {count.countedCount > 0 && (
              <button
                type="button"
                onClick={askNewCount}
                className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold"
                style={{ color: 'var(--aurora-primary-text)' }}
              >
                {t('countStartNew')}
              </button>
            )}

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

            {/* The chips stay in place so the screen is still Stoo, but they
             * are dead in count mode: Kidogo/Imeisha filter BY STATUS, which
             * is exactly what blind entry withholds. */}
            <div className="mt-3 flex gap-2">
              {[t('stockAll'), t('stockLowChip'), t('stockOutChip')].map((label, index) => (
                <button
                  key={label}
                  type="button"
                  disabled
                  aria-pressed={index === 0}
                  className="min-h-12 flex-1 rounded-lg border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    borderColor: 'var(--aurora-border)',
                    background: 'var(--aurora-card)',
                    color: 'var(--aurora-text)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {visibleItems.length === 0 ? (
              <p
                className="mt-6 rounded-lg border px-4 py-6 text-center text-sm font-medium"
                style={{
                  borderColor: 'var(--aurora-border)',
                  color: 'var(--aurora-text-secondary)',
                }}
              >
                {snapshot.items.length === 0 ? t('stockEmpty') : t('stockFilterEmpty')}
              </p>
            ) : (
              <div className="aurora-stagger mt-4 space-y-2">
                {visibleItems.map((item) => (
                  <div
                    key={item.productId}
                    className="flex min-h-14 w-full items-center gap-3 rounded-lg border p-3"
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
                    <CountInput
                      // Remount-by-key (QuantityInput's one reusable idea) so a
                      // resumed or discarded sheet lands in the fields.
                      key={`${item.productId}:${count.revision}`}
                      value={item.productId in count.lines ? count.lines[item.productId] : null}
                      label={t('quantityOf', { name: item.name })}
                      placeholder={t('countNotCounted')}
                      onCommit={(next) => count.setLine(item.productId, next)}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {count.draftOffer && count.step === 'entry' && (
        <DraftOfferSheet onResume={count.resumeDraft} onDiscard={count.discardDraft} t={t} />
      )}

      {newCountAsked && (
        <NewCountSheet
          onConfirm={() => {
            setNewCountAsked(false);
            count.startNewCount();
          }}
          onClose={() => setNewCountAsked(false)}
          t={t}
        />
      )}

      {count.confirmOpen && count.step === 'review' && (
        <CountConfirmSheet
          capturedAt={count.capturedAt}
          varianceTotal={varianceTotal}
          unresolvedCount={unresolvedRows.length}
          pendingCount={pendingCount}
          syncing={syncing}
          online={online}
          submitting={count.submitting}
          sendQueue={sendQueue}
          onSubmit={() => void count.submit()}
          onClose={count.closeConfirm}
          t={t}
        />
      )}
    </main>
  );
}

/**
 * Blind count entry (spec-inventory §3): 48px, numeric keyboard, integers
 * 0–1,000,000, select-on-focus, commit on blur/Enter.
 *
 * Deliberately NOT `QuantityInput`: that one clamps to 1–9999 and restores the
 * previous value on empty, which would make "the shelf is empty" unrecordable
 * and un-clearable. Here EMPTY is *not counted* (ghost text) and 0 is
 * *counted as zero* — two states that must stay distinct through the draft,
 * the review and the payload.
 */
function CountInput({
  value,
  label,
  placeholder,
  onCommit,
}: {
  value: number | null;
  label: string;
  placeholder: string;
  onCommit: (next: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));

  function commit() {
    if (draft === '') {
      if (value !== null) onCommit(null);
      return;
    }
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed)) {
      setDraft(value === null ? '' : String(value));
      return;
    }
    const next = Math.min(parsed, COUNT_INPUT_MAX);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={draft}
      aria-label={label}
      placeholder={placeholder}
      onFocus={(event) => event.currentTarget.select()}
      // Digits only: the strip is what keeps the range non-negative.
      onChange={(event) => setDraft(event.target.value.replace(/\D/g, '').slice(0, 7))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      className="h-12 w-24 flex-shrink-0 rounded-lg border text-center text-lg font-bold placeholder:text-xs placeholder:font-semibold"
      style={{
        borderColor: 'var(--aurora-border)',
        background: 'var(--aurora-card)',
        color: 'var(--aurora-text)',
      }}
    />
  );
}

/**
 * The queued-sales gate (§3, critique B3), both halves of which show this same
 * calm card: unsent CASH sales would be counted as shrinkage now and
 * decremented again when they sync. Tuma Sasa is right here so the fix costs
 * one tap. The client can only see its OWN outbox; the cross-terminal case is
 * documented as accepted.
 */
function QueueGate({
  syncing,
  online,
  sendQueue,
  t,
}: {
  syncing: boolean;
  online: boolean;
  sendQueue: () => void;
  t: PosTranslate;
}) {
  return (
    <div
      className="mt-4 rounded-lg border px-4 py-3"
      style={{ borderColor: 'var(--aurora-accent)', background: 'var(--aurora-accent-subtle)' }}
    >
      <p className="text-sm font-semibold" style={{ color: 'var(--aurora-accent-text)' }}>
        {t('countQueueGate')}
      </p>
      <button
        type="button"
        onClick={sendQueue}
        disabled={!online || syncing}
        className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RotateCw size={17} className={syncing ? 'animate-spin' : ''} aria-hidden="true" />
        {syncing ? t('sending') : t('sendNow')}
      </button>
    </div>
  );
}

/**
 * No stock snapshot at all (offline cold start, evicted cache, failing
 * `/stock`). This is NOT the counted-but-vanished state and must never be
 * dressed as one: the products did not leave the stoo, the stoo did not load.
 * So the card states that, adds — when a sheet is actually being held — that
 * the count is safe on the phone, and makes the retry the primary action.
 * There is deliberately no remove control anywhere on it: with the review verb
 * dead and the retry disabled offline, a delete button here would be the only
 * live control on the screen, sitting under a sentence telling the manager
 * that destroying her count is how to send it.
 *
 * The retry is a VERB, so it answers. A tap that returns void and repaints
 * nothing is the silent-save defect in another costume: on a flaky link the
 * manager taps, sees the identical screen, taps again, and concludes the app
 * has frozen while she is holding a thirty-line overnight count. So the button
 * shows its own flight (spinner + "inajaribu…") and, once a retry OF HERS has
 * come back empty-handed, the card says so. `attempted` is local on purpose:
 * `loadFailed` is already true from the boot fetch that produced this card, and
 * announcing "the retry failed" before she has retried anything is noise.
 */
function StockUnavailableCard({
  countHeld,
  online,
  refresh,
  loading,
  loadFailed,
  t,
}: {
  countHeld: boolean;
  online: boolean;
  refresh: () => void;
  loading: boolean;
  loadFailed: boolean;
  t: PosTranslate;
}) {
  const [attempted, setAttempted] = useState(false);
  const retryFailed = attempted && loadFailed && !loading;
  return (
    <div
      className="mt-6 rounded-lg border px-4 py-4"
      style={{ borderColor: 'var(--aurora-border)' }}
    >
      <p className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
        {t('stockLoadError')}
      </p>
      {countHeld && (
        <p className="mt-2 text-sm font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
          {t('countStockNotLoaded')}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          setAttempted(true);
          refresh();
        }}
        disabled={!online || loading}
        className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading && <RotateCw size={17} className="animate-spin" aria-hidden="true" />}
        {loading ? t('countStockRetrying') : t('tryAgain')}
      </button>
      {retryFailed && (
        <p className="mt-3 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
          {t('countStockRetryFailed')}
        </p>
      )}
      {!online && (
        <p className="mt-3 text-sm font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
          {t('countNeedsNetwork')}
        </p>
      )}
    </div>
  );
}

/**
 * The line ceiling (the backend DTO's `@ArrayMaxSize`, mirrored client-side as
 * COUNT_MAX_LINES). Named as she approaches it, because a manager who learns
 * the limit from a rejected 250-line sheet has already lost the afternoon —
 * and the server's own answer is an English ValidationPipe string that maps to
 * "call a supervisor" on every retry, forever. Past the ceiling the copy turns
 * actionable: remove the extra lines, send, count the rest.
 */
function LimitNotice({ countedCount, t }: { countedCount: number; t: PosTranslate }) {
  if (countedCount > COUNT_MAX_LINES) {
    return (
      <p
        className="mt-4 rounded-lg border px-4 py-3 text-sm font-semibold"
        style={{ borderColor: 'var(--aurora-danger)', color: 'var(--aurora-text)' }}
      >
        {t('countLimitReached', { count: COUNT_MAX_LINES })}
      </p>
    );
  }
  if (countedCount >= COUNT_MAX_LINES - COUNT_LIMIT_WARN_WINDOW) {
    return (
      <p
        className="mt-4 rounded-lg border px-4 py-3 text-sm font-semibold"
        style={{ borderColor: 'var(--aurora-accent)', color: 'var(--aurora-accent-text)' }}
      >
        {t('countLimitNear', { count: COUNT_MAX_LINES })}
      </p>
    );
  }
  return null;
}

/**
 * The counted-but-vanished block (§7 case 5). Every row here is in the payload
 * and in no other list on the screen, so each one carries the trash control
 * that makes "the rep removes the line and resubmits" possible; until the
 * block is empty the slab's verbs are dead and the hook refuses to submit.
 * It sits OUTSIDE the search filter on purpose — a line you cannot see is the
 * bug, and hiding it behind a search term would only re-create it.
 */
function UnresolvedLines({
  rows,
  onRemove,
  t,
}: {
  rows: PosCountUnresolvedLine[];
  onRemove: (productId: string) => void;
  t: PosTranslate;
}) {
  return (
    <div
      className="mt-4 rounded-lg border px-4 py-3"
      style={{ borderColor: 'var(--aurora-danger)' }}
    >
      <p className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
        {t('countLinesGone')}
      </p>
      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.productId} className="flex min-h-12 items-center justify-between gap-3">
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-base font-medium"
                style={{ color: 'var(--aurora-text)' }}
              >
                {row.name}
              </span>
              <span
                className="aurora-money block text-sm font-bold"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                {row.countedQuantity}
              </span>
            </span>
            <button
              type="button"
              onClick={() => onRemove(row.productId)}
              aria-label={t('removeItem', { name: row.name })}
              className="inline-flex min-h-11 flex-shrink-0 items-center gap-2 rounded-lg border px-4 text-sm font-semibold"
              style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-danger)' }}
            >
              <Trash2 size={15} aria-hidden="true" /> {t('remove')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Review (§3): only counted lines, each with its counted value and the preview
 * variance, under the caveat that names it an estimate. This is where variance
 * appears for the first time — blind entry ends here, not at the shelf.
 *
 * The unresolved block repeats here because the review is the promise that
 * every line about to be posted has been seen: a sheet that grows an
 * unreviewable line while the manager stands on this screen must say so where
 * she is standing, not only back on the entry sheet.
 */
function ReviewList({
  rows,
  unresolvedRows,
  onRemoveLine,
  online,
  pendingCount,
  syncing,
  sendQueue,
  errorRaw,
  refusal,
  draftKept,
  onStartNewCount,
  needsNetwork,
  onBack,
  t,
}: {
  rows: Array<{ item: PosStockItem; countedQuantity: number; variance: number }>;
  unresolvedRows: PosCountUnresolvedLine[];
  onRemoveLine: (productId: string) => void;
  online: boolean;
  pendingCount: number;
  syncing: boolean;
  sendQueue: () => void;
  errorRaw: string | null;
  refusal: PosCountRefusal;
  /**
   * `false` here means the phone refused the write that carries the frozen
   * key, so TUMA HESABU stopped before the request left. It is not a server
   * rejection and there is no `errorRaw` behind it — the send never happened —
   * so it gets its own line rather than a rejection card.
   */
  draftKept: boolean | null;
  onStartNewCount: () => void;
  needsNetwork: boolean;
  onBack: () => void;
  t: PosTranslate;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold"
        style={{ color: 'var(--aurora-primary-text)' }}
      >
        {t('back')}
      </button>

      <p className="mt-1 text-sm font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
        {t('countPreviewNote')}
      </p>

      {unresolvedRows.length > 0 && (
        <UnresolvedLines rows={unresolvedRows} onRemove={onRemoveLine} t={t} />
      )}

      {pendingCount > 0 && (
        <QueueGate syncing={syncing} online={online} sendQueue={sendQueue} t={t} />
      )}

      {/* Online-only submission (§3): offline the slab is dead and this line
       * says why. There is never an outbox entry for a count. */}
      {(!online || needsNetwork) && (
        <p
          className="mt-4 rounded-lg border px-4 py-3 text-sm font-semibold"
          style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-secondary)' }}
        >
          {t('countNeedsNetwork')}
        </p>
      )}

      {draftKept === false && (
        <p
          className="mt-4 rounded-lg px-4 py-3 text-base font-semibold"
          style={{ background: 'var(--aurora-danger-subtle)', color: 'var(--aurora-danger-text)' }}
        >
          {t('countDraftSaveFailed')}
        </p>
      )}

      {errorRaw && (
        <RejectionCard
          errorRaw={errorRaw}
          refusal={refusal}
          onStartNewCount={onStartNewCount}
          t={t}
        />
      )}

      <div className="mt-4 space-y-2">
        {rows.map(({ item, countedQuantity, variance }) => (
          <div
            key={item.productId}
            className="flex min-h-14 items-center justify-between gap-3 rounded-lg border p-3"
            style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
          >
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
              <span
                className="aurora-money text-[22px] font-bold leading-7"
                style={{ color: 'var(--aurora-text)' }}
              >
                {countedQuantity} {item.unitSymbol}
              </span>
              <VarianceLine value={variance} t={t} />
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/** `+n` green / `−n` red at Label size; an exact match is quiet, not green. */
function VarianceLine({ value, t }: { value: number; t: PosTranslate }) {
  const color =
    value === 0
      ? 'var(--aurora-text-muted)'
      : value > 0
        ? 'var(--aurora-success)'
        : 'var(--aurora-danger)';
  return (
    <span className="mt-0.5 text-sm font-semibold" style={{ color }}>
      {`${t('countVariance')} ${value > 0 ? `+${value}` : value}`}
    </span>
  );
}

/**
 * A send that did not succeed (§3): the mapped Swahili up front, the raw
 * English collapsed behind "Maelezo ya kiufundi" for supervisors. The draft and
 * its frozen key are untouched in every case this card covers.
 *
 * `refusal` decides the words AND the control, and the rule is that the card
 * may never print an instruction the app cannot obey:
 * - `sheet` — the wrapper refused this body BEFORE it created anything, so the
 *   sheet really is what is wrong and nothing was recorded. The card says so
 *   and points at the edit: the verb stays live because the fix is one Rudi and
 *   one field away, and the frozen key opens a fresh chain carrying the
 *   correction rather than replaying what was refused.
 * - `recount` — the capture is older than the server's window, so NO resend of
 *   this sheet can post: the age only grows, and an edit rides the same frozen
 *   key into the same 409. "Rudi na urekebishe kabla ya kutuma tena" would be
 *   printed immediately under copy saying the opposite ("hesabu stoo upya"), and
 *   following it earns the identical refusal forever. The instruction is dropped
 *   and the control the server's own sentence names — count the shelf again — is
 *   put on the card instead. This is the state that used to be `closed`, moved
 *   in round 5 from a refusal no deployable build can emit to the one it can.
 * - `refused` — everything refused with a ROW already behind it: 401/403 judging
 *   the CALLER, every 409 (the twin-detect conflict, or the server refusing to
 *   replay a marker hit whose recorded numbers differ from the ones just sent),
 *   and a 400 raised inside post(), where the chain is alive and resumable and
 *   an edit would earn that 409 rather than a fresh count. No instruction is
 *   true for any of them, so the server's own sentence is the whole message.
 * - `unproven` — a 5xx, a gateway timeout over a post transaction that budgets
 *   tens of seconds, an unreadable error shape. Nothing is known to be wrong
 *   with the count, so the headline says the send did not complete and the work
 *   is safe — never "call a supervisor", which answers a question nobody at the
 *   shelf can act on.
 */
function RejectionCard({
  errorRaw,
  refusal,
  onStartNewCount,
  t,
}: {
  errorRaw: string;
  refusal: PosCountRefusal;
  onStartNewCount: () => void;
  t: PosTranslate;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const mapped = posErrorKey(errorRaw);
  const proven = refusal === 'sheet' || refusal === 'recount';
  return (
    <div className="mt-4">
      <p
        className={`rounded-lg px-4 py-3 text-base font-semibold${proven ? '' : ' border'}`}
        style={
          proven
            ? { background: 'var(--aurora-danger-subtle)', color: 'var(--aurora-danger-text)' }
            : { borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }
        }
      >
        {refusal === 'unproven' && mapped === 'errorFallback'
          ? t('countSendFailedRetry')
          : posErrorMessage(errorRaw, t)}
      </p>
      {refusal === 'sheet' && (
        <p className="mt-2 text-sm font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
          {t('countRejectedFinal')}
        </p>
      )}
      {refusal === 'recount' && (
        <button
          type="button"
          onClick={onStartNewCount}
          className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-lg border px-4 text-base font-bold"
          style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-primary-text)' }}
        >
          {t('countStartNew')}
        </button>
      )}
      <button
        type="button"
        onClick={() => setShowRaw((current) => !current)}
        aria-expanded={showRaw}
        className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold"
        style={{ color: 'var(--aurora-text-secondary)' }}
      >
        {showRaw ? (
          <ChevronUp size={15} aria-hidden="true" />
        ) : (
          <ChevronDown size={15} aria-hidden="true" />
        )}
        {t('technicalDetails')}
      </button>
      {showRaw && (
        <p
          className="mt-1 rounded-md px-3 py-2 font-mono text-xs"
          style={{ background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-secondary)' }}
        >
          {errorRaw}
        </p>
      )}
    </div>
  );
}

/**
 * The MUHURI moment (§3): the brass seal, then SERVER-returned variances —
 * truth, not the review's preview — and the office's adjustment number. The
 * not-yet-posted variant stamps hollow (the escape flag is off; the office
 * still has to approve) and says so in words, never in color alone — so the
 * WORD on the seal changes with it. Stamping COUNT COMPLETE over a count that
 * has moved no stock would put the screen's largest, highest-contrast element
 * in direct contradiction with the truth, which is the failure mode the
 * hollow-vs-solid distinction exists to avoid.
 *
 * The test is the NEGATIVE — anything that is not a confirmed POSTED is
 * pending — because 'PENDING_APPROVAL' is not the only non-posted answer the
 * wrapper can give: with the auto-post escape flag off, a resumed send returns
 * the marker-matched chain's own state, which can be 'APPROVED'. Asking
 * `=== 'PENDING_APPROVAL'` would stamp the solid seal and HESABU IMEKAMILIKA
 * over exactly that count.
 */
function CountReceipt({
  result,
  nameFor,
  onBackToStoo,
  t,
}: {
  result: PosCountResult;
  nameFor: (productId: string) => string;
  onBackToStoo: () => void;
  t: PosTranslate;
}) {
  const pending = result.status !== 'POSTED';
  return (
    <section
      className="mt-6 rounded-xl p-5"
      style={{ background: 'var(--aurora-card)', boxShadow: 'var(--aurora-shadow)' }}
    >
      <div className="text-center">
        <MuhuriStamp
          variant={pending ? 'hollow' : 'solid'}
          label={pending ? t('countPendingApproval') : t('countDone')}
        />
      </div>
      <p
        className="mt-3 text-center text-sm font-semibold"
        style={{ color: 'var(--aurora-text-secondary)' }}
      >
        {result.adjustmentNumber}
      </p>

      <div className="mt-4 space-y-2">
        {result.lines.map((line) => (
          <div
            key={line.productId}
            className="flex items-center justify-between gap-3 border-t pt-2"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <span
              className="min-w-0 flex-1 truncate text-base font-medium"
              style={{ color: 'var(--aurora-text)' }}
            >
              {nameFor(line.productId)}
            </span>
            <span className="flex flex-shrink-0 flex-col items-end">
              <span
                className="aurora-money text-base font-bold"
                style={{ color: 'var(--aurora-text)' }}
              >
                {line.countedQuantity}
              </span>
              <VarianceLine value={line.varianceQuantity} t={t} />
            </span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onBackToStoo}
        className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-lg border px-4 text-base font-bold uppercase tracking-wide"
        style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-primary-text)' }}
      >
        {t('countBackToStoo')}
      </button>
    </section>
  );
}

/**
 * Entering with a saved sheet (§3): two big buttons, no typed confirm. One
 * draft per terminal by construction, so there is never a list to choose from.
 */
function DraftOfferSheet({
  onResume,
  onDiscard,
  t,
}: {
  onResume: () => void;
  onDiscard: () => void;
  t: PosTranslate;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <span className="absolute inset-0 h-full w-full" style={{ background: 'rgb(0 0 0 / 0.4)' }} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('countTitle')}
        className="animate-slide-up absolute inset-x-0 bottom-0 rounded-t-2xl p-5"
        style={{ background: 'var(--aurora-card)' }}
      >
        <div className="mx-auto max-w-md">
          <p className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
            {t('countDraftSaved')}
          </p>
          <button
            type="button"
            onClick={onResume}
            className="mt-4 inline-flex min-h-16 w-full items-center justify-center rounded-lg bg-brand-600 px-5 text-lg font-bold text-white"
          >
            {t('countResumeDraft')}
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="mt-3 inline-flex min-h-16 w-full items-center justify-center rounded-lg border px-5 text-lg font-bold"
            style={{
              borderColor: 'var(--aurora-border)',
              background: 'var(--aurora-card)',
              color: 'var(--aurora-text)',
            }}
          >
            {t('countDiscardDraft')}
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * ANZA HESABU MPYA. The retired-chain copy has named this since round 2 with
 * nothing behind it: `enter()` will not re-open the resume/discard sheet while
 * a line is counted, and the key is released only when the LAST counted line is
 * deleted, so a manager holding 350 lines could obey the instruction only by
 * clearing 350 fields one at a time. This is that ritual as one deliberate
 * choice — and it asks first, in the words of what it costs, because unlike
 * every other recovery on this screen it ends counted work. Nothing in the app
 * ever calls it: the manager does.
 */
function NewCountSheet({
  onConfirm,
  onClose,
  t,
}: {
  onConfirm: () => void;
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
        aria-label={t('countStartNew')}
        className="animate-slide-up absolute inset-x-0 bottom-0 rounded-t-2xl p-5"
        style={{ background: 'var(--aurora-card)' }}
      >
        <div className="mx-auto max-w-md">
          <p className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
            {t('countStartNewBody')}
          </p>
          <button
            type="button"
            onClick={onConfirm}
            className="mt-4 inline-flex min-h-16 w-full items-center justify-center rounded-lg px-5 text-lg font-bold text-white"
            style={{ background: 'var(--aurora-danger)' }}
          >
            {t('countStartNewConfirm')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-lg border px-5 text-base font-bold"
            style={{
              borderColor: 'var(--aurora-border)',
              background: 'var(--aurora-card)',
              color: 'var(--aurora-text)',
            }}
          >
            {t('back')}
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * The confirm (§3). It always shows the capture time, because a variance can
 * be surprising even when it is correct. Two escalations sit on top:
 * - a non-empty local outbox REPLACES the confirm with the queue gate, so the
 *   count cannot post while unsent sales would double-count the shrinkage;
 * - a large summed variance adds the caution card and renames the button, so
 *   sending it takes a second, deliberate tap.
 */
function CountConfirmSheet({
  capturedAt,
  varianceTotal,
  unresolvedCount,
  pendingCount,
  syncing,
  online,
  submitting,
  sendQueue,
  onSubmit,
  onClose,
  t,
}: {
  capturedAt: number | null;
  varianceTotal: number;
  /**
   * Counted lines the review could not show. The slab never opens this sheet
   * while there are any, and the hook would refuse the submit anyway — this
   * is the last of the three layers, so the sheet can never be the one that
   * lets a payload past a variance total summed over fewer lines.
   */
  unresolvedCount: number;
  pendingCount: number;
  syncing: boolean;
  online: boolean;
  submitting: boolean;
  sendQueue: () => void;
  onSubmit: () => void;
  onClose: () => void;
  t: PosTranslate;
}) {
  const bigVariance = varianceTotal > COUNT_VARIANCE_CONFIRM_THRESHOLD;
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
        aria-label={t('countSubmit')}
        className="animate-slide-up absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl p-5"
        style={{ background: 'var(--aurora-card)' }}
      >
        <div className="mx-auto max-w-md">
          {unresolvedCount > 0 ? (
            <p className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
              {t('countLinesGone')}
            </p>
          ) : pendingCount > 0 ? (
            <QueueGate syncing={syncing} online={online} sendQueue={sendQueue} t={t} />
          ) : (
            <>
              <p className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
                {t('countConfirmBody')}
              </p>
              {capturedAt !== null && (
                <p
                  className="mt-2 text-sm font-semibold"
                  style={{ color: 'var(--aurora-text-secondary)' }}
                >
                  {t('countCapturedAt', {
                    time: pendingTime(new Date(capturedAt).toISOString()),
                  })}
                </p>
              )}
              {bigVariance && (
                /* Caution copy, not amber chrome — the red variance numerals
                 * on the review already carry the weight. */
                <p
                  className="mt-4 rounded-lg border px-4 py-3 text-base font-semibold"
                  style={{ borderColor: 'var(--aurora-danger)', color: 'var(--aurora-text)' }}
                >
                  {t('countBigVariance')}
                </p>
              )}
              <button
                type="button"
                onClick={onSubmit}
                disabled={submitting || !online}
                className="mt-5 inline-flex min-h-16 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 text-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting && <RotateCw size={18} className="animate-spin" aria-hidden="true" />}
                {submitting
                  ? t('countSubmitting')
                  : bigVariance
                    ? t('countConfirmAnyway')
                    : t('countSubmit')}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-lg border px-5 text-base font-bold"
            style={{
              borderColor: 'var(--aurora-border)',
              background: 'var(--aurora-card)',
              color: 'var(--aurora-text)',
            }}
          >
            {t('back')}
          </button>
        </div>
      </section>
    </div>
  );
}
