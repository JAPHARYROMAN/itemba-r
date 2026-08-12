'use client';

import { Check, CheckCircle2, Share2 } from 'lucide-react';
import { type PosLang } from '../pos-i18n';
import type { PosScreen, PosTranslate, SaleResult, Session } from '../pos-types';
import { money } from '../pos-utils';
import { MobilePosHeader, MuhuriStamp } from '../pos-ui';

export function SuccessScreen({
  shellClass,
  session,
  online,
  pendingCount,
  syncing,
  lang,
  setLang,
  t,
  leaveTerminal,
  notice,
  saleResult,
  total,
  shareReceipt,
  receiptBusy = false,
  beginSale,
  setScreen,
  slabMode = false,
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
  notice: string;
  saleResult: SaleResult | null;
  total: number;
  shareReceipt: () => Promise<void>;
  /** True while the letterhead PDF is being fetched for the share sheet. */
  receiptBusy?: boolean;
  beginSale: () => void;
  setScreen: (screen: PosScreen) => void;
  /**
   * Kaunta shell mode: the slab owns MAUZO MAPYA, the sync token owns the
   * status chrome, and Kaunta has no home screen — so the header and the
   * new-sale/home buttons are hidden; SHIRIKI RISITI stays as the secondary
   * action above the slab. The green check circle gives way to the MUHURI
   * stamp — the Risiti IS the stamp moment (design direction §5.2). Classic
   * passes nothing — byte-identical.
   */
  slabMode?: boolean;
}) {
  // Held vs sent (spec-sales §4): the queued path is the only route into this
  // screen that leaves a notice standing (`savedOffline`); a server-confirmed
  // sale arrives with the notice cleared. Hollow seal = custody, never warning.
  const held = slabMode && Boolean(notice);
  return (
    <main
      className={`min-h-screen px-4 py-4${shellClass}`}
      style={{ background: 'var(--aurora-bg)' }}
    >
      {!slabMode && (
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
      )}
      <section className="mx-auto mt-12 max-w-md text-center">
        {slabMode ? (
          <div className="flex items-center justify-center gap-2">
            <MuhuriStamp
              variant={held ? 'hollow' : 'solid'}
              label={held ? t('stampImehifadhiwa') : t('stampImelipwa')}
            />
            {!held && (
              <Check size={22} style={{ color: 'var(--aurora-success)' }} aria-hidden="true" />
            )}
          </div>
        ) : (
          <div
            className="mx-auto flex h-20 w-20 items-center justify-center rounded-full"
            style={{ background: 'var(--aurora-success-subtle)', color: 'var(--aurora-success)' }}
          >
            <CheckCircle2 size={48} aria-hidden="true" />
          </div>
        )}
        {held && (
          <p
            className="mt-4 text-base font-medium"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            {t('custodyNote')}
          </p>
        )}
        <h1 className="mt-5 text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
          {slabMode ? t('saleComplete') : notice || t('saleComplete')}
        </h1>
        <p className="mt-2 text-lg font-semibold" style={{ color: 'var(--aurora-text-secondary)' }}>
          {money(Number(saleResult?.totalAmount ?? total))}
        </p>
        {saleResult?.salesOrderNumber && (
          <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
            {saleResult.salesOrderNumber}
          </p>
        )}
        <button
          type="button"
          onClick={() => void shareReceipt()}
          disabled={receiptBusy}
          className="mt-6 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-lg border px-5 text-base font-bold disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            borderColor: 'var(--aurora-border)',
            background: 'var(--aurora-card)',
            color: 'var(--aurora-text)',
          }}
        >
          <Share2 size={19} aria-hidden="true" />{' '}
          {receiptBusy ? t('preparingReceipt') : t('shareReceipt')}
        </button>
        {!slabMode && (
          <>
            <button
              type="button"
              onClick={beginSale}
              className="mt-3 min-h-16 w-full rounded-lg bg-brand-600 px-5 text-lg font-bold text-white transition hover:bg-brand-700"
            >
              {t('newSale')}
            </button>
            <button
              type="button"
              onClick={() => setScreen('home')}
              className="mt-3 min-h-12 w-full rounded-lg text-base font-semibold"
              style={{ color: 'var(--aurora-primary-text)' }}
            >
              {t('home')}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
