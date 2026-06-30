'use client';
import React, { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const [rendered, setRendered] = useState(open);
  const closing = rendered && !open;
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      setRendered(true);
      return;
    }
    if (!rendered) return;

    const timer = window.setTimeout(() => setRendered(false), 160);
    return () => window.clearTimeout(timer);
  }, [open, rendered]);

  // Focus management: remember the trigger, focus the first control on open, restore on close
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (focusable ?? panel).focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  // ESC to close + trap Tab focus within the dialog
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (nodes.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !panel.contains(active)) {
        e.preventDefault();
        first.focus();
      }
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

  if (!rendered) return null;

  return (
    <div
      className={`fixed inset-0 z-[1200] flex items-center justify-center p-4 ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
      style={{ background: 'var(--aurora-overlay)' }}
      onClick={dismissOnBackdrop ? onClose : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`relative w-full ${SIZE_MAP[size]} rounded-2xl shadow-2xl flex flex-col max-h-[92vh] outline-none ${
          closing ? 'animate-scale-out' : 'animate-scale-in'
        }`}
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
            <h2 id={titleId} className="text-[16px] font-semibold leading-snug truncate" style={{ color: 'var(--aurora-text)' }}>
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
            <X aria-hidden className="h-4 w-4" />
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
