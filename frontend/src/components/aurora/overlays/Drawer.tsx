'use client';
import React, { useEffect } from 'react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  side?: 'right' | 'left';
  width?: string;
  className?: string;
}

export function Drawer({ open, onClose, title, children, side = 'right', width = '480px', className = '' }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  return (
    <>
      {open && (
        <div className="fixed inset-0" style={{ zIndex: 1300, background: 'var(--aurora-overlay)' }} onClick={onClose} />
      )}
      <div
        className={`fixed top-0 ${side === 'right' ? 'right-0' : 'left-0'} h-full flex flex-col overflow-hidden transition-transform duration-300 ${open ? 'translate-x-0' : side === 'right' ? 'translate-x-full' : '-translate-x-full'} ${className}`}
        style={{
          zIndex: 1300,
          width,
          background: 'var(--aurora-card)',
          borderLeft: side === 'right' ? '1px solid var(--aurora-border)' : undefined,
          borderRight: side === 'left' ? '1px solid var(--aurora-border)' : undefined,
          boxShadow: 'var(--aurora-shadow-lg)',
        }}>
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--aurora-border)' }}>
            <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>{title}</h2>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg"
              style={{ color: 'var(--aurora-text-muted)' }} aria-label="Close">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </>
  );
}
