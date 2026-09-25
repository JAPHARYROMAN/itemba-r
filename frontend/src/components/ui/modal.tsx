'use client';
import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), summary, textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

let scrollLocks = 0;
let originalOverflow = '';

const PortalContext = createContext(false);
const WindowPortalContext = createContext<{ target: HTMLElement | null; active: boolean } | null>(
  null,
);
export function WindowModalProvider({
  target,
  active,
  children,
}: {
  target: HTMLElement | null;
  active: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ target, active }), [target, active]);
  return <WindowPortalContext.Provider value={value}>{children}</WindowPortalContext.Provider>;
}
/** Workspace windows must not clip dialogs when their content uses container queries. */
export function ModalPortalProvider({ children }: { children: React.ReactNode }) {
  return <PortalContext.Provider value>{children}</PortalContext.Provider>;
}

/** Share the system layer with confirmations and other workspace dialogs. */
export function ModalPortal({ children }: { children: React.ReactNode }) {
  const portal = useContext(PortalContext);
  const windowPortal = useContext(WindowPortalContext);
  if (windowPortal?.target)
    return createPortal(<div className="os-window-layer">{children}</div>, windowPortal.target);
  return portal && typeof document !== 'undefined'
    ? createPortal(<div className="os-system-layer">{children}</div>, document.body)
    : children;
}

function availableControls(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((control) => {
    let current: HTMLElement | null = control;
    while (current && current !== panel) {
      if (current instanceof HTMLDetailsElement && !current.open) {
        const summary = current.querySelector(':scope > summary');
        if (!summary?.contains(control)) return false;
      }
      if (
        current.hidden ||
        current.inert ||
        getComputedStyle(current).display === 'none' ||
        getComputedStyle(current).visibility === 'hidden'
      )
        return false;
      current = current.parentElement;
    }
    return true;
  });
}

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
  onChangeCapture?: React.FormEventHandler<HTMLDivElement>;
  placement?: 'center' | 'right';
  /** Stable trigger when this dialog opens from a menu or another temporary surface. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /** Hand off focus after the exit animation, when selecting another workspace. */
  onAfterClose?: () => void;
}

const SIZE_MAP: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
  '2xl': 'max-w-4xl',
  '3xl': 'max-w-6xl',
};

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  dismissOnBackdrop = true,
  children,
  footer,
  onChangeCapture,
  placement = 'center',
  returnFocusRef,
  onAfterClose,
}: ModalProps) {
  const portal = useContext(PortalContext);
  const windowPortal = useContext(WindowPortalContext);
  const [rendered, setRendered] = useState(open);
  const closing = rendered && !open;
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const unmountFocus = useRef<{ panel: HTMLElement | null; target: HTMLElement | null } | null>(
    null,
  );
  const afterClose = useRef(onAfterClose);
  useEffect(() => {
    afterClose.current = onAfterClose;
  }, [onAfterClose]);

  useEffect(() => {
    if (open) {
      // Capture the trigger before an autoFocus child mounts. Capturing after
      // mounting would remember the dialog input instead of the outside trigger.
      if (!rendered) restoreFocusRef.current = document.activeElement as HTMLElement | null;
      setRendered(true);
      return;
    }
    if (!rendered) return;

    const timer = window.setTimeout(() => {
      setRendered(false);
      afterClose.current?.();
    }, 160);
    return () => window.clearTimeout(timer);
  }, [open, rendered]);

  // Focus management: remember the trigger, focus the first control on open, restore on close
  useEffect(() => {
    // The first open render still returns null while the entrance surface mounts.
    if (!open || !rendered || windowPortal?.active === false) return;
    if (!restoreFocusRef.current)
      restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    const panel = panelRef.current;
    const focusable = panel ? availableControls(panel)[0] : null;
    const returnTarget = returnFocusRef?.current ?? restoreFocusRef.current;
    unmountFocus.current = { panel, target: returnTarget };
    if (!panel?.contains(document.activeElement)) (focusable ?? panel)?.focus();
    return () => {
      if (!windowPortal || panel?.contains(document.activeElement)) returnTarget?.focus?.();
      restoreFocusRef.current = null;
      unmountFocus.current = null;
    };
  }, [open, rendered, returnFocusRef, windowPortal]);

  // An immediately unmounted form loses its active element before passive cleanup.
  // Restore it while the panel still exists; animated closes use the effect above.
  useLayoutEffect(
    () => () => {
      const remembered = unmountFocus.current;
      if (remembered?.panel?.contains(document.activeElement)) remembered.target?.focus();
    },
    [],
  );

  // ESC to close + trap Tab focus within the dialog
  useEffect(() => {
    if (!open || windowPortal?.active === false) return;
    function onKey(e: KeyboardEvent) {
      if (windowPortal && !windowPortal.target?.contains(e.target as Node)) return;
      // A nested confirmation owns keyboard focus until it is dismissed.
      const activeDialog =
        e.target instanceof Element ? e.target.closest('[role="dialog"], dialog') : null;
      if (activeDialog && activeDialog !== panelRef.current?.closest('[role="dialog"]')) return;
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const nodes = availableControls(panel);
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
  }, [open, onClose, windowPortal]);

  // Prevent body scroll while open
  useEffect(() => {
    if (!open || windowPortal) return;
    if (scrollLocks === 0) originalOverflow = document.body.style.overflow;
    scrollLocks += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      scrollLocks -= 1;
      if (scrollLocks === 0) document.body.style.overflow = originalOverflow;
    };
  }, [open, windowPortal]);

  if (!rendered) return null;

  const surface = (
    <div
      onChangeCapture={onChangeCapture}
      className={`fixed inset-0 z-[1200] flex ${placement === 'right' ? 'justify-end' : 'items-center justify-center p-2 sm:p-4'} ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
      style={{ background: 'var(--aurora-overlay)' }}
      onClick={dismissOnBackdrop ? onClose : undefined}
      role="dialog"
      aria-modal={windowPortal ? undefined : true}
      aria-labelledby={titleId}
      aria-hidden={closing || undefined}
      inert={closing}
    >
      <div
        ref={panelRef}
        data-os-dialog
        tabIndex={-1}
        className={`relative w-full ${SIZE_MAP[size]} ${placement === 'right' ? 'h-full !max-h-full' : 'rounded-2xl'} shadow-2xl flex flex-col max-h-[92dvh] outline-none ${
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
        <div
          data-dialog-header
          className="flex shrink-0 items-start justify-between gap-3 px-4 sm:px-6 pt-5 pb-4 border-b"
          style={{ borderColor: 'var(--aurora-border)' }}
        >
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-[16px] font-semibold leading-snug break-words"
              style={{ color: 'var(--aurora-text)' }}
            >
              {title}
            </h2>
            {subtitle && (
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mt-2 -mr-2 flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-xl transition-colors hover:bg-[var(--aurora-bg-subtle)]"
            style={{ color: 'var(--aurora-text-muted)' }}
            aria-label="Close"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div
          data-dialog-body
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5"
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            data-dialog-footer
            className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-4 sm:px-6 py-4 border-t"
            style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
  if (windowPortal?.target)
    return createPortal(<div className="os-window-layer">{surface}</div>, windowPortal.target);
  return portal && typeof document !== 'undefined'
    ? createPortal(<div className="os-system-layer">{surface}</div>, document.body)
    : surface;
}
