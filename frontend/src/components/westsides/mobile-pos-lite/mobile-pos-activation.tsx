'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, LockKeyhole, Smartphone } from 'lucide-react';
import { backendPost } from '@/lib/api-client';
import {
  getMobilePosLiteBinding,
  saveMobilePosLiteBinding,
  type MobilePosLiteBinding,
} from '@/lib/mobile-pos-lite-store';
import { usePosLang } from './pos-i18n';

type ActivationResponse = {
  terminal: { code: string; name: string };
  company: { name: string };
  division: { name: string };
  branch: { name: string };
};

function deviceSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function MobilePosActivation() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { lang, setLang, t } = usePosLang();
  const [terminalCode, setTerminalCode] = useState(() => searchParams.get('terminal') ?? '');
  const [activationCode, setActivationCode] = useState(() => searchParams.get('code') ?? '');
  const [binding, setBinding] = useState<MobilePosLiteBinding | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMobilePosLiteBinding()
      .then(setBinding)
      .catch(() => undefined);
  }, []);

  async function activate() {
    if (!terminalCode.trim() || !activationCode.trim()) {
      setMessage(t('enterBothCodes'));
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const secret = deviceSecret();
      const session = await backendPost<ActivationResponse>('/mobile-pos-lite/activate', {
        terminalCode: terminalCode.trim(),
        activationCode: activationCode.trim(),
        deviceSecret: secret,
        deviceName:
          typeof navigator === 'undefined' ? 'Mobile device' : navigator.userAgent.slice(0, 120),
      });
      await saveMobilePosLiteBinding({
        terminalCode: session.terminal.code,
        deviceSecret: secret,
        activatedAt: new Date().toISOString(),
      });
      router.replace('/mobile-pos');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('notActivated'));
    } finally {
      setBusy(false);
    }
  }

  const langToggle = (
    <button
      type="button"
      onClick={() => setLang(lang === 'sw' ? 'en' : 'sw')}
      className="flex h-11 min-w-11 items-center justify-center rounded-lg border px-2 text-xs font-bold"
      style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-secondary)' }}
      aria-label={lang === 'sw' ? 'Switch to English' : 'Badili kwenda Kiswahili'}
    >
      {lang === 'sw' ? 'EN' : 'SW'}
    </button>
  );

  if (binding) {
    return (
      <main className="min-h-screen px-4 py-8" style={{ background: 'var(--aurora-bg)' }}>
        <section
          className="mx-auto max-w-md rounded-lg border p-6"
          style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-lg"
              style={{ background: 'var(--aurora-success-subtle)', color: 'var(--aurora-success)' }}
            >
              <CheckCircle2 size={26} aria-hidden="true" />
            </div>
            {langToggle}
          </div>
          <h1 className="mt-5 text-xl font-bold" style={{ color: 'var(--aurora-text)' }}>
            {t('phoneReady')}
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
            {t('alreadyConnected', { code: binding.terminalCode })}
          </p>
          <button
            type="button"
            onClick={() => router.replace('/mobile-pos')}
            className="mt-6 min-h-14 w-full rounded-lg bg-brand-600 px-4 text-base font-semibold text-white transition hover:bg-brand-700"
          >
            {t('openSales')}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8" style={{ background: 'var(--aurora-bg)' }}>
      <section
        className="mx-auto max-w-md rounded-lg border p-6"
        style={{
          background: 'var(--aurora-card)',
          borderColor: 'var(--aurora-border)',
          boxShadow: 'var(--aurora-shadow-lg)',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-lg"
            style={{ background: 'var(--aurora-primary-subtle)', color: 'var(--aurora-primary)' }}
          >
            <Smartphone size={25} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold" style={{ color: 'var(--aurora-text)' }}>
              {t('setupTitle')}
            </h1>
            <p className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
              {t('setupSubtitle')}
            </p>
          </div>
          {langToggle}
        </div>

        <label className="mt-6 block text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
          {t('terminalCodeLabel')}
          <input
            value={terminalCode}
            onChange={(event) => setTerminalCode(event.target.value.toUpperCase())}
            autoCapitalize="characters"
            className="aurora-input mt-2 min-h-14 w-full rounded-lg px-4 text-base font-semibold"
            placeholder="MPL-XXXXXX"
          />
        </label>
        <label className="mt-4 block text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
          {t('setupCodeLabel')}
          <input
            value={activationCode}
            onChange={(event) => setActivationCode(event.target.value)}
            className="aurora-input mt-2 min-h-14 w-full rounded-lg px-4 text-base"
            placeholder={t('setupCodeLabel')}
          />
        </label>

        {message && (
          <p
            className="mt-4 rounded-lg px-3 py-3 text-sm"
            style={{ background: 'var(--aurora-danger-subtle)', color: 'var(--aurora-danger)' }}
          >
            {message}
          </p>
        )}

        <button
          type="button"
          onClick={activate}
          disabled={busy}
          className="mt-6 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-base font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <LockKeyhole size={19} aria-hidden="true" />
          {busy ? t('connecting') : t('connectPhone')}
        </button>
      </section>
    </main>
  );
}
