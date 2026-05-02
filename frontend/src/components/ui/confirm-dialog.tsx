'use client';
import { useCallback, useEffect, useState } from 'react';

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
  danger: 'bg-red-600 hover:bg-red-700 text-white',
  warning: 'bg-amber-500 hover:bg-amber-600 text-white',
  default: 'bg-zinc-900 hover:bg-zinc-700 text-white',
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
  const loading = loadingProp ?? busy;
  const handleCancel = useCallback(() => {
    (onCancel ?? onClose)?.();
  }, [onCancel, onClose]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === 'Escape') handleCancel();
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, handleCancel]);

  if (!open) return null;

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-card-md border border-zinc-200 w-full max-w-sm p-6">
        <h2 className="text-[16px] font-semibold text-zinc-900">{title}</h2>
        <p className="text-[13px] text-zinc-500 mt-2">{message}</p>
        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={handleCancel}
            disabled={loading}
            className="px-4 py-2 text-[13px] font-medium text-zinc-600 border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className={`px-4 py-2 text-[13px] font-medium rounded-lg transition-colors disabled:opacity-50 ${BTN_VARIANTS[variant]}`}
          >
            {loading ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
