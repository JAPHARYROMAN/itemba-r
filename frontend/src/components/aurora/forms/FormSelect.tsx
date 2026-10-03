'use client';
import React from 'react';
import { SelectField } from '@/components/ui/select-field';
import { selectChangeEvent } from '@/components/ui/select-field-compat';

interface FormSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * Aurora's `<select>`-shaped field, rendered as the shared SelectField so its
 * open list follows the theme. Only what the call sites use is accepted, so a
 * prop the SelectField cannot honour fails to compile instead of being dropped.
 */
interface FormSelectProps {
  label?: string;
  'aria-label'?: string;
  error?: string;
  help?: string;
  required?: boolean;
  disabled?: boolean;
  options: FormSelectOption[];
  /** A leading `''` row, choosable as it was in the native select. */
  placeholder?: string;
  fullWidth?: boolean;
  value: string | number | null | undefined;
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  id?: string;
  name?: string;
  className?: string;
}

export function FormSelect({
  label,
  'aria-label': ariaLabel,
  error,
  help,
  required,
  disabled,
  options,
  placeholder,
  fullWidth = true,
  value,
  onChange,
  id,
  name,
  className = '',
}: FormSelectProps) {
  return (
    <SelectField
      className={`${fullWidth ? 'w-full' : ''} ${className}`.trim()}
      label={label}
      aria-label={ariaLabel}
      hint={help}
      error={error}
      value={value == null ? '' : String(value)}
      onChange={(next) => onChange(selectChangeEvent(next, name, id))}
      options={[...(placeholder ? [{ value: '', label: placeholder }] : []), ...options]}
      required={required}
      disabled={disabled}
      id={id}
      name={name}
    />
  );
}
