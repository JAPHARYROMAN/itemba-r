'use client';

import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronUp, RotateCw, Trash2 } from 'lucide-react';
import type {
  MobilePosLiteBinding,
  PendingMobilePosLiteSale,
  PosDaylogSent,
} from '@/lib/mobile-pos-lite-store';
import { posErrorMessage } from '../pos-errors';
import { reject as rejectHaptic } from '../pos-haptics';
import type { DaySummary, PosTranslate } from '../pos-types';
import { money, pendingTime } from '../pos-utils';

/** The anchor the `#leo/foleni` deep link (and slab sync token) scrolls to. */
export const LEO_FOLENI_ANCHOR_ID = 'leo-foleni';

/** `hh:mm` for sent rows and the staleness chip. */
function timeOnly(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Leo — Daftari la Leo, the Kaunta day book (spec-leo §1; Phase 3 rebuild).
 * Kaunta-shell-only: the classic MySales/Queue screens are untouched.
 *
 * The book is a glance, not an audit: a ruled-line hero carries the day total
 * in brass Display, the five-stroke tally row (one mark per stamped job, from
 * the daylog store — survives restarts offline), and the reconciliation line
 * "Zimetumwa n · Mkononi m" (sent = server truth or the rep-guarded daylog
 * cache; in-hand = live outbox length, always local truth). Below it, ONE
 * list: the pending group first (brass custody edges, Tuma Sasa, the
 * rejected-sale ritual on red rows), then the sent rows.
 *
 * Honesty rules (spec-leo §2): a cached total always wears the staleness chip;
 * no data renders "—", never a fabricated 0; Retry renders only when
 * online-and-failed (offline, the `online` listener refetches by itself and
 * the ribbon already names the condition).
 */
export function LeoScreen({
  shellClass,
  binding,
  online,
  dayLoading,
  daySummary,
  syncing,
  pendingSales,
  pendingCount,
  tallyCount,
  cachedSent,
  confirmRemoveId,
  setConfirmRemoveId,
  syncPendingSales,
  removePending,
  retryPendingSale,
  retryDay,
  openHistory,
  openClose,
  t,
}: {
  shellClass: string;
  binding: MobilePosLiteBinding;
  online: boolean;
  dayLoading: boolean;
  daySummary: DaySummary | null;
  syncing: boolean;
  pendingSales: PendingMobilePosLiteSale[];
  pendingCount: number;
  /** Stamped jobs today, from the daylog store (terminal-scoped). */
  tallyCount: number;
  /** Last my-sales-today snapshot, already rep-guarded by the shell. */
  cachedSent: PosDaylogSent | null;
  confirmRemoveId: string | null;
  setConfirmRemoveId: (id: string | null) => void;
  syncPendingSales: (current: MobilePosLiteBinding) => Promise<void>;
  removePending: (id: string) => Promise<void>;
  retryPendingSale: (item: PendingMobilePosLiteSale) => Promise<'sent' | 'rejected' | 'connection'>;
  /** Re-fires the my-sales-today fetch in place (never leave-and-re-enter). */
  retryDay: () => void;
  /**
   * → `#historia`. Leo is today's page; the history is the pages before it, so
   * the door lives here rather than growing a rail tab the back-map has no
   * room for (spec-history-reports §2.1).
   */
  openHistory: () => void;
  /** → `#funga`. Closing the day is ruling the line under the day's page. */
  openClose: () => void;
  t: PosTranslate;
}) {
  // The rejected-sale ritual sheet tracks an id, not a row: after a retry the
  // row is re-read from pendingSales, so a removed/synced sale dissolves the
  // sheet and a re-rejected one shows its fresh error.
  const [ritualId, setRitualId] = useState<string | null>(null);
  const ritualItem = ritualId ? (pendingSales.find((item) => item.id === ritualId) ?? null) : null;

  const closeRitual = () => {
    setRitualId(null);
    setConfirmRemoveId(null);
  };

  // Hero sources, in trust order: live server day, then the rep-guarded cache
  // (with its staleness stamp), then honest ignorance.
  const dayTotal = daySummary ? daySummary.totalAmount : (cachedSent?.totalAmount ?? null);
  const sentCount = daySummary ? daySummary.count : (cachedSent?.count ?? null);
  const staleAt = !daySummary && cachedSent ? cachedSent.fetchedAt : null;
  const heroLoading = dayLoading && !daySummary && !cachedSent;
  const fetchFailed = online && !dayLoading && !daySummary;

  return (
    <main
      className={`min-h-screen px-4 py-4${shellClass}`}
      style={{ background: 'var(--aurora-bg)' }}
    >
      <div className="mx-auto max-w-md">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
            {t('leoTitle')}
          </h1>
          <span className="text-sm font-semibold" style={{ color: 'var(--aurora-text-secondary)' }}>
            {new Date().toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })}
          </span>
        </div>

        {/* The book hero: ruled lines are pure CSS and purely decorative. */}
        <section
          className="mt-4 rounded-xl p-4"
          style={{
            background: 'var(--aurora-card)',
            boxShadow: 'var(--aurora-shadow)',
            backgroundImage:
              'repeating-linear-gradient(to bottom, transparent, transparent 27px, var(--aurora-border) 27px, var(--aurora-border) 28px)',
          }}
        >
          <p
            className="text-sm font-semibold uppercase"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            {t('leoDayTotal')}
          </p>
          {heroLoading ? (
            <RotateCw
              className="mt-2 h-6 w-6 animate-spin"
              style={{ color: 'var(--aurora-primary)' }}
              aria-hidden="true"
            />
          ) : (
            <p
              className="aurora-display aurora-money mt-1 text-4xl"
              style={{
                color: dayTotal !== null ? 'var(--aurora-accent)' : 'var(--aurora-text-secondary)',
              }}
            >
              {dayTotal !== null ? money(dayTotal) : '—'}
            </p>
          )}
          {staleAt !== null && (
            <span
              className="mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{
                background: 'var(--aurora-bg-subtle)',
                color: 'var(--aurora-text-secondary)',
              }}
            >
              {t('leoLastKnown', { time: timeOnly(staleAt) })}
            </span>
          )}
          <TallyRow count={tallyCount} t={t} />
          <p className="mt-3 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
            {`${t('leoSent', { count: sentCount ?? '—' })} · ${t('leoHeld', { count: pendingCount })}`}
          </p>
        </section>

        {/* ONE list — pending group first (the Foleni anchor), then sent. */}
        {pendingCount > 0 && (
          <section id={LEO_FOLENI_ANCHOR_ID} className="mt-6">
            <h2 className="text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
              {t('queueTitle')}
            </h2>
            <button
              type="button"
              onClick={() => void syncPendingSales(binding)}
              disabled={!online || syncing}
              className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RotateCw size={18} className={syncing ? 'animate-spin' : ''} aria-hidden="true" />
              {syncing ? t('sending') : t('sendNow')}
            </button>
            <div className="mt-3 space-y-2" aria-live="polite">
              {pendingSales.map((item) => {
                const failed = Boolean(item.lastError);
                const body = (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span
                        className="inline-flex rounded-md px-2 py-0.5 text-base font-bold"
                        style={{
                          background: 'var(--aurora-accent-subtle)',
                          color: 'var(--aurora-text)',
                        }}
                      >
                        {money(Number(item.totalAmount ?? 0))}
                      </span>
                      {item.lineSummary && (
                        <p
                          className="mt-1 truncate text-sm"
                          style={{ color: 'var(--aurora-text-secondary)' }}
                        >
                          {item.lineSummary}
                        </p>
                      )}
                      <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {pendingTime(item.createdAt)}
                      </p>
                    </div>
                    <span
                      className="flex-shrink-0 text-xs font-bold"
                      style={{
                        color: failed ? 'var(--aurora-danger-text)' : 'var(--aurora-accent-text)',
                      }}
                    >
                      {failed ? t('queueFailed') : t('queueWaiting')}
                    </span>
                  </div>
                );
                // A red row opens the inspection ritual; a brass row is
                // custody, not a control — nothing to press.
                return failed ? (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setRitualId(item.id)}
                    className="w-full rounded-lg border p-3 text-left"
                    style={{
                      background: 'var(--aurora-card)',
                      borderColor: 'var(--aurora-border)',
                      borderLeft: '4px solid var(--aurora-danger)',
                    }}
                  >
                    {body}
                  </button>
                ) : (
                  <div
                    key={item.id}
                    className="rounded-lg border p-3"
                    style={{
                      background: 'var(--aurora-card)',
                      borderColor: 'var(--aurora-border)',
                      borderLeft: '4px solid var(--aurora-accent)',
                    }}
                  >
                    {body}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Sent group. */}
        <section className="mt-6">
          <h2 className="text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
            {t('mySalesToday')}
          </h2>
          {!online ? (
            <p
              className="mt-3 rounded-lg border px-4 py-4 text-sm font-medium"
              style={{
                borderColor: 'var(--aurora-border)',
                color: 'var(--aurora-text-secondary)',
              }}
            >
              {t('leoOfflineNote')}
            </p>
          ) : dayLoading && !daySummary ? (
            <div className="mt-6 text-center">
              <RotateCw
                className="mx-auto h-6 w-6 animate-spin"
                style={{ color: 'var(--aurora-primary)' }}
                aria-hidden="true"
              />
            </div>
          ) : daySummary ? (
            <div className="mt-3 space-y-2">
              {daySummary.sales.length === 0 && (
                <p
                  className="rounded-lg border px-4 py-6 text-center text-sm font-medium"
                  style={{
                    borderColor: 'var(--aurora-border)',
                    color: 'var(--aurora-text-secondary)',
                  }}
                >
                  {t('noSalesToday')}
                </p>
              )}
              {daySummary.sales.map((sale) => (
                <div
                  key={sale.id}
                  className="flex min-h-14 items-center justify-between gap-3 rounded-lg border p-3"
                  style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
                >
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-semibold"
                      style={{ color: 'var(--aurora-text)' }}
                    >
                      {sale.salesOrderNumber}
                      {sale.customerName ? ` - ${sale.customerName}` : ''}
                    </p>
                    <p className="mt-0.5 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                      {timeOnly(sale.createdAt)} - {sale.paymentMethod}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <span
                      className="inline-flex rounded-md px-2 py-0.5 text-sm font-bold"
                      style={{
                        background: 'var(--aurora-accent-subtle)',
                        color: 'var(--aurora-text)',
                      }}
                    >
                      {money(Number(sale.totalAmount))}
                    </span>
                    <Check
                      size={17}
                      style={{ color: 'var(--aurora-success)' }}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : fetchFailed ? (
            <div
              className="mt-3 rounded-lg border px-4 py-4"
              style={{ borderColor: 'var(--aurora-border)' }}
            >
              <p className="text-sm font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
                {t('leoLoadError')}
              </p>
              <button
                type="button"
                onClick={retryDay}
                className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg border px-4 text-sm font-bold"
                style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-primary-text)' }}
              >
                {t('tryAgain')}
              </button>
            </div>
          ) : null}
        </section>

        {/* Historia — a full-width secondary row directly under the day list.
         * Not a rail tab: the history is a glance surface reached from the
         * book whose earlier pages it is (spec-history-reports §2.1). */}
        <button
          type="button"
          onClick={openHistory}
          className="mt-6 flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border px-4 text-left"
          style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
        >
          <span className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
            {t('historyTitle')}
          </span>
          <ChevronRight
            size={19}
            style={{ color: 'var(--aurora-text-secondary)' }}
            aria-hidden="true"
          />
        </button>

        {/* Funga Siku — the closing ritual, a secondary button above the slab
         * (the SHIRIKI RISITI precedent). The slab keeps its one primary verb. */}
        <button
          type="button"
          onClick={openClose}
          className="mt-3 inline-flex min-h-14 w-full items-center justify-center rounded-lg border px-5 text-base font-bold"
          style={{
            background: 'var(--aurora-card)',
            borderColor: 'var(--aurora-border)',
            color: 'var(--aurora-primary-text)',
          }}
        >
          {t('reportClose')}
        </button>
      </div>

      {ritualItem && (
        <RejectedSaleSheet
          item={ritualItem}
          online={online}
          confirmRemoveId={confirmRemoveId}
          setConfirmRemoveId={setConfirmRemoveId}
          removePending={removePending}
          retryPendingSale={retryPendingSale}
          onClose={closeRitual}
          t={t}
        />
      )}
    </main>
  );
}

/**
 * Five-stroke market tally (spec-leo §1.3): four verticals and a diagonal
 * strike per completed group, drawn in brass. The SVG groups are decorative;
 * the exact count lives in `leoTallyAria` for TalkBack.
 */
function TallyRow({ count, t }: { count: number; t: PosTranslate }) {
  if (count <= 0) return null;
  const groups: number[] = [];
  for (let done = 0; done < count; done += 5) groups.push(Math.min(5, count - done));
  return (
    <div
      role="img"
      aria-label={t('leoTallyAria', { count })}
      className="mt-3 flex flex-wrap gap-x-3 gap-y-2"
    >
      {groups.map((size, index) => (
        <svg
          key={index}
          width={34}
          height={26}
          viewBox="0 0 34 26"
          aria-hidden="true"
          style={{ color: 'var(--aurora-accent-text)' }}
        >
          {Array.from({ length: Math.min(size, 4) }, (_, stroke) => (
            <line
              key={stroke}
              x1={6 + stroke * 7}
              y1={3}
              x2={6 + stroke * 7}
              y2={23}
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          ))}
          {size === 5 && (
            <line
              x1={2}
              y1={21}
              x2={31}
              y2={5}
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          )}
        </svg>
      ))}
    </div>
  );
}

/**
 * The rejected-sale ritual (spec-sales §5.3): full inspection of one red row.
 * Plain-Swahili mapped error up front, raw server English collapsed behind
 * "Maelezo ya kiufundi", exactly two big buttons — Jaribu tena (retry THIS
 * sale's frozen payload) and Mwite msimamizi (closes; the guidance line under
 * it says why). The honor-system two-step removal stays available inside the
 * sheet. A retry that is rejected again re-flags the row (the sheet re-reads
 * it and shows the fresh error, with the reject haptic fired at the commit
 * point); a connection failure leaves the row waiting for the sync loop.
 */
function RejectedSaleSheet({
  item,
  online,
  confirmRemoveId,
  setConfirmRemoveId,
  removePending,
  retryPendingSale,
  onClose,
  t,
}: {
  item: PendingMobilePosLiteSale;
  online: boolean;
  confirmRemoveId: string | null;
  setConfirmRemoveId: (id: string | null) => void;
  removePending: (id: string) => Promise<void>;
  retryPendingSale: (item: PendingMobilePosLiteSale) => Promise<'sent' | 'rejected' | 'connection'>;
  onClose: () => void;
  t: PosTranslate;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [connectionNote, setConnectionNote] = useState(false);

  async function onRetry() {
    if (retrying) return;
    setRetrying(true);
    setConnectionNote(false);
    try {
      const outcome = await retryPendingSale(item);
      if (outcome === 'sent') onClose();
      else if (outcome === 'connection') setConnectionNote(true);
      // 'rejected': the outbox row now carries the fresh lastError and the
      // sheet re-renders from it — stay open for the supervisor conversation.
    } finally {
      setRetrying(false);
    }
  }

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
        aria-label={t('queueFailed')}
        className="animate-slide-up absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl p-5"
        style={{ background: 'var(--aurora-card)' }}
      >
        <div className="mx-auto max-w-md">
          {/* Line inspection: the frozen sale, described from its snapshot. */}
          <p className="text-xl font-bold" style={{ color: 'var(--aurora-text)' }}>
            {money(Number(item.totalAmount ?? 0))}
          </p>
          {item.lineSummary && (
            <p className="mt-1 text-base" style={{ color: 'var(--aurora-text)' }}>
              {item.lineSummary}
            </p>
          )}
          <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
            {pendingTime(item.createdAt)}
            {item.itemCount ? ` · ${t('items', { count: item.itemCount })}` : ''}
          </p>

          {/* The mapped, human error — never raw English as the primary line. */}
          <p
            className="mt-4 rounded-lg px-4 py-3 text-base font-semibold"
            style={{
              background: 'var(--aurora-danger-subtle)',
              color: 'var(--aurora-danger-text)',
            }}
          >
            {posErrorMessage(item.lastError ?? '', t)}
          </p>

          {/* Raw server text, collapsed for supervisors. */}
          <button
            type="button"
            onClick={() => setShowRaw((current) => !current)}
            aria-expanded={showRaw}
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold"
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
              style={{
                background: 'var(--aurora-bg-subtle)',
                color: 'var(--aurora-text-secondary)',
              }}
            >
              {item.lastError}
            </p>
          )}

          {connectionNote && (
            <p
              className="mt-3 text-sm font-medium"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
              {t('needsNetwork')}
            </p>
          )}

          {/* Exactly two big buttons. */}
          <button
            type="button"
            onClick={() => void onRetry()}
            disabled={!online || retrying}
            className="mt-4 inline-flex min-h-16 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 text-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {retrying && <RotateCw size={18} className="animate-spin" aria-hidden="true" />}
            {retrying ? t('sending') : t('retryThisSale')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mt-3 inline-flex min-h-16 w-full items-center justify-center rounded-lg border px-5 text-lg font-bold"
            style={{
              borderColor: 'var(--aurora-border)',
              background: 'var(--aurora-card)',
              color: 'var(--aurora-text)',
            }}
          >
            {t('callSupervisor')}
          </button>
          <p className="mt-2 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
            {t('callSupervisorNote')}
          </p>

          {/* Honor-system two-step removal (existing semantics, relocated). */}
          {confirmRemoveId === item.id ? (
            <div
              className="mt-5 rounded-md border p-3"
              style={{ borderColor: 'var(--aurora-danger)' }}
            >
              <p className="text-sm font-bold" style={{ color: 'var(--aurora-text)' }}>
                {t('removeConfirmTitle')}
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
                {t('removeConfirmBody')}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    rejectHaptic();
                    void removePending(item.id);
                  }}
                  className="min-h-11 flex-1 rounded-lg px-3 text-sm font-bold text-white"
                  style={{ background: 'var(--aurora-danger)' }}
                >
                  {t('confirmRemove')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemoveId(null)}
                  className="min-h-11 flex-1 rounded-lg border px-3 text-sm font-semibold"
                  style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
                >
                  {t('keepIt')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemoveId(item.id)}
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-semibold"
              style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-danger)' }}
            >
              <Trash2 size={15} aria-hidden="true" /> {t('remove')}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
