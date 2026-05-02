'use client';
import React from 'react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  loading?: boolean;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'default', loading = false }: ConfirmDialogProps) {
  const btnStyle = variant === 'danger'
    ? { background: 'var(--aurora-danger)', color: '#fff' }
    : { background: 'var(--aurora-primary)', color: '#fff' };

  return (
    <Modal open={open} onClose={onClose} title={title} description={description} size="sm">
      <div className="px-5 pb-5 pt-4 flex items-center justify-end gap-3">
        <button onClick={onClose} className="text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          style={{ background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-secondary)', border: '1px solid var(--aurora-border)' }}>
          {cancelLabel}
        </button>
        <button onClick={onConfirm} disabled={loading} className="text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
          style={btnStyle}>
          {loading ? 'Please wait...' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
