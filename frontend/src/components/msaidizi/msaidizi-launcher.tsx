'use client';

/**
 * The launcher — and it is ONLY a launcher.
 *
 * ─── The precedent, followed exactly ────────────────────────────────────────
 *
 * `CommandPaletteProvider` mounts its overlay as a sibling of `{children}` in
 * the dashboard layout, owns one `document.keydown` listener, exposes
 * `open/close/toggle` through context — and navigates. It does not try to be the
 * destination. This is the same shape, nested inside it, on `Ctrl/⌘+J`.
 *
 * It renders no steps, no answer, and no thread of its own. A compact thread
 * here that "continues on the page" was considered and rejected: it is the
 * docked panel again under a different name — two renderers, two scroll states,
 * and a handover mid-stream where the SSE reader has to survive a route change.
 * One input, one navigation, and the run streams on the page.
 *
 * ─── The POS boundary, enforced by where this hangs ─────────────────────────
 *
 * `layout.tsx` strips the entire ERP shell for `/mobile-pos` and
 * `/westsides/mobile-pos`, and `isPosOnlyUser()` hard-redirects POS-only users
 * out of the shell entirely. This provider is mounted INSIDE the non-POS arm, so
 * the launcher — button, shortcut and all — is structurally absent from Kaunta.
 * The boundary is enforced by where the component hangs, not by a runtime check
 * someone can forget to write. There is no `if (pathname.startsWith('/mobile-pos'))`
 * anywhere in this file, and there must never be one: a check like that would be
 * a second, weaker copy of a guarantee the tree already gives for free.
 *
 * ─── Why the shortcut and the button are gated on the permission ────────────
 *
 * `msaidizi.use` is granted deliberately, to one role to begin with. An
 * unpermitted capability is invisible, never refused — the same rule the backend
 * applies to tools and `PermissionGate` applies to UI. So a user without it gets
 * no button and a `Ctrl+J` that does nothing, rather than a door that says no.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { AppIcon } from '@/components/ui/icon-set';

export const MSAIDIZI_PERMISSION = 'msaidizi.use';
export const MSAIDIZI_ROUTE = '/msaidizi';

/** The launcher's question rides the URL under this key; the page reads it once. */
export const MSAIDIZI_ASK_PARAM = 'ask';

interface MsaidiziLauncherValue {
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** False when this user has no `msaidizi.use`, and outside the provider. */
  available: boolean;
}

const Ctx = createContext<MsaidiziLauncherValue>({
  open: () => {},
  close: () => {},
  toggle: () => {},
  available: false,
});

export function useMsaidiziLauncher(): MsaidiziLauncherValue {
  return useContext(Ctx);
}

export function msaidiziHref(question?: string | null): string {
  const trimmed = question?.trim() ?? '';
  if (!trimmed) return MSAIDIZI_ROUTE;
  return `${MSAIDIZI_ROUTE}?${MSAIDIZI_ASK_PARAM}=${encodeURIComponent(trimmed)}`;
}

export function MsaidiziLauncherProvider({ children }: { children: React.ReactNode }) {
  const { hasPermission, loading } = useAuth();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  const available = !loading && hasPermission(MSAIDIZI_PERMISSION);

  useEffect(() => {
    if (!available) return;
    function handleKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setIsOpen((previous) => !previous);
        return;
      }
      if (event.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [available]);

  const launch = useCallback(
    (question: string) => {
      setIsOpen(false);
      router.push(msaidiziHref(question));
    },
    [router],
  );

  const value = useMemo<MsaidiziLauncherValue>(
    () => ({
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((previous) => !previous),
      available,
    }),
    [available],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {available && isOpen && (
        <MsaidiziLauncherDialog onSubmit={launch} onClose={() => setIsOpen(false)} />
      )}
    </Ctx.Provider>
  );
}

function MsaidiziLauncherDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (question: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      data-testid="msaidizi-launcher-dialog"
      className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[18vh]"
      style={{ background: 'rgba(9, 9, 11, 0.45)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Ask Msaidizi"
      onClick={onClose}
    >
      <form
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value);
        }}
        className="w-full max-w-lg rounded-xl border p-3"
        style={{
          background: 'var(--aurora-card-elevated, var(--aurora-card))',
          borderColor: 'var(--aurora-border)',
          boxShadow: 'var(--aurora-shadow)',
        }}
      >
        <label className="sr-only" htmlFor="msaidizi-launcher-input">
          Ask Msaidizi
        </label>
        <div className="flex items-center gap-2.5">
          <span style={{ color: 'var(--aurora-text-muted)' }}>
            <AppIcon name="assistant" size={16} />
          </span>
          <input
            id="msaidizi-launcher-input"
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Ask Msaidizi…"
            className="flex-1 bg-transparent text-[14px] outline-none"
            style={{ color: 'var(--aurora-text)' }}
          />
          <button
            type="submit"
            className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium"
            style={{ background: 'var(--aurora-primary)', color: '#fff' }}
          >
            Ask
          </button>
        </div>
        <p className="mt-2 text-[11.5px]" style={{ color: 'var(--aurora-text-muted)' }}>
          Opens the conversation and runs your question there. Press Esc to close.
        </p>
      </form>
    </div>
  );
}

/**
 * The topbar entry.
 *
 * Renders nothing outside the provider, because `available` defaults to false in
 * the context — so it cannot appear in the POS shell even if someone later
 * pastes it into a header that lives there.
 */
export function MsaidiziTopbarButton({ className = '' }: { className?: string }) {
  const { available, open } = useMsaidiziLauncher();
  if (!available) return null;

  return (
    <button
      type="button"
      data-testid="msaidizi-launcher-button"
      onClick={open}
      aria-label="Ask Msaidizi (Ctrl+J)"
      title="Ask Msaidizi  ·  Ctrl+J"
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors hover:bg-[var(--aurora-bg-subtle)] ${className}`}
      style={{ color: 'var(--aurora-text-muted)' }}
    >
      <AppIcon name="assistant" size={15} />
      <span className="hidden md:block">Msaidizi</span>
    </button>
  );
}
