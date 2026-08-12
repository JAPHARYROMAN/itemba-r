'use client';

import { ChevronRight, CloudOff, ShoppingCart } from 'lucide-react';
import { type PosLang } from '../pos-i18n';
import type { PosScreen, PosTranslate, Session } from '../pos-types';
import { MobilePosHeader } from '../pos-ui';

export function HomeScreen({
  shellClass,
  session,
  online,
  pendingCount,
  syncing,
  lang,
  setLang,
  t,
  leaveTerminal,
  beginSale,
  beginPurchase,
  openMySales,
  setScreen,
}: {
  shellClass: string;
  session: Session;
  online: boolean;
  pendingCount: number;
  syncing: boolean;
  lang: PosLang;
  setLang: (lang: PosLang) => void;
  t: PosTranslate;
  leaveTerminal: () => Promise<void>;
  beginSale: () => void;
  beginPurchase: () => void;
  openMySales: () => Promise<void>;
  setScreen: (screen: PosScreen) => void;
}) {
  return (
    <main
      className={`min-h-screen px-4 py-4${shellClass}`}
      style={{ background: 'var(--aurora-bg)' }}
    >
      <MobilePosHeader
        session={session}
        online={online}
        pendingCount={pendingCount}
        syncing={syncing}
        onLogout={leaveTerminal}
        lang={lang}
        setLang={setLang}
        t={t}
      />
      <section className="mx-auto mt-8 max-w-md">
        {!online && (
          <p
            className="mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold"
            style={{
              borderColor: 'var(--aurora-warning)',
              background: 'var(--aurora-warning-subtle)',
              color: 'var(--aurora-warning-text)',
            }}
          >
            <CloudOff size={17} aria-hidden="true" />{' '}
            {session.terminal.offlineCashEnabled ? t('offlineCanSell') : t('offline')}
          </p>
        )}
        <button
          type="button"
          onClick={beginSale}
          className="flex min-h-52 w-full flex-col items-center justify-center rounded-lg bg-brand-600 px-6 text-white shadow-lg transition active:scale-[0.98] hover:bg-brand-700"
        >
          <ShoppingCart size={44} strokeWidth={2.2} aria-hidden="true" />
          <span className="mt-4 text-2xl font-bold">{t('newSale')}</span>
        </button>
        {pendingCount > 0 && (
          <button
            type="button"
            onClick={() => setScreen('queue')}
            className="mt-4 flex min-h-14 w-full items-center justify-between rounded-lg border px-4 text-left"
            style={{
              borderColor: 'var(--aurora-warning)',
              background: 'var(--aurora-warning-subtle)',
              color: 'var(--aurora-warning-text)',
            }}
          >
            <span className="font-semibold">{t('waitingCount', { count: pendingCount })}</span>
            <ChevronRight size={19} aria-hidden="true" />
          </button>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => void openMySales()}
            className="min-h-16 rounded-lg border px-4 text-base font-bold"
            style={{
              borderColor: 'var(--aurora-border)',
              background: 'var(--aurora-card)',
              color: 'var(--aurora-text)',
            }}
          >
            {t('mySalesToday')}
          </button>
          {session.purchasesEnabled && (
            <button
              type="button"
              onClick={beginPurchase}
              className="min-h-16 rounded-lg border px-4 text-base font-bold"
              style={{
                borderColor: 'var(--aurora-border)',
                background: 'var(--aurora-card)',
                color: 'var(--aurora-text)',
              }}
            >
              {t('purchases')}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
