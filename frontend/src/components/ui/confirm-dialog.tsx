'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
  onConfirm: () => void | Promise<void>;
  /** Primary close/cancel callback */
  onCancel?: () => void;
  /** Alias for onCancel (for consistency with Modal onClose pattern) */
  onClose?: () => void;
  loading?: boolean;
}

const BTN_VARIANTS = {
  danger: {
    background: 'var(--aurora-danger)',
    color: 'white',
  },
  warning: {
    background: 'var(--aurora-warning)',
    color: 'white',
  },
  default: {
    background: 'var(--aurora-primary)',
    color: 'white',
  },
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
  onClose,
  loading: loadingProp,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [rendered, setRendered] = useState(open);
  const loading = loadingProp ?? busy;
  const closing = rendered && !open;
  const handleCancel = useCallback(() => {
    (onCancel ?? onClose)?.();
  }, [onCancel, onClose]);

  useEffect(() => {
    if (open) {
      setRendered(true);
      return;
    }
    if (!rendered) return;

    const timer = window.setTimeout(() => setRendered(false), 160);
    return () => window.clearTimeout(timer);
  }, [open, rendered]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === 'Escape') handleCancel();
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, handleCancel]);

  // Focus management: capture the opener, move focus to the (safe) cancel
  // button, trap Tab inside the dialog, and restore focus on close.
  const containerRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement as HTMLElement | null;
      cancelRef.current?.focus();
      return;
    }
    openerRef.current?.focus?.();
    openerRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function trapTab(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !containerRef.current) return;
      const focusable = containerRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !containerRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !containerRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', trapTab);
    return () => window.removeEventListener('keydown', trapTab);
  }, [open]);

  if (!rendered) return null;

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-[1300] flex items-center justify-center p-4 ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
      style={{ background: 'var(--aurora-overlay)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="aurora-confirm-title"
    >
      <div
        className={`w-full max-w-sm rounded-2xl border p-6 ${closing ? 'animate-scale-out' : 'animate-scale-in'}`}
        style={{
          background: 'var(--aurora-card)',
          borderColor: 'var(--aurora-border)',
          boxShadow: 'var(--aurora-shadow-command)',
        }}
      >
        <div
          className="mb-4 flex h-10 w-10 items-center justify-center rounded-full"
          style={{
            background: variant === 'danger' ? 'var(--aurora-danger-bg)' : variant === 'warning' ? 'var(--aurora-warning-bg)' : 'var(--aurora-primary-subtle)',
            color: variant === 'danger' ? 'var(--aurora-danger-text)' : variant === 'warning' ? 'var(--aurora-warning-text)' : 'var(--aurora-primary-text)',
          }}
        >
          {variant === 'default' ? <CheckCircle2 aria-hidden className="h-5 w-5" /> : <AlertTriangle aria-hidden className="h-5 w-5" />}
        </div>
        <h2 id="aurora-confirm-title" className="text-[16px] font-semibold" style={{ color: 'var(--aurora-text)' }}>{title}</h2>
        <p className="text-[13px] mt-2" style={{ color: 'var(--aurora-text-muted)' }}>{message}</p>
        <div className="flex justify-end gap-2 mt-6">
          <button
            ref={cancelRef}
            onClick={handleCancel}
            disabled={loading}
            className="px-4 py-2 text-[13px] font-medium border rounded-lg hover:bg-[var(--aurora-bg-subtle)] transition-colors disabled:opacity-50"
            style={{ color: 'var(--aurora-text-secondary)', borderColor: 'var(--aurora-border)' }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="px-4 py-2 text-[13px] font-medium rounded-lg transition-colors disabled:opacity-50"
            style={BTN_VARIANTS[variant]}
          >
            {loading ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
