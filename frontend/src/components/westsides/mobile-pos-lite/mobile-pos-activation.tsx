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
  const [terminalCode, setTerminalCode] = useState(() => searchParams.get('terminal') ?? '');
  const [activationCode, setActivationCode] = useState(() => searchParams.get('code') ?? '');
  const [binding, setBinding] = useState<MobilePosLiteBinding | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMobilePosLiteBinding().then(setBinding).catch(() => undefined);
  }, []);

  async function activate() {
    if (!terminalCode.trim() || !activationCode.trim()) {
      setMessage('Enter the terminal code and setup code.');
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
        deviceName: typeof navigator === 'undefined' ? 'Mobile device' : navigator.userAgent.slice(0, 120),
      });
      await saveMobilePosLiteBinding({
        terminalCode: session.terminal.code,
        deviceSecret: secret,
        activatedAt: new Date().toISOString(),
      });
      router.replace('/mobile-pos');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'This device could not be activated.');
    } finally {
      setBusy(false);
    }
  }

  if (binding) {
    return (
      <main className="min-h-screen px-4 py-8" style={{ background: 'var(--aurora-bg)' }}>
        <section className="mx-auto max-w-md rounded-lg border p-6" style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}>
          <div className="flex h-12 w-12 items-center justify-center rounded-lg" style={{ background: 'var(--aurora-success-subtle)', color: 'var(--aurora-success)' }}>
            <CheckCircle2 size={26} aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-xl font-bold" style={{ color: 'var(--aurora-text)' }}>This phone is ready</h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
            Terminal {binding.terminalCode} is already connected to this sales rep.
          </p>
          <button type="button" onClick={() => router.replace('/mobile-pos')} className="mt-6 min-h-14 w-full rounded-lg bg-brand-600 px-4 text-base font-semibold text-white transition hover:bg-brand-700">
            Open Sales
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8" style={{ background: 'var(--aurora-bg)' }}>
      <section className="mx-auto max-w-md rounded-lg border p-6" style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)', boxShadow: 'var(--aurora-shadow-lg)' }}>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg" style={{ background: 'var(--aurora-primary-subtle)', color: 'var(--aurora-primary)' }}>
            <Smartphone size={25} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--aurora-text)' }}>Set up this POS</h1>
            <p className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>Use the code issued by your group admin.</p>
          </div>
        </div>

        <label className="mt-6 block text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Terminal code
          <input value={terminalCode} onChange={(event) => setTerminalCode(event.target.value.toUpperCase())} autoCapitalize="characters" className="aurora-input mt-2 min-h-14 w-full rounded-lg px-4 text-base font-semibold" placeholder="MPL-XXXXXX" />
        </label>
        <label className="mt-4 block text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Setup code
          <input value={activationCode} onChange={(event) => setActivationCode(event.target.value)} className="aurora-input mt-2 min-h-14 w-full rounded-lg px-4 text-base" placeholder="Setup code" />
        </label>

        {message && <p className="mt-4 rounded-lg px-3 py-3 text-sm" style={{ background: 'var(--aurora-danger-subtle)', color: 'var(--aurora-danger)' }}>{message}</p>}

        <button type="button" onClick={activate} disabled={busy} className="mt-6 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-base font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60">
          <LockKeyhole size={19} aria-hidden="true" />
          {busy ? 'Connecting...' : 'Connect this phone'}
        </button>
      </section>
    </main>
  );
}
