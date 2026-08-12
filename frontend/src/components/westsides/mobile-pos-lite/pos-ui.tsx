'use client';

import { useState } from 'react';
import { CloudOff, LogOut, Wifi } from 'lucide-react';
import { type PosLang } from './pos-i18n';
import type { PosTranslate, Session } from './pos-types';

/**
 * Direct quantity entry: tap the number, type with the phone's numeric
 * keyboard, blur/Enter commits. Selling 40 crates must not take 40 taps.
 * Remounted via `key` when +/- change the quantity, so the draft never fights
 * external updates. An emptied or zeroed field restores the previous value —
 * removal stays an explicit action on the trash button.
 */
export function QuantityInput({
  value,
  label,
  onCommit,
}: {
  value: number;
  label: string;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  function commit() {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setDraft(String(value));
      return;
    }
    if (parsed !== value) onCommit(Math.min(parsed, 9999));
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={draft}
      aria-label={label}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value.replace(/\D/g, '').slice(0, 4))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      className="h-10 w-14 rounded-lg border text-center text-base font-bold"
      style={{
        borderColor: 'var(--aurora-border)',
        background: 'var(--aurora-card)',
        color: 'var(--aurora-text)',
      }}
    />
  );
}

export function MobilePosHeader({
  session,
  online,
  pendingCount,
  syncing,
  onLogout,
  lang,
  setLang,
  t,
}: {
  session: Session;
  online: boolean;
  pendingCount: number;
  syncing: boolean;
  onLogout: () => void;
  lang: PosLang;
  setLang: (lang: PosLang) => void;
  t: PosTranslate;
}) {
  return (
    <header className="mx-auto flex max-w-md items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-base font-bold" style={{ color: 'var(--aurora-text)' }}>
          {session.branch.name}
        </p>
        <p className="mt-0.5 truncate text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
          {session.rep.name}
        </p>
        <p
          className="mt-1 inline-flex items-center gap-1 text-xs font-semibold"
          style={{ color: online ? 'var(--aurora-success)' : 'var(--aurora-warning)' }}
        >
          {online ? <Wifi size={13} /> : <CloudOff size={13} />}
          {online
            ? pendingCount
              ? t('waitingCount', { count: pendingCount })
              : syncing
                ? t('sending')
                : t('ready')
            : t('offline')}
        </p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setLang(lang === 'sw' ? 'en' : 'sw')}
          className="flex h-11 min-w-11 items-center justify-center rounded-lg border px-2 text-xs font-bold"
          style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-secondary)' }}
          aria-label={lang === 'sw' ? 'Switch to English' : 'Badili kwenda Kiswahili'}
        >
          {lang === 'sw' ? 'EN' : 'SW'}
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="flex h-11 w-11 items-center justify-center rounded-lg border"
          style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-secondary)' }}
          aria-label={t('logOut')}
          title={t('logOut')}
        >
          <LogOut size={19} />
        </button>
      </div>
    </header>
  );
}
