'use client';

import { RotateCw, Share2, Wallet } from 'lucide-react';
import type { PosDayReport } from '../hooks/use-pos-day-report';
import { MuhuriStamp } from '../pos-ui';
import type { PosTranslate } from '../pos-types';
import { money } from '../pos-utils';

/**
 * Ripoti — the MUHURI (spec-history-reports §3.4). Reached ONLY after a 2xx,
 * so every number here comes from the server response and never from the
 * preview: there is no optimistic stamp and no path on which this screen
 * claims the office has something it does not.
 *
 * The seal is ALWAYS SOLID. The report exists on the server by construction —
 * that is what a 2xx means — so there is no held variant, exactly like MZIGO
 * UMEPOKELEWA and unlike the sale's IMEHIFADHIWA.
 *
 * THE TALLY DOES NOT MOVE. Every other stamp adds a mark to the Daftari;
 * this one is the documented exception, because closing the day is ruling the
 * line UNDER the marks rather than another entry on the page.
 */

/** `dd/MM/yyyy` from the record's `YYYY-MM-DD` business date. */
function readableDate(businessDate: string): string {
  const [year, month, day] = businessDate.split('-');
  return year && month && day ? `${day}/${month}/${year}` : businessDate;
}

export function RipotiScreen({
  shellClass,
  report,
  sharing,
  shareNotice,
  share,
  t,
}: {
  shellClass: string;
  report: PosDayReport;
  sharing: boolean;
  shareNotice: string;
  share: () => void;
  t: PosTranslate;
}) {
  return (
    <main
      className={`min-h-screen px-4 py-4${shellClass}`}
      style={{ background: 'var(--aurora-bg)' }}
    >
      <div className="mx-auto max-w-md">
        <section
          className="relative rounded-xl p-5"
          style={{ background: 'var(--aurora-card)', boxShadow: 'var(--aurora-shadow-lg)' }}
        >
          <div className="flex justify-center">
            <span className="-rotate-3">
              <MuhuriStamp variant="solid" label={t('stampSikuImefungwa')} />
            </span>
          </div>

          <p
            className="mt-4 text-center text-sm font-semibold"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            {t('reportForDate', { date: readableDate(report.businessDate) })}
          </p>

          <p
            className="mt-4 text-sm font-semibold uppercase"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            {`${t('salesCountLabel')} ${report.salesCount}`}
          </p>
          <p className="text-sm font-semibold" style={{ color: 'var(--aurora-text-secondary)' }}>
            {t('reportGross')}
          </p>
          <p
            className="aurora-display aurora-money text-4xl"
            style={{ color: 'var(--aurora-accent)' }}
          >
            {money(report.grossTotal)}
          </p>

          {report.byMethod.length > 0 && (
            <>
              <p
                className="mt-4 text-sm font-semibold uppercase"
                style={{ color: 'var(--aurora-text-secondary)' }}
              >
                {t('reportByMethod')}
              </p>
              <div className="mt-2 space-y-1">
                {report.byMethod.map((row) => (
                  <div
                    key={row.paymentMethod}
                    className="flex min-h-12 items-center justify-between gap-3"
                  >
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
                      {`${row.label ?? row.paymentMethod} · ${row.count}`}
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

          <p className="mt-4 text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
            {`${t('reportItemsSold')}: ${report.itemsSoldQuantity}`}
          </p>
        </section>

        {/* The held card repeated with the same "not in the total" sentence —
         * this is what makes the report honest, on the screen as on the paper. */}
        {report.declaredHeldCount > 0 && (
          <section
            className="mt-4 rounded-xl border p-4"
            style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-accent)' }}
          >
            <h2 className="text-lg font-bold" style={{ color: 'var(--aurora-accent-text)' }}>
              {t('reportHeldTitle')}
            </h2>
            <p className="mt-1 text-sm font-bold" style={{ color: 'var(--aurora-accent-text)' }}>
              {t('historyHeldTotal', {
                count: report.declaredHeldCount,
                amount: money(report.declaredHeldAmount),
              })}
            </p>
            <p
              className="mt-2 text-sm font-medium"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
              {t('reportHeldNote', { count: report.declaredHeldCount })}
            </p>
          </section>
        )}

        <p className="mt-4 text-base font-semibold" style={{ color: 'var(--aurora-success-text)' }}>
          {t('reportSentNote')}
        </p>

        {/* A failed paper never re-submits and never re-keys anything: the
         * record is already at the office, the copy says so, and the button
         * stays live. */}
        {shareNotice && (
          <p
            className="mt-3 text-sm font-semibold"
            style={{ color: 'var(--aurora-text-secondary)' }}
            role="status"
          >
            {shareNotice}
          </p>
        )}

        {/* NEVER auto-invoked: a share sheet that opens by itself is hostile,
         * and the rep may want to look at the numbers first. */}
        <button
          type="button"
          onClick={share}
          disabled={sharing}
          className="mt-4 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-lg border px-5 text-base font-bold disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            borderColor: 'var(--aurora-border)',
            background: 'var(--aurora-card)',
            color: 'var(--aurora-primary-text)',
          }}
        >
          {sharing ? (
            <RotateCw size={18} className="animate-spin" aria-hidden="true" />
          ) : (
            <Share2 size={18} aria-hidden="true" />
          )}
          {t('slabShareReport')}
        </button>
      </div>
    </main>
  );
}
