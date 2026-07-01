'use client';

import React, { useCallback, useMemo, useState } from 'react';

/* ─── Types ──────────────────────────────────────────────────────────────────── */

export interface StepperStep {
  /** Stable unique identifier for the step. */
  key: string;
  /** Human-readable title shown in the progress header. */
  title: string;
  /** Optional short description shown under the title (active step only). */
  description?: string;
  /** Marks a step as skippable — Next reads "Skip" when the step has no content changes. */
  optional?: boolean;
}

/** Status of a step relative to the current position. */
export type StepStatus = 'completed' | 'active' | 'upcoming';

/**
 * Per-step validation hook. Return `false` (or a rejected/`false` promise) to
 * block advancing past the step. Returning `true`, `undefined`, or `void`
 * allows Next/Finish to proceed. Errors are treated as "blocked".
 */
export type StepValidate = (
  step: StepperStep,
  index: number,
) => boolean | void | Promise<boolean | void>;

export interface StepperRenderContext {
  step: StepperStep;
  index: number;
  total: number;
  isFirst: boolean;
  isLast: boolean;
  status: StepStatus;
  goTo: (index: number) => void;
  next: () => void;
  back: () => void;
}

export interface StepperProps {
  steps: StepperStep[];
  /** Controlled active step index. Omit for uncontrolled mode. */
  current?: number;
  /** Initial step index in uncontrolled mode. Defaults to 0. */
  defaultStep?: number;
  /** Notified whenever the active step changes (both modes). */
  onStepChange?: (index: number, step: StepperStep) => void;
  /**
   * Called when Next/Finish is attempted. Return `false`/rejected/`false`
   * promise to block. Runs before advancing (and before `onFinish`).
   */
  validate?: StepValidate;
  /** Invoked when Finish succeeds on the last step. */
  onFinish?: () => void | Promise<void>;
  /**
   * Content for the current step. Either a render function receiving context,
   * or a static node. Prefer the render function for multi-step flows.
   */
  children?: React.ReactNode | ((ctx: StepperRenderContext) => React.ReactNode);
  /** Allow clicking a completed step in the header to jump back. Default true. */
  allowStepNavigation?: boolean;
  /** Hide the built-in Back/Next/Finish footer (drive navigation yourself). */
  hideFooter?: boolean;
  backLabel?: string;
  nextLabel?: string;
  finishLabel?: string;
  /** External busy state — disables footer actions and shows a spinner on the primary button. */
  loading?: boolean;
  className?: string;
  contentClassName?: string;
}

/* ─── Helpers ────────────────────────────────────────────────────────────────── */

function statusFor(index: number, current: number): StepStatus {
  if (index < current) return 'completed';
  if (index === current) return 'active';
  return 'upcoming';
}

const CheckIcon = () => (
  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
  </svg>
);

const Spinner = () => (
  <span
    aria-hidden="true"
    className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
  />
);

/* ─── Component ──────────────────────────────────────────────────────────────── */

/**
 * Aurora multi-step wizard primitive. Dependency-free.
 *
 * Controlled: pass `current` + `onStepChange`.
 * Uncontrolled: pass `defaultStep` (or nothing) and read `onStepChange`.
 */
export function Stepper({
  steps,
  current,
  defaultStep = 0,
  onStepChange,
  validate,
  onFinish,
  children,
  allowStepNavigation = true,
  hideFooter = false,
  backLabel = 'Back',
  nextLabel = 'Next',
  finishLabel = 'Finish',
  loading = false,
  className = '',
  contentClassName = '',
}: StepperProps) {
  const isControlled = current !== undefined;
  const total = steps.length;

  const clamp = useCallback(
    (i: number) => Math.max(0, Math.min(total - 1, i)),
    [total],
  );

  const [internalStep, setInternalStep] = useState(() => clamp(defaultStep));
  const [validating, setValidating] = useState(false);

  const activeIndex = clamp(isControlled ? (current as number) : internalStep);
  const activeStep = steps[activeIndex];
  const isFirst = activeIndex === 0;
  const isLast = activeIndex === total - 1;

  const setStep = useCallback(
    (nextIndex: number) => {
      const target = clamp(nextIndex);
      if (target === activeIndex) return;
      if (!isControlled) setInternalStep(target);
      onStepChange?.(target, steps[target]);
    },
    [activeIndex, clamp, isControlled, onStepChange, steps],
  );

  const goTo = useCallback(
    (index: number) => setStep(index),
    [setStep],
  );

  const back = useCallback(() => {
    if (isFirst) return;
    setStep(activeIndex - 1);
  }, [activeIndex, isFirst, setStep]);

  const runValidation = useCallback(async (): Promise<boolean> => {
    if (!validate) return true;
    try {
      const result = await validate(activeStep, activeIndex);
      return result !== false;
    } catch {
      return false;
    }
  }, [activeIndex, activeStep, validate]);

  const next = useCallback(async () => {
    if (validating || loading) return;
    setValidating(true);
    try {
      const ok = await runValidation();
      if (!ok) return;
      if (isLast) {
        await onFinish?.();
      } else {
        setStep(activeIndex + 1);
      }
    } finally {
      setValidating(false);
    }
  }, [activeIndex, isLast, loading, onFinish, runValidation, setStep, validating]);

  const context = useMemo<StepperRenderContext>(
    () => ({
      step: activeStep,
      index: activeIndex,
      total,
      isFirst,
      isLast,
      status: 'active',
      goTo,
      next,
      back,
    }),
    [activeStep, activeIndex, total, isFirst, isLast, goTo, next, back],
  );

  const busy = validating || loading;

  if (total === 0) return null;

  const content =
    typeof children === 'function'
      ? (children as (ctx: StepperRenderContext) => React.ReactNode)(context)
      : children;

  const primaryLabel = isLast ? finishLabel : nextLabel;

  return (
    <div className={className}>
      {/* ─ Progress header ─ */}
      <div className="mb-5">
        <div className="mb-3 flex items-baseline justify-between">
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
            Step {activeIndex + 1} of {total}
          </p>
          {activeStep.optional && (
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Optional
            </span>
          )}
        </div>

        <ol className="flex items-center" role="list" aria-label="Progress">
          {steps.map((step, index) => {
            const status = statusFor(index, activeIndex);
            const isCompleted = status === 'completed';
            const isActive = status === 'active';
            const canJump =
              allowStepNavigation && isCompleted && !busy && index !== activeIndex;

            const markerStyle: React.CSSProperties = isCompleted
              ? { background: 'var(--aurora-primary)', borderColor: 'var(--aurora-primary)', color: '#fff' }
              : isActive
                ? {
                    background: 'var(--aurora-primary-subtle)',
                    borderColor: 'var(--aurora-primary)',
                    color: 'var(--aurora-primary-text)',
                  }
                : {
                    background: 'var(--aurora-bg-subtle)',
                    borderColor: 'var(--aurora-border)',
                    color: 'var(--aurora-text-muted)',
                  };

            return (
              <li
                key={step.key}
                className="flex min-w-0 items-center"
                style={{ flex: index === total - 1 ? '0 0 auto' : '1 1 0%' }}
              >
                <button
                  type="button"
                  onClick={canJump ? () => goTo(index) : undefined}
                  disabled={!canJump}
                  aria-current={isActive ? 'step' : undefined}
                  className={[
                    'group flex min-w-0 items-center gap-2 rounded-aurora text-left',
                    canJump ? 'cursor-pointer' : 'cursor-default',
                  ].join(' ')}
                >
                  <span
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border text-xs font-semibold aurora-transition"
                    style={markerStyle}
                  >
                    {isCompleted ? <CheckIcon /> : index + 1}
                  </span>
                  <span className="hidden min-w-0 flex-col sm:flex">
                    <span
                      className="truncate text-sm font-medium leading-tight"
                      style={{
                        color: isActive
                          ? 'var(--aurora-text)'
                          : isCompleted
                            ? 'var(--aurora-text-secondary)'
                            : 'var(--aurora-text-muted)',
                      }}
                    >
                      {step.title}
                    </span>
                    {isActive && step.description && (
                      <span className="truncate text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {step.description}
                      </span>
                    )}
                  </span>
                </button>

                {index < total - 1 && (
                  <span
                    aria-hidden="true"
                    className="mx-2 h-px flex-1 aurora-transition"
                    style={{
                      background: isCompleted ? 'var(--aurora-primary)' : 'var(--aurora-border)',
                    }}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* ─ Step content ─ */}
      <div className={contentClassName} role="group" aria-label={activeStep.title}>
        {content}
      </div>

      {/* ─ Footer actions ─ */}
      {!hideFooter && (
        <div
          className="mt-6 flex items-center justify-between gap-3 border-t pt-4"
          style={{ borderColor: 'var(--aurora-border)' }}
        >
          <button
            type="button"
            onClick={back}
            disabled={isFirst || busy}
            className="inline-flex h-10 items-center gap-2 rounded-aurora border px-4 text-sm font-medium aurora-transition disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: 'var(--aurora-bg-subtle)',
              borderColor: 'var(--aurora-border)',
              color: 'var(--aurora-text)',
            }}
          >
            {backLabel}
          </button>

          <button
            type="button"
            onClick={next}
            disabled={busy}
            aria-busy={busy || undefined}
            className="inline-flex h-10 items-center gap-2 rounded-aurora border px-4 text-sm font-medium aurora-transition disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              background: 'var(--aurora-primary)',
              borderColor: 'var(--aurora-primary)',
              color: '#fff',
            }}
          >
            {busy && <Spinner />}
            {primaryLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export default Stepper;
