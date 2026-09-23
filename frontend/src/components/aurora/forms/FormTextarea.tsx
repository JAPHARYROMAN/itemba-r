'use client';
import React, { useEffect, useId, useRef, useState } from 'react';

/**
 * Shake the field once whenever a NEW error appears (not on every render with
 * the same error). Defined locally to keep this component self-contained
 * (parity with components/ui/forms.tsx).
 */
function useShakeOnError(error?: string) {
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

/** Small green checkmark shown when a field validates successfully. */
function SuccessCheck() {
  return (
    <span
      className="pointer-events-none absolute right-2.5 top-2.5 flex items-center animate-fade-in"
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

interface FormTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  help?: string;
  required?: boolean;
  fullWidth?: boolean;
  /** Show a green border + checkmark, e.g. after async validation passes. */
  success?: boolean;
}

export function FormTextarea({
  label,
  error,
  help,
  required,
  fullWidth = true,
  success,
  id,
  className = '',
  ...props
}: FormTextareaProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const shake = useShakeOnError(error);
  const showSuccess = !!success && !error;
  return (
    <div className={fullWidth ? 'w-full' : ''}>
      {label && (
        <label
          htmlFor={inputId}
          className="block text-xs font-medium mb-1.5"
          style={{ color: 'var(--aurora-text-secondary)' }}
        >
          {label}
          {required && (
            <span aria-hidden="true" className="ml-0.5" style={{ color: 'var(--aurora-danger)' }}>
              *
            </span>
          )}
        </label>
      )}
      <div className="relative">
        <textarea
          id={inputId}
          aria-describedby={error ? `${inputId}-error` : help ? `${inputId}-help` : undefined}
          rows={3}
          aria-invalid={!!error}
          aria-required={required}
          className={`aurora-input resize-y min-h-[80px] ${showSuccess ? 'pr-9' : ''} ${className}${shake}`}
          style={
            error
              ? { borderColor: 'var(--aurora-danger)' }
              : showSuccess
                ? { borderColor: 'var(--aurora-success, #10b981)' }
                : {}
          }
          {...props}
        />
        {showSuccess && <SuccessCheck />}
      </div>
      {error && (
        <p
          id={`${inputId}-error`}
          role="alert"
          className="text-xs mt-1"
          style={{ color: 'var(--aurora-danger)' }}
        >
          {error}
        </p>
      )}
      {help && !error && (
        <p
          id={`${inputId}-help`}
          className="text-xs mt-1"
          style={{ color: 'var(--aurora-text-muted)' }}
        >
          {help}
        </p>
      )}
    </div>
  );
}
