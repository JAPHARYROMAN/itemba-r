'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASS = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' };

// Duration of the exit animation, matches the tailwind scale-out/fade-out keyframes (0.15s).
const EXIT_DURATION = 150;

export function Modal({ open, onClose, title, description, children, size = 'md', className = '' }: ModalProps) {
  // `mounted` keeps the DOM present through the exit animation; `isClosing` triggers the exit keyframes.
  const [mounted, setMounted] = useState(open);
  const [isClosing, setIsClosing] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Begin the exit animation, then unmount after it completes.
  const beginClose = useCallback(() => {
    if (exitTimer.current) return; // already closing
    setIsClosing(true);
    exitTimer.current = setTimeout(() => {
      exitTimer.current = null;
      setMounted(false);
      setIsClosing(false);
    }, EXIT_DURATION);
  }, []);

  // React to the controlled `open` prop.
  useEffect(() => {
    if (open) {
      if (exitTimer.current) {
        clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
      setIsClosing(false);
      setMounted(true);
    } else if (mounted) {
      beginClose();
    }
  }, [open, mounted, beginClose]);

  // Clean up a pending exit timer on unmount.
  useEffect(() => () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }, []);

  // Escape-to-close and body-scroll-lock while the modal is visible (not during exit).
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

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 1200 }}>
      <div
        className={`absolute inset-0 ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
        style={{ background: 'var(--aurora-overlay)' }}
        onClick={onClose}
      />
      <div className={`relative w-full ${SIZE_CLASS[size]} rounded-aurora-lg overflow-hidden ${isClosing ? 'animate-scale-out' : 'animate-scale-in'} ${className}`}
        style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)', boxShadow: 'var(--aurora-shadow-command)' }}>
        {(title || description) && (
          <div className="flex items-start justify-between p-5 border-b" style={{ borderColor: 'var(--aurora-border)' }}>
            <div>
              {title && <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>{title}</h2>}
              {description && <p className="text-sm mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>{description}</p>}
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors ml-3 flex-shrink-0"
              style={{ color: 'var(--aurora-text-muted)', background: 'transparent' }}
              aria-label="Close modal">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
