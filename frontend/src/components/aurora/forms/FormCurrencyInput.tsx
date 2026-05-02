import React from 'react';
import { FormInput } from './FormInput';

interface FormCurrencyInputProps {
  label?: string;
  error?: string;
  help?: string;
  required?: boolean;
  value?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  currency?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  placeholder?: string;
  fullWidth?: boolean;
}

export function FormCurrencyInput({ currency = 'TZS', ...props }: FormCurrencyInputProps) {
  return (
    <FormInput
      type="number"
      step="0.01"
      min="0"
      prefix={<span className="text-xs font-semibold">{currency}</span>}
      {...props}
    />
  );
}
