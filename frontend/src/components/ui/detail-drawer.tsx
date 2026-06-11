'use client';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface DetailDrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: 'sm' | 'md' | 'lg';
}

const WIDTHS = {
  sm: 'w-full max-w-sm',
  md: 'w-full max-w-lg',
  lg: 'w-full max-w-2xl',
};

export function DetailDrawer({ open, title, subtitle, onClose, children, width = 'md' }: DetailDrawerProps) {
  const [rendered, setRendered] = useState(open);
  const closing = rendered && !open;

  useEffect(() => {
    if (open) {
      setRendered(true);
      return;
    }
    if (!rendered) return;

    const timer = window.setTimeout(() => setRendered(false), 180);
    return () => window.clearTimeout(timer);
  }, [open, rendered]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!rendered) return null;

  return (
    <div
      className={`fixed inset-0 z-40 flex justify-end ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="aurora-drawer-title"
    >
      {/* Overlay */}
      <div className="absolute inset-0" style={{ background: 'var(--aurora-overlay)' }} onClick={onClose} aria-hidden />

      {/* Panel */}
      <aside
        className={`relative ${WIDTHS[width]} h-full border-l shadow-drawer flex flex-col ${
          closing ? 'animate-slide-out-right' : 'animate-slide-in-right'
        }`}
        style={{
          background: 'var(--aurora-card)',
          borderColor: 'var(--aurora-border)',
          color: 'var(--aurora-text)',
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--aurora-border)' }}>
          <div className="min-w-0">
            <h2 id="aurora-drawer-title" className="text-[16px] font-semibold leading-tight" style={{ color: 'var(--aurora-text)' }}>{title}</h2>
            {subtitle && <p className="text-[12px] mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1.5 rounded-md hover:bg-[var(--aurora-bg-subtle)] transition-colors"
            style={{ color: 'var(--aurora-text-muted)' }}
            aria-label="Close"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  );
}
