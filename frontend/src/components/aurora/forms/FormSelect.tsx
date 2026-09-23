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

interface FormSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface FormSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  help?: string;
  required?: boolean;
  options: FormSelectOption[];
  placeholder?: string;
  fullWidth?: boolean;
  /** Green border after validation passes. No check icon — the native arrow lives on the right. */
  success?: boolean;
}

export function FormSelect({
  label,
  error,
  help,
  required,
  options,
  placeholder,
  fullWidth = true,
  success,
  id,
  className = '',
  ...props
}: FormSelectProps) {
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
        <select
          id={inputId}
          aria-describedby={error ? `${inputId}-error` : help ? `${inputId}-help` : undefined}
          aria-invalid={!!error}
          aria-required={required}
          className={`aurora-input appearance-none pr-8 ${className}${shake}`}
          style={
            error
              ? { borderColor: 'var(--aurora-danger)' }
              : showSuccess
                ? { borderColor: 'var(--aurora-success, #10b981)' }
                : {}
          }
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <svg
          className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          style={{ color: 'var(--aurora-text-muted)' }}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
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
