'use client';
import React from 'react';

interface FormSwitchProps {
  label: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  help?: string;
}

export function FormSwitch({ label, checked = false, onChange, disabled, help }: FormSwitchProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium" style={{ color: 'var(--aurora-text)' }}>{label}</p>
        {help && <p className="text-xs mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>{help}</p>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange?.(!checked)}
        disabled={disabled}
        className="relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50"
        style={{ background: checked ? 'var(--aurora-primary)' : 'var(--aurora-bg-muted)' }}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}
