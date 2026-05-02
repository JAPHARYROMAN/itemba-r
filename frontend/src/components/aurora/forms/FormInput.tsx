import React from 'react';

interface FormInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string;
  error?: string;
  help?: string;
  required?: boolean;
  fullWidth?: boolean;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
}

export function FormInput({ label, error, help, required, fullWidth = true, prefix, suffix, id, className = '', ...props }: FormInputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className={fullWidth ? 'w-full' : ''}>
      {label && (
        <label htmlFor={inputId} className="block text-xs font-medium mb-1.5" style={{ color: 'var(--aurora-text-secondary)' }}>
          {label}
          {required && <span className="ml-0.5" style={{ color: 'var(--aurora-danger)' }} aria-hidden>*</span>}
        </label>
      )}
      <div className="relative">
        {prefix && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center" style={{ color: 'var(--aurora-text-muted)' }}>
            {prefix}
          </div>
        )}
        <input
          id={inputId}
          aria-describedby={error ? `${inputId}-error` : help ? `${inputId}-help` : undefined}
          aria-invalid={!!error}
          aria-required={required}
          className={`aurora-input ${prefix ? 'pl-9' : ''} ${suffix ? 'pr-9' : ''} ${className}`}
          style={error ? { borderColor: 'var(--aurora-danger)' } : {}}
          {...props}
        />
        {suffix && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center" style={{ color: 'var(--aurora-text-muted)' }}>
            {suffix}
          </div>
        )}
      </div>
      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-xs mt-1" style={{ color: 'var(--aurora-danger)' }}>{error}</p>
      )}
      {help && !error && (
        <p id={`${inputId}-help`} className="text-xs mt-1" style={{ color: 'var(--aurora-text-muted)' }}>{help}</p>
      )}
    </div>
  );
}
