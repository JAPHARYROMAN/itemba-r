'use client';

import { AlertTriangle, ArrowLeft, Clock, RotateCw, Trash2 } from 'lucide-react';
import type { MobilePosLiteBinding, PendingMobilePosLiteSale } from '@/lib/mobile-pos-lite-store';
import type { PosScreen, PosTranslate } from '../pos-types';
import { money, pendingTime } from '../pos-utils';

export function QueueScreen({
  shellClass,
  binding,
  online,
  syncing,
  pendingSales,
  pendingCount,
  confirmRemoveId,
  setConfirmRemoveId,
  syncPendingSales,
  removePending,
  t,
  setScreen,
}: {
  shellClass: string;
  binding: MobilePosLiteBinding;
  online: boolean;
  syncing: boolean;
  pendingSales: PendingMobilePosLiteSale[];
  pendingCount: number;
  confirmRemoveId: string | null;
  setConfirmRemoveId: (id: string | null) => void;
  syncPendingSales: (current: MobilePosLiteBinding) => Promise<void>;
  removePending: (id: string) => Promise<void>;
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
          onClick={() => {
            setConfirmRemoveId(null);
            setScreen('home');
          }}
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold"
          style={{ color: 'var(--aurora-primary-text)' }}
        >
          <ArrowLeft size={18} /> {t('back')}
        </button>
        <h1 className="mt-4 text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
          {t('queueTitle')}
        </h1>
        {pendingCount > 0 && (
          <button
            type="button"
            onClick={() => void syncPendingSales(binding)}
            disabled={!online || syncing}
            className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RotateCw size={18} className={syncing ? 'animate-spin' : ''} aria-hidden="true" />
            {syncing ? t('sending') : t('sendNow')}
          </button>
        )}
        <section className="mt-4 space-y-3" aria-live="polite">
          {pendingSales.length === 0 && (
            <p
              className="rounded-lg border px-4 py-6 text-center text-sm font-medium"
              style={{
                borderColor: 'var(--aurora-border)',
                color: 'var(--aurora-text-secondary)',
              }}
            >
              {t('queueEmpty')}
            </p>
          )}
          {pendingSales.map((item) => {
            const failed = Boolean(item.lastError);
            return (
              <article
                key={item.id}
                className="rounded-lg border p-4"
                style={{
                  background: 'var(--aurora-card)',
                  borderColor: failed ? 'var(--aurora-danger)' : 'var(--aurora-border)',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-bold" style={{ color: 'var(--aurora-text)' }}>
                      {money(Number(item.totalAmount ?? 0))}
                    </p>
                    {item.lineSummary && (
                      <p
                        className="mt-0.5 truncate text-sm"
                        style={{ color: 'var(--aurora-text-secondary)' }}
                      >
                        {item.lineSummary}
                      </p>
                    )}
                    <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                      {pendingTime(item.createdAt)}
                    </p>
                  </div>
                  <span
                    className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold"
                    style={
                      failed
                        ? {
                            background: 'var(--aurora-danger-subtle)',
                            color: 'var(--aurora-danger-text)',
                          }
                        : {
                            background: 'var(--aurora-warning-subtle)',
                            color: 'var(--aurora-warning-text)',
                          }
                    }
                  >
                    {failed ? (
                      <AlertTriangle size={13} aria-hidden="true" />
                    ) : (
                      <Clock size={13} aria-hidden="true" />
                    )}
                    {failed ? t('queueFailed') : t('queueWaiting')}
                  </span>
                </div>
                {failed && (
                  <>
                    <p
                      className="mt-2 rounded-md px-3 py-2 text-xs"
                      style={{
                        background: 'var(--aurora-danger-subtle)',
                        color: 'var(--aurora-danger-text)',
                      }}
                    >
                      {item.lastError}
                    </p>
                    {confirmRemoveId === item.id ? (
                      <div
                        className="mt-3 rounded-md border p-3"
                        style={{ borderColor: 'var(--aurora-danger)' }}
                      >
                        <p className="text-sm font-bold" style={{ color: 'var(--aurora-text)' }}>
                          {t('removeConfirmTitle')}
                        </p>
                        <p
                          className="mt-1 text-xs"
                          style={{ color: 'var(--aurora-text-secondary)' }}
                        >
                          {t('removeConfirmBody')}
                        </p>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => void removePending(item.id)}
                            className="min-h-11 flex-1 rounded-lg px-3 text-sm font-bold text-white"
                            style={{ background: 'var(--aurora-danger)' }}
                          >
                            {t('confirmRemove')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRemoveId(null)}
                            className="min-h-11 flex-1 rounded-lg border px-3 text-sm font-semibold"
                            style={{
                              borderColor: 'var(--aurora-border)',
                              color: 'var(--aurora-text)',
                            }}
                          >
                            {t('keepIt')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(item.id)}
                        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-semibold"
                        style={{
                          borderColor: 'var(--aurora-border)',
                          color: 'var(--aurora-danger)',
                        }}
                      >
                        <Trash2 size={15} aria-hidden="true" /> {t('remove')}
                      </button>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
