'use client';
import React, { useEffect, useId, useRef, useState } from 'react';

/**
 * The parts every form field wears: label, hint, error, focus/error styling and
 * the aria wiring that binds them together.
 *
 * These live apart from `forms.tsx` because the date field is built on React
 * Aria rather than a bare `<input>`, and it has to look and announce itself
 * exactly like its neighbours. Sharing the chrome is what makes that true by
 * construction instead of by careful copying.
 */

// Inputs use the `aurora-input` utility class defined in globals.css, which
// already wires up bg/text/border/placeholder against the theme tokens for
// both light and dark mode. We only add layout + width here. transition-all
// (not transition-colors) so the focus ring — a box-shadow — animates too.
export const INPUT_BASE =
  'aurora-input w-full px-3 py-2 text-[13px] rounded-lg ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all duration-150 ' +
  'disabled:cursor-not-allowed';

/** Border/ring treatment for the three field states. */
export function fieldStateClasses(error?: string, success?: boolean) {
  if (error) return 'border-red-400 focus:ring-red-400 focus:border-red-400';
  if (success) return 'border-emerald-400 focus:ring-emerald-400 focus:border-emerald-400';
  return '';
}

/**
 * Shake the field once whenever a NEW error appears (not on every render with
 * the same error, and never re-mounting the input — focus and value survive).
 */
export function useShakeOnError(error?: string) {
  const [shaking, setShaking] = useState(false);
  const prev = useRef(error);
  useEffect(() => {
    if (error && error !== prev.current) {
      setShaking(true);
      const t = setTimeout(() => setShaking(false), 320);
      prev.current = error;
      return () => clearTimeout(t);
    }
    prev.current = error;
  }, [error]);
  return shaking ? ' animate-shake' : '';
}

export function SuccessCheck() {
  return (
    <span
      className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 animate-fade-in"
      style={{ color: 'var(--aurora-success, #10b981)' }}
      aria-hidden="true"
    >
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </span>
  );
}

/**
 * Exposed as values, not just baked into `Label` below, because the date field
 * has to label a composite widget and therefore renders React Aria's own
 * `<Label>` element. Sharing these keeps the two visually identical.
 */
export const LABEL_CLASS = 'block text-[12px] font-medium mb-1';
export const LABEL_STYLE: React.CSSProperties = { color: 'var(--aurora-text-secondary)' };

export function RequiredMark() {
  return (
    <span className="ml-0.5" style={{ color: 'var(--aurora-danger)' }}>
      *
    </span>
  );
}

export function Label({
  children,
  required,
  htmlFor,
}: {
  children: React.ReactNode;
  required?: boolean;
  htmlFor?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={LABEL_CLASS} style={LABEL_STYLE}>
      {children}
      {required && <RequiredMark />}
    </label>
  );
}

export function Hint({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <p id={id} className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
      {children}
    </p>
  );
}

export function FieldError({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <p
      id={id}
      role="alert"
      className="mt-1 text-[11px] flex items-center gap-1 animate-fade-in"
      style={{ color: 'var(--aurora-danger)' }}
    >
      <svg
        className="w-3 h-3 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" d="M12 8v4m0 4h.01" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

/**
 * Field accessibility wiring shared by every form primitive: a stable id for
 * the control (caller-provided `id` wins), plus aria-invalid/aria-describedby
 * pointing at the error (announced via role="alert") or hint element.
 */
export function useFieldA11y(propsId: string | undefined, error?: string, hint?: string) {
  const autoId = useId();
  const fieldId = propsId ?? autoId;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  return {
    fieldId,
    errorId,
    hintId,
    aria: {
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? errorId : hint ? hintId : undefined,
    } as const,
  };
}
