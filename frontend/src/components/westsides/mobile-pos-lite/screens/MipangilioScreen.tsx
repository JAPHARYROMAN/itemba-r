'use client';

import { useState } from 'react';
import { LogOut, RotateCw } from 'lucide-react';
import { showToast } from '@/components/ui';
import type { MobilePosLiteBinding } from '@/lib/mobile-pos-lite-store';
import { isHapticsEnabled, setHapticsEnabled, tick } from '../pos-haptics';
import { type PosLang } from '../pos-i18n';
import { setPosTheme, usePosTheme } from '../pos-theme';
import type { PosTranslate, Session } from '../pos-types';

/**
 * Mipangilio — Kaunta settings (spec-leo §5): the identity card (who am I —
 * restores what the deleted home header showed), the language toggle, the
 * haptics toggle (persisted `itemba-pos-haptics`, default on), the catalog
 * re-sync row (offline-disabled, success toast), the Mchana/Usiku theme row
 * (persisted `itemba-pos-theme`, default Mchana), an app-version row, and
 * logout via the existing `leaveTerminal`. The theme row was held back until
 * Usiku actually existed — spec-leo §5 item 5 refused a dead "Usiku inakuja"
 * placeholder because a settings row that does nothing teaches that settings
 * do nothing, and said its appearance IS the announcement. This is that
 * appearance. Logout is disabled offline — login needs a network anyway, and
 * a half-logged-out shared phone offline is worse than a handed-over phone.
 */
export function MipangilioScreen({
  shellClass,
  session,
  binding,
  online,
  lang,
  setLang,
  leaveTerminal,
  syncCatalog,
  t,
}: {
  shellClass: string;
  session: Session;
  binding: MobilePosLiteBinding;
  online: boolean;
  lang: PosLang;
  setLang: (lang: PosLang) => void;
  leaveTerminal: () => Promise<void>;
  syncCatalog: (current: MobilePosLiteBinding) => Promise<void>;
  t: PosTranslate;
}) {
  const [haptics, setHaptics] = useState(isHapticsEnabled);
  const [resyncing, setResyncing] = useState(false);
  // Read straight from the theme store rather than mirroring it in local
  // state: the shell subscribes to the same store, so one write re-themes the
  // shell and re-labels this row from a single source of truth.
  const theme = usePosTheme();
  const usiku = theme === 'usiku';

  function toggleHaptics() {
    const next = !haptics;
    setHapticsEnabled(next);
    setHaptics(next);
    // A demo buzz when switching ON — we are inside the tap's gesture stack.
    if (next) tick();
  }

  function toggleTheme() {
    // Immediate: the write notifies the shell, the shell swaps one attribute,
    // and the CSS variables repaint every surface. No haptic here — §2.5's
    // scarcity rule keeps the four patterns for money and custody moments,
    // and the whole screen changing colour is its own confirmation.
    setPosTheme(usiku ? 'mchana' : 'usiku');
  }

  async function resyncCatalog() {
    if (resyncing) return;
    setResyncing(true);
    try {
      await syncCatalog(binding);
      showToast('success', t('settingsResync'), t('settingsResyncDone'));
    } catch {
      showToast('error', t('settingsResync'), t('couldNotComplete'));
    } finally {
      setResyncing(false);
    }
  }

  const identityRows: Array<{ label: string; value: string }> = [
    { label: t('settingsRep'), value: session.rep.name },
    {
      label: t('settingsTerminal'),
      value: `${session.terminal.name} · ${session.terminal.code}`,
    },
    { label: t('settingsBranch'), value: session.branch.name },
  ];

  return (
    <main
      className={`min-h-screen px-4 py-4${shellClass}`}
      style={{ background: 'var(--aurora-bg)' }}
    >
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
          {t('mipangilio')}
        </h1>
        <section
          className="mt-4 rounded-lg border"
          style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
        >
          {identityRows.map((row, index) => (
            <div
              key={row.label}
              className={`flex min-h-14 items-center justify-between gap-3 px-4${index > 0 ? ' border-t' : ''}`}
              style={index > 0 ? { borderColor: 'var(--aurora-border)' } : undefined}
            >
              <span
                className="text-sm font-semibold"
                style={{ color: 'var(--aurora-text-secondary)' }}
              >
                {row.label}
              </span>
              <span
                className="min-w-0 truncate text-right text-base font-semibold"
                style={{ color: 'var(--aurora-text)' }}
              >
                {row.value}
              </span>
            </div>
          ))}
        </section>
        <section
          className="mt-3 flex min-h-14 items-center justify-between gap-3 rounded-lg border px-4"
          style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--aurora-text-secondary)' }}>
            {t('settingsLanguage')}
          </span>
          <div className="flex gap-1">
            {(['sw', 'en'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                className="flex h-11 min-w-12 items-center justify-center rounded-lg border px-3 text-sm font-bold"
                style={
                  lang === code
                    ? {
                        borderColor: 'var(--aurora-primary)',
                        background: 'var(--aurora-primary-subtle)',
                        color: 'var(--aurora-primary-text)',
                      }
                    : {
                        borderColor: 'var(--aurora-border)',
                        color: 'var(--aurora-text-secondary)',
                      }
                }
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>
        </section>
        <section
          className="mt-3 rounded-lg border px-4 py-3"
          style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
        >
          <div className="flex min-h-11 items-center justify-between gap-3">
            <span
              className="text-sm font-semibold"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
              {t('settingsHaptics')}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={haptics}
              aria-label={t('settingsHaptics')}
              onClick={toggleHaptics}
              className="relative h-7 w-12 flex-shrink-0 rounded-full transition-colors"
              style={{
                background: haptics ? 'var(--aurora-primary)' : 'var(--aurora-bg-subtle)',
                boxShadow: haptics ? undefined : 'inset 0 0 0 1px var(--aurora-border)',
              }}
            >
              <span
                aria-hidden="true"
                className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${haptics ? 'left-6' : 'left-1'}`}
                style={{ boxShadow: 'var(--aurora-shadow)' }}
              />
            </button>
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            {t('settingsHapticsNote')}
          </p>
        </section>
        <section
          className="mt-3 rounded-lg border px-4 py-3"
          style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
        >
          <button
            type="button"
            onClick={() => void resyncCatalog()}
            disabled={!online || resyncing}
            className="inline-flex min-h-11 w-full items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              className="text-sm font-semibold"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
              {t('settingsResync')}
            </span>
            <RotateCw
              size={17}
              className={resyncing ? 'animate-spin' : ''}
              style={{ color: 'var(--aurora-primary)' }}
              aria-hidden="true"
            />
          </button>
          {!online && (
            <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              {t('needsNetwork')}
            </p>
          )}
        </section>
        {/* Mchana/Usiku (spec-leo §5 item 5): the same row shape as the
            haptics switch above — role, control, touch target, persistence,
            immediate effect — with both theme names flanking the track so the
            rep reads WHICH mode she is in, not just on/off. Swahili names in
            both catalogs: they are the modes' names, not a translation. */}
        <section
          className="mt-3 rounded-lg border px-4 py-3"
          style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
        >
          <div className="flex min-h-11 items-center justify-between gap-3">
            <span
              className="text-sm font-semibold"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
              {t('settingsTheme')}
            </span>
            <div className="flex items-center gap-2">
              <span
                className="text-sm font-bold"
                style={{ color: usiku ? 'var(--aurora-text-muted)' : 'var(--aurora-text)' }}
              >
                {t('settingsThemeMchana')}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={usiku}
                aria-label={t('settingsTheme')}
                onClick={toggleTheme}
                className="relative h-7 w-12 flex-shrink-0 rounded-full transition-colors"
                style={{
                  background: usiku ? 'var(--aurora-primary)' : 'var(--aurora-bg-subtle)',
                  boxShadow: usiku ? undefined : 'inset 0 0 0 1px var(--aurora-border)',
                }}
              >
                <span
                  aria-hidden="true"
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${usiku ? 'left-6' : 'left-1'}`}
                  style={{ boxShadow: 'var(--aurora-shadow)' }}
                />
              </button>
              <span
                className="text-sm font-bold"
                style={{ color: usiku ? 'var(--aurora-text)' : 'var(--aurora-text-muted)' }}
              >
                {t('settingsThemeUsiku')}
              </span>
            </div>
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            {t('settingsThemeNote')}
          </p>
        </section>
        <section
          className="mt-3 flex min-h-14 items-center justify-between gap-3 rounded-lg border px-4"
          style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--aurora-text-secondary)' }}>
            {t('settingsVersion')}
          </span>
          <span className="text-sm font-semibold" style={{ color: 'var(--aurora-text-muted)' }}>
            {process.env.NEXT_PUBLIC_APP_VERSION ?? '—'}
          </span>
        </section>
        <button
          type="button"
          onClick={() => void leaveTerminal()}
          disabled={!online}
          className="mt-8 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-lg border px-5 text-base font-bold disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            borderColor: 'var(--aurora-border)',
            background: 'var(--aurora-card)',
            color: 'var(--aurora-text)',
          }}
        >
          <LogOut size={19} aria-hidden="true" /> {t('logOut')}
        </button>
        {!online && (
          <p className="mt-2 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
            {t('needsNetwork')}
          </p>
        )}
      </div>
    </main>
  );
}
