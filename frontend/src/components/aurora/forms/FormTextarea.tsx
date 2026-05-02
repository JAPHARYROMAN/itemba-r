import React from 'react';

interface FormTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  help?: string;
  required?: boolean;
  fullWidth?: boolean;
}

export function FormTextarea({ label, error, help, required, fullWidth = true, id, className = '', ...props }: FormTextareaProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className={fullWidth ? 'w-full' : ''}>
      {label && (
        <label htmlFor={inputId} className="block text-xs font-medium mb-1.5" style={{ color: 'var(--aurora-text-secondary)' }}>
          {label}
          {required && <span className="ml-0.5" style={{ color: 'var(--aurora-danger)' }}>*</span>}
        </label>
      )}
      <textarea
        id={inputId}
        rows={3}
        aria-invalid={!!error}
        className={`aurora-input resize-y min-h-[80px] ${className}`}
        style={error ? { borderColor: 'var(--aurora-danger)' } : {}}
        {...props}
      />
      {error && <p role="alert" className="text-xs mt-1" style={{ color: 'var(--aurora-danger)' }}>{error}</p>}
      {help && !error && <p className="text-xs mt-1" style={{ color: 'var(--aurora-text-muted)' }}>{help}</p>}
    </div>
  );
}
