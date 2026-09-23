'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import './toast.css';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
}

const TOAST_STYLES: Record<ToastType, { accent: string; icon: LucideIcon }> = {
  success: { accent: 'var(--aurora-success)', icon: CheckCircle2 },
  error: { accent: 'var(--aurora-danger)', icon: XCircle },
  warning: { accent: 'var(--aurora-warning)', icon: AlertTriangle },
  info: { accent: 'var(--aurora-info)', icon: Info },
};

let globalToast: ((type: ToastType, title: string, description?: string) => void) | null = null;

export function showToast(type: ToastType, title: string, description?: string) {
  globalToast?.(type, title, description);
}

function ToastCard({
  toast,
  hidden,
  onRemove,
  returnFocusRef,
}: {
  toast: Toast;
  hidden: boolean;
  onRemove: (id: string) => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [exiting, setExiting] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const remaining = useRef(toast.description ? 8000 : 6000);
  const persistent = toast.type === 'error' || toast.type === 'warning';
  const { accent, icon: Icon } = TOAST_STYLES[toast.type];

  useEffect(() => {
    if (exiting || persistent || hidden || hovered || focused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => setExiting(true), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [exiting, persistent, hidden, hovered, focused]);

  useEffect(() => {
    if (!exiting) return;
    const timer = window.setTimeout(() => onRemove(toast.id), 180);
    return () => window.clearTimeout(timer);
  }, [exiting, onRemove, toast.id]);

  function dismiss() {
    if (card.current?.contains(document.activeElement)) {
      const next = Array.from(
        card.current.parentElement?.querySelectorAll<HTMLButtonElement>(
          '.os-toast:not([inert]) > button',
        ) ?? [],
      ).find((button) => !card.current?.contains(button));
      const previous = returnFocusRef.current;
      if (next) next.focus();
      else if (
        previous?.isConnected &&
        !previous.closest('[hidden], [inert], [aria-hidden="true"]')
      ) {
        previous.focus({ preventScroll: true });
      }
    }
    setExiting(true);
  }

  return (
    <div
      ref={card}
      className={`os-toast ${exiting ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}
      style={{ borderInlineStartColor: accent }}
      aria-hidden={exiting || undefined}
      inert={exiting}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        if (
          event.relatedTarget instanceof HTMLElement &&
          !event.relatedTarget.closest('.os-toast-region')
        ) {
          returnFocusRef.current = event.relatedTarget;
        }
        setFocused(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <Icon aria-hidden className="os-toast-icon" style={{ color: accent }} />
      <div className="os-toast-copy">
        <p className="os-toast-title">{toast.title}</p>
        {toast.description && <p className="os-toast-description">{toast.description}</p>}
      </div>
      <button type="button" onClick={dismiss} aria-label={`Dismiss notification: ${toast.title}`}>
        <X aria-hidden size={16} />
      </button>
    </div>
  );
}

export function ToastProvider() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [hidden, setHidden] = useState(false);
  const nextId = useRef(0);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const remove = useCallback(
    (id: string) => setToasts((items) => items.filter((item) => item.id !== id)),
    [],
  );
  const add = useCallback((type: ToastType, title: string, description?: string) => {
    const id = String(++nextId.current);
    setToasts((items) => [...items, { id, type, title, description }]);
  }, []);

  useEffect(() => {
    globalToast = add;
    return () => {
      if (globalToast === add) globalToast = null;
    };
  }, [add]);

  useEffect(() => {
    const update = () => setHidden(document.visibilityState === 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  return (
    <div
      className="os-system-layer os-toast-region"
      role="region"
      aria-label="Feedback"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {toasts.map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          hidden={hidden}
          onRemove={remove}
          returnFocusRef={returnFocusRef}
        />
      ))}
    </div>
  );
}
