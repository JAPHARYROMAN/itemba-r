'use client';

import { useMemo, useState } from 'react';
import { BookOpen, Check, ChevronDown, ChevronUp, RotateCw, Wallet } from 'lucide-react';
import type { PendingMobilePosLiteSale } from '@/lib/mobile-pos-lite-store';
import {
  heldRowsTotal,
  mergeHistoryRows,
  type PosHistoryRow,
  type PosSalesHistory,
  type PosSalesHistorySale,
} from '../hooks/use-pos-history';
import { posErrorMessage } from '../pos-errors';
import type { PosTranslate, Session } from '../pos-types';
import { money, pendingTime } from '../pos-utils';

/**
 * Historia ya Mauzo — the rep's own 7 days (spec-history-reports §3.1).
 * Kaunta-shell-only: the classic shell never mounts it, so there is no
 * slabMode prop — the slab always owns the verb here (MAUZO MAPYA).
 *
 * ONE LIST, two sources. Sent rows come from the server; held rows come from
 * this phone's live outbox, and they are what answers "is it still queued
 * locally?" — a question the server cannot answer and its payload never
 * pretends to. Held rows are NEVER counted into the server's totals: the
 * server's numbers are the server's, the phone's are labelled as the phone's,
 * and the brass "Mkononi n · TZS m" line is what makes sent-plus-held read as
 * the drawer. That line counts the held rows THE LIST SHOWS and no others: a
 * total whose rows a rep cannot find is money she cannot account for.
 *
 * Offline, the held rows still render in full — they are local truth and need
 * no network — while the sent group collapses to `leoOfflineNote`, reused
 * verbatim because its sentence is exactly the truth here. No stale server
 * list is shown, because none is cached (§6), and no Retry button appears: the
 * `online` listener refetches by itself and the ribbon names the condition.
 */

/** `hh:mm` for the row's time. */
function timeOnly(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** `dd/MM` for the row's day. */
function dayOnly(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
}

export function HistoriaScreen({
  shellClass,
  session,
  online,
  history,
  loading,
  failed,
  pendingSales,
  refresh,
  t,
}: {
  shellClass: string;
  session: Session;
  online: boolean;
  history: PosSalesHistory | null;
  loading: boolean;
  failed: boolean;
  pendingSales: PendingMobilePosLiteSale[];
  refresh: () => void;
  t: PosTranslate;
}) {
  // The sheet tracks an id, not a row (the StooScreen/LeoScreen pattern): a
  // refetched history re-reads the sale, a flushed outbox row dissolves it.
  const [detail, setDetail] = useState<{ kind: 'sent' | 'held'; id: string } | null>(null);

  const rows = useMemo(
    () => mergeHistoryRows(history?.sales ?? [], pendingSales),
    [history, pendingSales],
  );
  // The brass line counts EXACTLY the held rows in the list beneath it. It used
  // to total the whole outbox while the merge dropped rows older than the
  // window, so a rep could read "Mkononi 2 · TZS 6,000" over a list showing one
  // held sale worth 1,000 and have no way to reconcile it. The merge is the one
  // place that decides which held rows this screen is about; older ones are
  // still in custody and still visible — in Leo's queue, which owns them.
  const heldRows = useMemo(
    () => rows.flatMap((row) => (row.kind === 'held' ? [row.item] : [])),
    [rows],
  );
  const heldTotal = useMemo(() => heldRowsTotal(heldRows), [heldRows]);

  const methodLabel = (code: string) =>
    session.paymentMethods.find((method) => method.code === code)?.label ?? code;

  const detailRow = detail
    ? (rows.find(
        (row) =>
          (row.kind === 'sent' && detail.kind === 'sent' && row.sale.id === detail.id) ||
          (row.kind === 'held' && detail.kind === 'held' && row.item.id === detail.id),
      ) ?? null)
    : null;

  return (
    <main
      className={`min-h-screen px-4 py-4${shellClass}`}
      style={{ background: 'var(--aurora-bg)' }}
    >
      <div className="mx-auto max-w-md">
        <h1 className="text-[22px] font-bold" style={{ color: 'var(--aurora-text)' }}>
          {t('historyTitle')}
        </h1>
        <p
          className="mt-0.5 text-sm font-semibold"
          style={{ color: 'var(--aurora-text-secondary)' }}
        >
          {t('historyDays')}
        </p>

        {/* Hero strip — no ruled-line card; that texture belongs to Leo. Both
         * numbers are the SERVER's, straight off the unbounded aggregate, so a
         * truncated list can never produce a wrong total. */}
        {history && (
          <section className="mt-4">
            <p
              className="text-sm font-semibold uppercase"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
              {`${t('salesCountLabel')} ${history.count}`}
            </p>
            <p
              className="aurora-display aurora-money mt-1 text-4xl"
              style={{ color: 'var(--aurora-accent)' }}
            >
              {money(history.totalAmount)}
            </p>
          </section>
        )}
        {heldRows.length > 0 && (
          <p className="mt-2 text-sm font-bold" style={{ color: 'var(--aurora-accent-text)' }}>
            {t('historyHeldTotal', { count: heldRows.length, amount: money(heldTotal) })}
          </p>
        )}

        {/* Offline: the sent group is replaced by the honest sentence, and the
         * held rows below still render. No Retry — the ribbon has the weather. */}
        {!online && (
          <p
            className="mt-4 rounded-lg border px-4 py-4 text-sm font-medium"
            style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-secondary)' }}
          >
            {t('leoOfflineNote')}
          </p>
        )}

        {online && !history && loading && (
          <div className="mt-6 space-y-2">
            {[0, 1, 2].map((index) => (
              <div key={index} className="aurora-skeleton h-14 rounded-lg" aria-hidden="true" />
            ))}
          </div>
        )}

        {online && !history && failed && (
          <div
            className="mt-6 rounded-lg border px-4 py-4"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <p className="text-sm font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
              {t('historyLoadError')}
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
        )}

        {/* "Hakuna mauzo katika siku 7 zilizopita" is a claim about the SERVER's
         * book, so it is gated on having read that book — `history !== null`
         * and nothing else. Offline the phone has fetched nothing and caches
         * nothing (§6), so it cannot make the claim at all; `leoOfflineNote`
         * above stands in its place, which is what §3.1 prescribes. */}
        {rows.length === 0 && history !== null && !loading && (
          <div
            className="mt-6 rounded-lg border px-4 py-8 text-center"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <BookOpen
              className="mx-auto h-8 w-8"
              style={{ color: 'var(--aurora-text-muted)' }}
              aria-hidden="true"
            />
            <p
              className="mt-3 text-sm font-medium"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
              {t('historyEmpty')}
            </p>
          </div>
        )}

        {rows.length > 0 && (
          <div className="aurora-stagger mt-4 space-y-2">
            {rows.map((row) =>
              row.kind === 'sent' ? (
                <SentRow
                  key={`sent-${row.sale.id}`}
                  sale={row.sale}
                  methodLabel={methodLabel(row.sale.paymentMethod)}
                  onOpen={() => setDetail({ kind: 'sent', id: row.sale.id })}
                />
              ) : (
                <HeldRow
                  key={`held-${row.item.id}`}
                  item={row.item}
                  onOpen={() => setDetail({ kind: 'held', id: row.item.id })}
                  t={t}
                />
              ),
            )}
          </div>
        )}
      </div>

      {detailRow?.kind === 'sent' && (
        <SentSaleSheet
          sale={detailRow.sale}
          methodLabel={methodLabel(detailRow.sale.paymentMethod)}
          onClose={() => setDetail(null)}
          t={t}
        />
      )}
      {detailRow?.kind === 'held' && (
        <HeldSaleSheet item={detailRow.item} onClose={() => setDetail(null)} t={t} />
      )}
    </main>
  );
}

/** A sale the office has: order number, method chip, green check. */
function SentRow({
  sale,
  methodLabel,
  onOpen,
}: {
  sale: PosSalesHistorySale;
  methodLabel: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={sale.salesOrderNumber}
      className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border p-3 text-left"
      style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
    >
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[17px] font-medium"
          style={{ color: 'var(--aurora-text)' }}
        >
          {sale.salesOrderNumber}
          {sale.customerName ? ` · ${sale.customerName}` : ''}
        </span>
        <span
          className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold"
          style={{ color: 'var(--aurora-text-muted)' }}
        >
          {`${timeOnly(sale.createdAt)} · ${dayOnly(sale.createdAt)}`}
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-secondary)' }}
          >
            <Wallet size={12} aria-hidden="true" />
            {methodLabel}
          </span>
        </span>
      </span>
      <span className="flex flex-shrink-0 items-center gap-2">
        <span
          className="inline-flex rounded-md px-2 py-0.5 text-sm font-bold"
          style={{ background: 'var(--aurora-accent-subtle)', color: 'var(--aurora-text)' }}
        >
          {money(Number(sale.totalAmount))}
        </span>
        <Check size={17} style={{ color: 'var(--aurora-success)' }} aria-hidden="true" />
      </span>
    </button>
  );
}

/**
 * A sale still on this phone. Brass left edge for custody, red for a server
 * rejection that needs a person — the four-color law, unchanged.
 */
function HeldRow({
  item,
  onOpen,
  t,
}: {
  item: PendingMobilePosLiteSale;
  onOpen: () => void;
  t: PosTranslate;
}) {
  const failed = Boolean(item.lastError);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('historyHeldChip')}
      className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border p-3 text-left"
      style={{
        background: 'var(--aurora-card)',
        borderColor: 'var(--aurora-border)',
        borderLeft: `4px solid ${failed ? 'var(--aurora-danger)' : 'var(--aurora-accent)'}`,
      }}
    >
      <span className="min-w-0 flex-1">
        <span
          className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{ background: 'var(--aurora-accent-subtle)', color: 'var(--aurora-accent-text)' }}
        >
          {t('historyHeldChip')}
        </span>
        {item.lineSummary && (
          <span
            className="mt-1 block truncate text-sm"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            {item.lineSummary}
          </span>
        )}
        <span className="mt-0.5 block text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
          {pendingTime(item.createdAt)}
        </span>
      </span>
      <span className="flex flex-shrink-0 flex-col items-end gap-1">
        <span
          className="inline-flex rounded-md px-2 py-0.5 text-sm font-bold"
          style={{ background: 'var(--aurora-accent-subtle)', color: 'var(--aurora-text)' }}
        >
          {money(Number(item.totalAmount ?? 0))}
        </span>
        <span
          className="text-xs font-bold"
          style={{ color: failed ? 'var(--aurora-danger-text)' : 'var(--aurora-accent-text)' }}
        >
          {failed ? t('queueFailed') : t('queueWaiting')}
        </span>
      </span>
    </button>
  );
}

/** The bottom-sheet chrome both detail sheets share (the StooScreen pattern). */
function DetailSheet({
  label,
  onClose,
  children,
  t,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
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
        aria-label={label}
        className="animate-slide-up absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl p-5"
        style={{ background: 'var(--aurora-card)' }}
      >
        <div className="mx-auto max-w-md">{children}</div>
      </section>
    </div>
  );
}

/**
 * A sent sale in full — no route, no fetch: the list payload already carries
 * its lines, so the sheet costs zero round trips on a patchy network.
 */
function SentSaleSheet({
  sale,
  methodLabel,
  onClose,
  t,
}: {
  sale: PosSalesHistorySale;
  methodLabel: string;
  onClose: () => void;
  t: PosTranslate;
}) {
  return (
    <DetailSheet label={sale.salesOrderNumber} onClose={onClose} t={t}>
      <p className="text-[22px] font-bold leading-7" style={{ color: 'var(--aurora-text)' }}>
        {sale.salesOrderNumber}
      </p>
      <p className="mt-1 text-sm font-semibold" style={{ color: 'var(--aurora-text-muted)' }}>
        {`${dayOnly(sale.createdAt)} ${timeOnly(sale.createdAt)}`}
      </p>
      <p className="mt-3 text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
        {`${t('payment')}: ${methodLabel}`}
      </p>
      {sale.paymentReference && (
        <p className="mt-1 text-sm font-semibold" style={{ color: 'var(--aurora-text-secondary)' }}>
          {`${t('reference')}: ${sale.paymentReference}`}
        </p>
      )}
      {sale.customerName && (
        <p
          className="mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold"
          style={{ background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-secondary)' }}
        >
          {`${t('customer')}: ${sale.customerName}`}
        </p>
      )}

      <div className="mt-4 space-y-2">
        {sale.lines.map((line) => (
          <div
            key={`${line.productId}-${line.name}`}
            className="flex items-start justify-between gap-3 rounded-lg border p-3"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-base font-medium"
                style={{ color: 'var(--aurora-text)' }}
              >
                {`${line.quantity} ${line.unitSymbol} × ${line.name}`}
              </span>
              <span
                className="mt-0.5 inline-flex rounded-md px-2 py-0.5 text-xs font-semibold"
                style={{
                  background: 'var(--aurora-accent-subtle)',
                  color: 'var(--aurora-text)',
                }}
              >
                {`${t('stockPrice')} ${money(Number(line.unitPrice))}`}
              </span>
            </span>
            <span
              className="inline-flex flex-shrink-0 rounded-md px-2 py-0.5 text-sm font-bold"
              style={{ background: 'var(--aurora-accent-subtle)', color: 'var(--aurora-text)' }}
            >
              {money(Number(line.lineTotal))}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-sm font-semibold" style={{ color: 'var(--aurora-text-secondary)' }}>
        {t('totalLabel')}
      </p>
      <p className="aurora-display aurora-money text-4xl" style={{ color: 'var(--aurora-accent)' }}>
        {money(Number(sale.totalAmount))}
      </p>
    </DetailSheet>
  );
}

/**
 * A held sale, rendered from the frozen outbox payload — its own `lineSummary`
 * and `itemCount`, which are the display snapshot the sale wrote at queue
 * time. This is the resolution the rejected-sale ritual already uses
 * (`RejectedSaleSheet`, LeoScreen), and it is the faithful one: the snapshot
 * describes the sale AS IT WAS RUNG UP, where re-resolving product ids against
 * a catalog that has re-synced since would quietly re-describe it.
 *
 * READ-ONLY on purpose: retry and removal stay in Leo's ritual, which is the
 * one place that owns queue actions — two doors to the same destructive
 * control is how a sale gets removed twice by two different rituals.
 */
function HeldSaleSheet({
  item,
  onClose,
  t,
}: {
  item: PendingMobilePosLiteSale;
  onClose: () => void;
  t: PosTranslate;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const failed = Boolean(item.lastError);
  return (
    <DetailSheet label={t('historyHeldChip')} onClose={onClose} t={t}>
      <span
        className="inline-flex rounded-full px-3 py-1 text-sm font-semibold"
        style={{ background: 'var(--aurora-accent-subtle)', color: 'var(--aurora-accent-text)' }}
      >
        {t('historyHeldChip')}
      </span>
      <p className="mt-2 text-[22px] font-bold leading-7" style={{ color: 'var(--aurora-text)' }}>
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

      {failed ? (
        <>
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
        </>
      ) : (
        <p
          className="mt-4 inline-flex items-center gap-1.5 text-base font-bold"
          style={{ color: 'var(--aurora-accent-text)' }}
        >
          <RotateCw size={15} aria-hidden="true" />
          {t('queueWaiting')}
        </p>
      )}
    </DetailSheet>
  );
}
