'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { ShieldCheck, RotateCw } from 'lucide-react';
import type { PendingMobilePosLiteSale } from '@/lib/mobile-pos-lite-store';
import type { CheckoutObservation } from '../core/checkout-recovery';
import type { PosTranslate } from '../core/pos-types';
import { money } from '../core/pos-utils';
import { usePosHost } from '../core/pos-host-context';
import './pos-app.css';

export function CheckoutRecoveryPanel({
  attempt,
  t,
  lang,
  onCheck,
  onRetry,
}: {
  attempt: PendingMobilePosLiteSale;
  t: PosTranslate;
  lang: string;
  onCheck: () => Promise<CheckoutObservation>;
  onRetry: () => Promise<void>;
}) {
  const titleId = useId();
  const host = usePosHost();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!host || host.ownsInput(heading.current)) heading.current?.focus();
  }, [host]);
  const [busy, setBusy] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [message, setMessage] = useState('');
  async function check(retry = false) {
    if (busy) return;
    setBusy(true);
    setCanRetry(false);
    setMessage('');
    try {
      if (retry) await onRetry();
      else {
        const outcome = await onCheck();
        setCanRetry(outcome.state === 'not_found');
        if (outcome.state !== 'confirmed')
          setMessage(
            t(outcome.state === 'not_found' ? 'posRecoveryMissing' : 'posRecoveryManager'),
          );
      }
    } catch {
      setMessage(t('posRecoveryNote'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="pos-app pos-recovery" lang={lang}>
      <section className="pos-recovery-card" aria-labelledby={titleId} aria-busy={busy}>
        <ShieldCheck size={36} aria-hidden="true" />
        <span className="pos-eyebrow">ITEMBA POS</span>
        <h1 id={titleId} ref={heading} tabIndex={-1}>
          {t('posRecoveryTitle')}
        </h1>
        <p>{t('posRecoveryNote')}</p>
        <strong className="pos-recovery-total pos-num">{money(attempt.totalAmount ?? 0)}</strong>
        <p>{attempt.lineSummary}</p>
        <p className="pos-hint">
          {attempt.payload.paymentMethod} · {attempt.payload.paymentReference}
        </p>
        <p role="status" aria-live="polite">
          {message}
        </p>
        <button className="pos-btn pos-btn-primary" disabled={busy} onClick={() => void check()}>
          <RotateCw size={18} aria-hidden="true" />
          {t(busy ? 'posRecoveryChecking' : 'posRecoveryCheck')}
        </button>
        {canRetry && (
          <button className="pos-btn" disabled={busy} onClick={() => void check(true)}>
            {t('posRecoveryRetry')}
          </button>
        )}
      </section>
    </main>
  );
}
