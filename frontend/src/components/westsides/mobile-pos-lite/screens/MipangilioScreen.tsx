'use client';

import { LogOut } from 'lucide-react';
import { type PosLang } from '../pos-i18n';
import type { PosTranslate, Session } from '../pos-types';

/**
 * Mipangilio — Kaunta settings, minimal v1 (spec-leo §5, Phase 2b subset):
 * the identity card (who am I — restores what the deleted home header showed),
 * the language toggle, an app-version row, and logout via the existing
 * `leaveTerminal`. The haptics toggle, catalog re-sync row and logout confirm
 * sheet arrive with Phase 3; the theme row is deliberately absent until the
 * Phase-5 Usiku toggle (a settings row that does nothing teaches that settings
 * do nothing). Logout is disabled offline — login needs a network anyway, and
 * a half-logged-out shared phone offline is worse than a handed-over phone.
 */
export function MipangilioScreen({
  shellClass,
  session,
  online,
  lang,
  setLang,
  leaveTerminal,
  t,
}: {
  shellClass: string;
  session: Session;
  online: boolean;
  lang: PosLang;
  setLang: (lang: PosLang) => void;
  leaveTerminal: () => Promise<void>;
  t: PosTranslate;
}) {
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
