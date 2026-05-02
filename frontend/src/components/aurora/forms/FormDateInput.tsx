import React from 'react';
import { FormInput } from './FormInput';

interface FormDateInputProps {
  label?: string;
  error?: string;
  help?: string;
  required?: boolean;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  fullWidth?: boolean;
}

export function FormDateInput({ ...props }: FormDateInputProps) {
  return <FormInput type="date" {...props} />;
}
