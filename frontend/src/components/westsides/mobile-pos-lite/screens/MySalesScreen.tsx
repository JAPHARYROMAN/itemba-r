'use client';

import { ArrowLeft, RotateCw } from 'lucide-react';
import type { DaySummary, PosScreen, PosTranslate } from '../pos-types';
import { money, pendingTime } from '../pos-utils';

export function MySalesScreen({
  shellClass,
  online,
  dayLoading,
  daySummary,
  t,
  setScreen,
}: {
  shellClass: string;
  online: boolean;
  dayLoading: boolean;
  daySummary: DaySummary | null;
  t: PosTranslate;
  setScreen: (screen: PosScreen) => void;
}) {
  return (
    <main
      className={`min-h-screen px-4 py-4${shellClass}`}
      style={{ background: 'var(--aurora-bg)' }}
    >
      <div className="mx-auto max-w-md">
        <button
          type="button"
          onClick={() => setScreen('home')}
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold"
          style={{ color: 'var(--aurora-primary-text)' }}
        >
          <ArrowLeft size={18} /> {t('back')}
        </button>
        <h1 className="mt-4 text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
          {t('mySalesToday')}
        </h1>
        {!online ? (
          <p
            className="mt-4 rounded-lg px-4 py-3 text-sm font-semibold"
            style={{
              background: 'var(--aurora-warning-subtle)',
              color: 'var(--aurora-warning-text)',
            }}
          >
            {t('needsNetwork')}
          </p>
        ) : dayLoading ? (
          <div className="mt-8 text-center">
            <RotateCw
              className="mx-auto h-6 w-6 animate-spin"
              style={{ color: 'var(--aurora-primary)' }}
              aria-hidden="true"
            />
          </div>
        ) : daySummary ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div
                className="rounded-lg border p-4"
                style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
              >
                <p
                  className="text-xs font-semibold uppercase"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  {t('salesCountLabel')}
                </p>
                <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
                  {daySummary.count}
                </p>
              </div>
              <div
                className="rounded-lg border p-4"
                style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
              >
                <p
                  className="text-xs font-semibold uppercase"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  {t('totalLabel')}
                </p>
                <p className="mt-1 text-xl font-bold" style={{ color: 'var(--aurora-text)' }}>
                  {money(daySummary.totalAmount)}
                </p>
              </div>
            </div>
            <section className="mt-4 space-y-2">
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
                  className="flex items-center justify-between rounded-lg border p-3"
                  style={{
                    background: 'var(--aurora-card)',
                    borderColor: 'var(--aurora-border)',
                  }}
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
                      {pendingTime(sale.createdAt)} - {sale.paymentMethod}
                    </p>
                  </div>
                  <p
                    className="ml-3 flex-shrink-0 text-sm font-bold"
                    style={{ color: 'var(--aurora-text)' }}
                  >
                    {money(Number(sale.totalAmount))}
                  </p>
                </div>
              ))}
            </section>
          </>
        ) : (
          <p
            className="mt-4 rounded-lg px-4 py-3 text-sm"
            style={{
              background: 'var(--aurora-danger-subtle)',
              color: 'var(--aurora-danger-text)',
            }}
          >
            {t('couldNotComplete')}
          </p>
        )}
      </div>
    </main>
  );
}
