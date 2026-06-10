'use client';
import React, { useEffect, useRef } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional subtitle below the title */
  subtitle?: string;
  /** Width preset. Default: 'md' */
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  /** Whether the modal can be dismissed by clicking the backdrop */
  dismissOnBackdrop?: boolean;
  children: React.ReactNode;
  /** Buttons rendered in the footer row */
  footer?: React.ReactNode;
}

const SIZE_MAP: Record<string, string> = {
  sm:  'max-w-sm',
  md:  'max-w-lg',
  lg:  'max-w-2xl',
  xl:  'max-w-3xl',
  '2xl': 'max-w-4xl',
  '3xl': 'max-w-6xl',
};

export function Modal({
  open, onClose, title, subtitle, size = 'md',
  dismissOnBackdrop = true, children, footer,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-4 animate-fade-in"
      style={{ background: 'var(--aurora-overlay)' }}
      onClick={dismissOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        className={`relative w-full ${SIZE_MAP[size]} rounded-2xl shadow-2xl flex flex-col max-h-[92vh] animate-scale-in`}
        style={{
          background: 'var(--aurora-card)',
          color: 'var(--aurora-text)',
          boxShadow: 'var(--aurora-shadow-command)',
          border: '1px solid var(--aurora-border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b" style={{ borderColor: 'var(--aurora-border)' }}>
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold leading-snug truncate" style={{ color: 'var(--aurora-text)' }}>
              {title}
            </h2>
            {subtitle && (
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--aurora-bg-subtle)]"
            style={{ color: 'var(--aurora-text-muted)' }}
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            className="flex items-center justify-end gap-2 px-6 py-4 border-t"
            style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
