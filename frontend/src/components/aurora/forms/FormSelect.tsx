import React from 'react';

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
}

export function FormSelect({ label, error, help, required, options, placeholder, fullWidth = true, id, className = '', ...props }: FormSelectProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className={fullWidth ? 'w-full' : ''}>
      {label && (
        <label htmlFor={inputId} className="block text-xs font-medium mb-1.5" style={{ color: 'var(--aurora-text-secondary)' }}>
          {label}
          {required && <span className="ml-0.5" style={{ color: 'var(--aurora-danger)' }}>*</span>}
        </label>
      )}
      <div className="relative">
        <select
          id={inputId}
          aria-invalid={!!error}
          className={`aurora-input appearance-none pr-8 ${className}`}
          style={error ? { borderColor: 'var(--aurora-danger)' } : {}}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map(opt => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</option>
          ))}
        </select>
        <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          style={{ color: 'var(--aurora-text-muted)' }}>
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </div>
      {error && <p role="alert" className="text-xs mt-1" style={{ color: 'var(--aurora-danger)' }}>{error}</p>}
      {help && !error && <p className="text-xs mt-1" style={{ color: 'var(--aurora-text-muted)' }}>{help}</p>}
    </div>
  );
}
