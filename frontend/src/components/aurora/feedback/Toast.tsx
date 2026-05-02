'use client';
import React, { useState, useEffect, useCallback } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
}

const TOAST_STYLES: Record<ToastType, { bar: string; icon: React.ReactNode }> = {
  success: {
    bar: '#10b981',
    icon: <path d="M20 6 9 17l-5-5" strokeWidth={2.5}/>,
  },
  error: {
    bar: '#ef4444',
    icon: <><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>,
  },
  warning: {
    bar: '#f59e0b',
    icon: <><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4m0 4h.01" strokeLinecap="round"/></>,
  },
  info: {
    bar: '#06b6d4',
    icon: <><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01" strokeLinecap="round"/></>,
  },
};

let globalToast: ((type: ToastType, title: string, description?: string) => void) | null = null;

export function showToast(type: ToastType, title: string, description?: string) {
  if (globalToast) globalToast(type, title, description);
}

export function ToastProvider() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: ToastType, title: string, description?: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, type, title, description }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  useEffect(() => {
    globalToast = addToast;
    return () => { globalToast = null; };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 pointer-events-none" style={{ zIndex: 1400 }}>
      {toasts.map(t => {
        const s = TOAST_STYLES[t.type];
        return (
          <div key={t.id} className="pointer-events-auto flex items-start gap-3 rounded-aurora-lg px-4 py-3 min-w-64 max-w-sm animate-fade-up"
            style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)', boxShadow: 'var(--aurora-shadow-lg)', borderLeftColor: s.bar, borderLeftWidth: '3px' }}>
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: s.bar }}>
              {s.icon}
            </svg>
            <div className="min-w-0">
              <p className="text-sm font-medium" style={{ color: 'var(--aurora-text)' }}>{t.title}</p>
              {t.description && <p className="text-xs mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>{t.description}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
