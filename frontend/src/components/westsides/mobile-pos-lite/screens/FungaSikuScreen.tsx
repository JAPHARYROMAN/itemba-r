'use client';

import { useMemo } from 'react';
import { RotateCw, Wallet } from 'lucide-react';
import type { MobilePosLiteBinding, PendingMobilePosLiteSale } from '@/lib/mobile-pos-lite-store';
import type { PosClosePreview, PosDayReportHook } from '../hooks/use-pos-day-report';
import type { PosTranslate, Session } from '../pos-types';
import { money, pendingTime } from '../pos-utils';

/**
 * Funga Siku — the closing ritual (spec-history-reports §3.3). Kaunta-only.
 *
 * THE QUEUED-SALES DECISION, which is the whole design of this screen: OFFER
 * THE FLUSH, NEVER BLOCK ON THE QUEUE, ALWAYS DISCLOSE.
 * - A report that silently omits unsent sales is a lie, so silence is out.
 * - Blocking the close until the outbox drains strands the rep the design
 *   exists for — the one in a village shop with no signal and three rejected
 *   rows she cannot clear — so blocking is out too.
 * - So the held card offers TUMA SASA first, because the best outcome is that
 *   the sales go and the report is simply complete. If they remain, the close
 *   still proceeds behind ONE deliberate confirm, and the declared figures
 *   ride into the record and onto the paper under their own heading saying
 *   they are not in the total and that the phone declared them.
 *
 * The preview is a PREVIEW and says so. Every figure the office reads is
 * recomputed server-side from SalesOrder rows at submit time; nothing on this
 * card is sent.
 *
 * THE DAY IS EXPLICIT, and both closable days are reachable. The picker names
 * the day being closed and the other one the server will still accept, so a day
 * that ended with no signal is closable over breakfast instead of being lost;
 * and EVERY FIGURE ON THIS SCREEN BELONGS TO THE DAY IN THE HEADER. The live
 * `my-sales-today` payload is today's, so it is shown only when today is the
 * day being closed; another day shows its own stored snapshot, or "—" and the
 * sentence saying the phone has no figures for it. Showing one day's money
 * under another day's date, immediately before she signs it off, is the one
 * thing this screen must never do.
 *
 * Offline the close cannot happen at all, and the slab says so. Both halves of
 * it — a record the office can see and a letterhead PDF — require the office,
 * and an outboxed day report would mean the office reading a snapshot of a day
 * computed by a phone. Nothing is stranded: the daylog persists — including the
 * INTENT written when this screen is opened with no signal — and the server's
 * today-or-yesterday window is what makes closing later legitimate rather than
 * a workaround.
 */

/** `hh:mm` for the staleness chip. */
function timeOnly(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** `dd/MM/yyyy` from the frozen `YYYY-MM-DD` business date. */
function readableDate(businessDate: string): string {
  const [year, month, day] = businessDate.split('-');
  return year && month && day ? `${day}/${month}/${year}` : businessDate;
}

type MethodPreview = { code: string; label: string; count: number; amount: number };

export function FungaSikuScreen({
  shellClass,
  session,
  binding,
  online,
  preview,
  pendingSales,
  syncing,
  syncPendingSales,
  dayReport,
  closeDay,
  t,
}: {
  shellClass: string;
  session: Session;
  binding: MobilePosLiteBinding;
  online: boolean;
  /**
   * The figures for THE DAY BEING CLOSED, resolved by `resolveClosePreview` in
   * the shell so the card and the slab money read the same source. Null fields
   * mean the phone genuinely has no figure for that day — never a fabricated 0.
   */
  preview: PosClosePreview;
  pendingSales: PendingMobilePosLiteSale[];
  syncing: boolean;
  syncPendingSales: (current: MobilePosLiteBinding) => Promise<void>;
  dayReport: PosDayReportHook;
  /**
   * Submit, and forward to Ripoti on a 2xx and only on a 2xx. The shell owns
   * it because the forward is a route move; the confirm sheet and the slab
   * verb share the one function, so there is exactly one path to the stamp.
   */
  closeDay: () => void;
  t: PosTranslate;
}) {
  // All three come from the resolved preview, which is keyed to the day in the
  // header — never to today when the header says yesterday.
  const gross = preview.totalAmount;
  const salesCount = preview.count;
  const staleAt = preview.staleAt;

  // Display-only breakdown, computed from the day payload's own rows — and only
  // when those rows ARE the day being closed's. It is never sent: `byMethod` on
  // the record is a server groupBy.
  const byMethod = useMemo<MethodPreview[]>(() => {
    if (!preview.sales) return [];
    const tally = new Map<string, MethodPreview>();
    for (const sale of preview.sales) {
      const code = sale.paymentMethod;
      const label = session.paymentMethods.find((method) => method.code === code)?.label ?? code;
      const row = tally.get(code) ?? { code, label, count: 0, amount: 0 };
      row.count += 1;
      row.amount += Number(sale.totalAmount);
      tally.set(code, row);
    }
    return [...tally.values()].sort((a, b) => b.amount - a.amount);
  }, [preview.sales, session.paymentMethods]);

  const heldAmount = pendingSales.reduce((sum, item) => sum + Number(item.totalAmount ?? 0), 0);

  return (
    <main
      className={`min-h-screen px-4 py-4${shellClass}`}
      style={{ background: 'var(--aurora-bg)' }}
    >
      <div className="mx-auto max-w-md">
        <h1 className="text-[22px] font-bold" style={{ color: 'var(--aurora-text)' }}>
          {t('reportTitle')}
        </h1>
        <p
          className="mt-0.5 text-sm font-semibold"
          style={{ color: 'var(--aurora-text-secondary)' }}
        >
          {t('reportForDate', { date: readableDate(dayReport.businessDate) })}
        </p>

        {/* THE DATE CONTROL — the two days the server will accept, named. It is
         * a picker and not a warning, so it carries no colour of its own: the
         * chosen day is ink on brass-subtle, the other is a plain outline. */}
        <fieldset className="mt-3" disabled={dayReport.submitting}>
          <legend
            className="text-sm font-semibold"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            {t('reportPickDay')}
          </legend>
          <div className="mt-2 flex gap-2">
            {dayReport.days.map((day) => {
              const chosen = day.date === dayReport.businessDate;
              return (
                <button
                  key={day.date}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => dayReport.selectDay(day.date)}
                  className="inline-flex min-h-12 flex-1 items-center justify-center rounded-lg border px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    borderColor: chosen ? 'var(--aurora-accent)' : 'var(--aurora-border)',
                    background: chosen ? 'var(--aurora-accent-subtle)' : 'var(--aurora-card)',
                    color: chosen ? 'var(--aurora-text)' : 'var(--aurora-text-secondary)',
                  }}
                >
                  {t(day.isToday ? 'reportDayToday' : 'reportDayYesterday', {
                    date: readableDate(day.date),
                  })}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* The honest disclosure of a real boundary (§8-D case 6), not a
         * warning: calm secondary text, no amber anywhere in this module. */}
        {dayReport.isYesterday && (
          <p className="mt-3 text-sm font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
            {t('reportYesterdayNote')}
          </p>
        )}

        {/* The day she did work must never go unclosed AND unmentioned while
         * she signs off an empty one — so when the other day still needs a
         * close, this screen says so and the chip above reaches it. */}
        {dayReport.otherDay.needsClose && (
          <p className="mt-3 text-sm font-bold" style={{ color: 'var(--aurora-accent-text)' }}>
            {t('reportDayUnclosed', { date: readableDate(dayReport.otherDay.date) })}
          </p>
        )}

        {/* A second close is legitimate — the server recomputes the whole day,
         * so the newer report simply supersedes the earlier one — but it must
         * be a knowing act, not a surprise. */}
        {dayReport.selectedDay.closed && (
          <p className="mt-3 text-sm font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
            {t('reportDayAlreadyClosed')}
          </p>
        )}

        <section
          className="mt-4 rounded-xl p-4"
          style={{ background: 'var(--aurora-card)', boxShadow: 'var(--aurora-shadow)' }}
        >
          <p
            className="text-sm font-semibold uppercase"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            {`${t('salesCountLabel')} ${salesCount ?? '—'}`}
          </p>
          <p
            className="mt-1 text-sm font-semibold"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            {t('reportGross')}
          </p>
          <p
            className="aurora-display aurora-money text-4xl"
            style={{
              color: gross !== null ? 'var(--aurora-accent)' : 'var(--aurora-text-secondary)',
            }}
          >
            {gross !== null ? money(gross) : '—'}
          </p>
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

          {byMethod.length > 0 && (
            <>
              <p
                className="mt-4 text-sm font-semibold uppercase"
                style={{ color: 'var(--aurora-text-secondary)' }}
              >
                {t('reportByMethod')}
              </p>
              <div className="mt-2 space-y-1">
                {byMethod.map((row) => (
                  <div key={row.code} className="flex min-h-12 items-center justify-between gap-3">
                    <span
                      className="inline-flex items-center gap-2 text-base font-semibold"
                      style={{ color: 'var(--aurora-text)' }}
                    >
                      <span
                        className="flex h-7 w-7 items-center justify-center rounded-md"
                        style={{
                          background: 'var(--aurora-bg-subtle)',
                          color: 'var(--aurora-text-secondary)',
                        }}
                      >
                        <Wallet size={15} aria-hidden="true" />
                      </span>
                      {`${row.label} · ${row.count}`}
                    </span>
                    <span
                      className="inline-flex rounded-md px-2 py-0.5 text-sm font-bold"
                      style={{
                        background: 'var(--aurora-accent-subtle)',
                        color: 'var(--aurora-text)',
                      }}
                    >
                      {money(row.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* An estimate OF THE LABELLED DAY, or the plain statement that the
         * phone has no figures for it. "Makadirio" over another day's money
         * would not be an estimate — it would be the wrong day's total. */}
        <p className="mt-2 text-sm font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
          {gross === null ? t('reportNoFiguresForDay') : t('reportPreviewNote')}
        </p>

        {/* The held card — brass, never amber: sales in custody are custody. */}
        {pendingSales.length > 0 && (
          <section
            className="mt-5 rounded-xl border p-4"
            style={{
              background: 'var(--aurora-card)',
              borderColor: 'var(--aurora-accent)',
            }}
          >
            <h2 className="text-lg font-bold" style={{ color: 'var(--aurora-accent-text)' }}>
              {t('reportHeldTitle')}
            </h2>
            <p className="mt-1 text-sm font-bold" style={{ color: 'var(--aurora-accent-text)' }}>
              {t('historyHeldTotal', {
                count: pendingSales.length,
                amount: money(heldAmount),
              })}
            </p>
            <div className="mt-3 space-y-2">
              {pendingSales.map((item) => {
                const failed = Boolean(item.lastError);
                return (
                  <div
                    key={item.id}
                    className="rounded-lg border p-3"
                    style={{
                      borderColor: 'var(--aurora-border)',
                      borderLeft: `4px solid ${failed ? 'var(--aurora-danger)' : 'var(--aurora-accent)'}`,
                    }}
                  >
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
                );
              })}
            </div>
            <p
              className="mt-3 text-sm font-medium"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
              {t('reportHeldNote', { count: pendingSales.length })}
            </p>
            {/* The best outcome is that they simply go, so the flush is right
             * here, wired to the same syncPendingSales the Leo queue uses. */}
            <button
              type="button"
              onClick={() => void syncPendingSales(binding)}
              disabled={!online || syncing}
              className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RotateCw size={18} className={syncing ? 'animate-spin' : ''} aria-hidden="true" />
              {syncing ? t('sending') : t('sendNow')}
            </button>
          </section>
        )}

        {/* The refused write and the failed send both land here — never a bare
         * toast, never raw English as the primary line. */}
        {dayReport.notice && (
          <p
            className="mt-4 rounded-lg px-4 py-3 text-base font-semibold"
            style={{
              background: 'var(--aurora-danger-subtle)',
              color: 'var(--aurora-danger-text)',
            }}
            role="alert"
          >
            {dayReport.notice}
          </p>
        )}

        {!online && (
          <p
            className="mt-4 text-sm font-semibold"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            {t('reportNeedsNetwork')}
          </p>
        )}

        {/* Saying it once, in the ritual, is cheaper than a support call. */}
        <p className="mt-5 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
          {t('reportNotLocked')}
        </p>
      </div>

      {dayReport.confirmOpen && (
        <HeldConfirmSheet
          heldCount={pendingSales.length}
          submitting={dayReport.submitting}
          online={online}
          onConfirm={closeDay}
          onClose={dayReport.closeConfirm}
          t={t}
        />
      )}
    </main>
  );
}

/**
 * The one-step confirm, opened ONLY when the outbox is non-empty: sending a
 * report you know is incomplete should be a deliberate act rather than a
 * reflex. With an empty outbox there is no confirm at all — a day report
 * creates no financial fact and does not deserve friction.
 */
function HeldConfirmSheet({
  heldCount,
  submitting,
  online,
  onConfirm,
  onClose,
  t,
}: {
  heldCount: number;
  submitting: boolean;
  online: boolean;
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
        aria-label={t('reportClose')}
        className="animate-slide-up absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl p-5"
        style={{ background: 'var(--aurora-card)' }}
      >
        <div className="mx-auto max-w-md">
          <p className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
            {t('reportConfirmHeld', { count: heldCount })}
          </p>
          {/* Differently labelled from the slab verb on purpose: the confirm
           * must not read as the same button pressed twice. */}
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting || !online}
            className="mt-5 inline-flex min-h-16 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 text-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && <RotateCw size={18} className="animate-spin" aria-hidden="true" />}
            {submitting ? t('reportSubmitting') : t('reportConfirmAnyway')}
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
