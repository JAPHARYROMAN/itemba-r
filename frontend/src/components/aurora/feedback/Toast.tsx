'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  exiting?: boolean;
}

const TOAST_STYLES: Record<ToastType, { accent: string; icon: LucideIcon }> = {
  success: {
    accent: 'var(--aurora-success)',
    icon: CheckCircle2,
  },
  error: {
    accent: 'var(--aurora-danger)',
    icon: XCircle,
  },
  warning: {
    accent: 'var(--aurora-warning)',
    icon: AlertTriangle,
  },
  info: {
    accent: 'var(--aurora-info)',
    icon: Info,
  },
};

let globalToast: ((type: ToastType, title: string, description?: string) => void) | null = null;

export function showToast(type: ToastType, title: string, description?: string) {
  if (globalToast) globalToast(type, title, description);
}

export function ToastProvider() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<number[]>([]);

  const schedule = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(callback, delay);
    timersRef.current.push(timer);
    return timer;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.map(t => (t.id === id ? { ...t, exiting: true } : t)));
    schedule(() => setToasts(prev => prev.filter(t => t.id !== id)), 180);
  }, [schedule]);

  const addToast = useCallback((type: ToastType, title: string, description?: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, type, title, description }]);
    schedule(() => dismissToast(id), 4000);
  }, [dismissToast, schedule]);

  useEffect(() => {
    globalToast = addToast;
    return () => { globalToast = null; };
  }, [addToast]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => window.clearTimeout(timer));
      timersRef.current = [];
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 flex flex-col gap-2 pointer-events-none"
      style={{ zIndex: 1400 }}
      aria-live="polite"
      aria-relevant="additions text"
    >
      {toasts.map(t => {
        const s = TOAST_STYLES[t.type];
        const Icon = s.icon;
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex min-w-64 max-w-sm items-start gap-3 rounded-aurora-lg px-4 py-3 ${
              t.exiting ? 'animate-slide-out-right' : 'animate-slide-in-right'
            }`}
            style={{
              background: 'var(--aurora-card)',
              border: '1px solid var(--aurora-border)',
              boxShadow: 'var(--aurora-shadow-lg)',
              borderLeftColor: s.accent,
              borderLeftWidth: '3px',
            }}
          >
            <Icon aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: s.accent }} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium" style={{ color: 'var(--aurora-text)' }}>{t.title}</p>
              {t.description && <p className="text-xs mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>{t.description}</p>}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="ml-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--aurora-bg-subtle)]"
              style={{ color: 'var(--aurora-text-muted)' }}
              aria-label="Dismiss notification"
            >
              <X aria-hidden className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
