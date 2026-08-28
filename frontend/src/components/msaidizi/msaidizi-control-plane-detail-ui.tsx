'use client';

import { cloneElement, useId, type ReactElement } from 'react';

import { ApiError } from '@/lib/api-client';

export const CONTROL_INPUT_CLASS = 'mt-1 w-full rounded-lg px-3 py-2 text-[12px] outline-none';
export const CONTROL_INPUT_STYLE = {
  background: 'var(--aurora-bg)',
  border: '1px solid var(--aurora-border)',
  color: 'var(--aurora-text)',
};

export function ControlField({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string }>;
  hint?: string;
}) {
  const generatedId = useId();
  const controlId = children.props.id ?? generatedId;
  const hintId = `${controlId}-hint`;
  const describedBy = [children.props['aria-describedby'], hint ? hintId : undefined]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <label
        htmlFor={controlId}
        className="block text-[12px] font-medium"
        style={{ color: 'var(--aurora-text-secondary)' }}
      >
        {label}
      </label>
      {cloneElement(children, {
        id: controlId,
        'aria-describedby': describedBy || undefined,
      })}
      {hint ? (
        <span
          id={hintId}
          className="mt-1 block text-[10px] font-normal"
          style={{ color: 'var(--aurora-text-muted)' }}
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function ControlButton({
  children,
  onClick,
  busy = false,
  disabled = false,
  danger = false,
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  busy?: boolean;
  disabled?: boolean;
  danger?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      disabled={busy || disabled}
      onClick={onClick}
      className="cursor-pointer rounded-lg px-3 py-2 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
      style={
        danger
          ? { color: 'var(--aurora-danger-text)', background: 'var(--aurora-danger-bg)' }
          : { color: 'var(--aurora-accent-text)', background: 'var(--aurora-accent-subtle)' }
      }
    >
      {busy ? 'Working…' : children}
    </button>
  );
}

export function ControlStatus({ status }: { status: string }) {
  const active = status === 'ACTIVE' || status === 'TRUSTED';
  const terminal = status === 'REVOKED' || status === 'ARCHIVED' || status === 'EXPIRED';
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
      style={
        active
          ? { color: 'var(--aurora-success-text)', background: 'var(--aurora-success-bg)' }
          : terminal
            ? { color: 'var(--aurora-text-muted)', background: 'var(--aurora-bg-muted)' }
            : { color: 'var(--aurora-warning-text)', background: 'var(--aurora-warning-bg)' }
      }
    >
      {statusLabel(status)}
    </span>
  );
}

export function InlineMessage({
  kind,
  children,
}: {
  kind: 'error' | 'notice';
  children: React.ReactNode;
}) {
  return (
    <p
      role={kind === 'error' ? 'alert' : 'status'}
      className="text-[12px]"
      style={{
        color: kind === 'error' ? 'var(--aurora-danger-text)' : 'var(--aurora-success-text)',
      }}
    >
      {children}
    </p>
  );
}

export function statusLabel(status: string): string {
  return status
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function formatWhen(value: string | null): string {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString();
}

export function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

export function toLocalDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function toIsoDateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Date and time must be valid.');
  return date.toISOString();
}

export function controlPlaneError(
  error: unknown,
  conflictMessage: string,
): { message: string; conflict: boolean } {
  if (error instanceof ApiError && error.status === 409) {
    return { message: `${error.message} ${conflictMessage}`, conflict: true };
  }
  return {
    message: error instanceof Error ? error.message : 'The request could not be completed.',
    conflict: false,
  };
}
