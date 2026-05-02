import React from 'react';

interface FormCheckboxProps {
  label: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  help?: string;
  id?: string;
}

export function FormCheckbox({ label, checked, onChange, disabled, help, id }: FormCheckboxProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        onChange={e => onChange?.(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 w-4 h-4 rounded cursor-pointer"
        style={{ accentColor: 'var(--aurora-primary)' }}
      />
      <div>
        <label htmlFor={inputId} className="text-sm cursor-pointer" style={{ color: 'var(--aurora-text)' }}>{label}</label>
        {help && <p className="text-xs mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>{help}</p>}
      </div>
    </div>
  );
}
