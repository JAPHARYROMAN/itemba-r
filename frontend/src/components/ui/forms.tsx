'use client';
import React, { useId, useRef, useState } from 'react';
import {
  FieldError,
  Hint,
  INPUT_BASE,
  Label,
  SuccessCheck,
  fieldStateClasses,
  useFieldA11y,
  useShakeOnError,
} from './field-chrome';
import { SelectField } from './select-field';
import { optionsFromChildren, selectChangeEvent } from './select-field-compat';

// ── FormInput ─────────────────────────────────────────────────────────────────
interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  /** Show a green border + checkmark, e.g. after async validation passes. */
  success?: boolean;
}

export function FormInput({ label, hint, error, success, className = '', ...props }: FormInputProps) {
  const shake = useShakeOnError(error);
  const { fieldId, errorId, hintId, aria } = useFieldA11y(props.id, error, hint);
  return (
    <div className={className}>
      {label && <Label required={props.required} htmlFor={fieldId}>{label}</Label>}
      <div className="relative">
        <input
          className={`${INPUT_BASE} ${fieldStateClasses(error, success)}${shake} ${success && !error ? 'pr-8' : ''}`}
          {...props}
          id={fieldId}
          {...aria}
        />
        {success && !error && <SuccessCheck />}
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : hint ? <Hint id={hintId}>{hint}</Hint> : null}
    </div>
  );
}

// ── FormSelect ────────────────────────────────────────────────────────────────
interface SelectOption { value: string; label: string; disabled?: boolean }

/**
 * The `<select>`-shaped API every form already speaks, rendered as a
 * SelectField. Only what the call sites use is accepted, so a prop the
 * SelectField cannot honour fails to compile instead of being dropped.
 */
export interface FormSelectProps {
  label?: string;
  'aria-label'?: string;
  hint?: string;
  error?: string;
  value: string | number | null | undefined;
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  options?: SelectOption[];
  /** A leading `''` row, choosable as it was in the native select. */
  placeholder?: string;
  /** `<option>` elements, when `options` is not given. */
  children?: React.ReactNode;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
}

export function FormSelect({
  label,
  'aria-label': ariaLabel,
  hint,
  error,
  value,
  onChange,
  options,
  placeholder,
  children,
  required,
  disabled,
  id,
  name,
  className,
}: FormSelectProps) {
  const rows = [
    ...(placeholder ? [{ value: '', label: placeholder }] : []),
    ...(options ?? optionsFromChildren(children)),
  ];
  return (
    <SelectField
      className={className}
      label={label}
      aria-label={ariaLabel}
      hint={hint}
      error={error}
      value={value == null ? '' : String(value)}
      onChange={(next) => onChange(selectChangeEvent(next, name, id))}
      options={rows}
      required={required}
      disabled={disabled}
      id={id}
      name={name}
    />
  );
}

// ── FormTextarea ──────────────────────────────────────────────────────────────
interface FormTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  success?: boolean;
}

export function FormTextarea({ label, hint, error, success, className = '', ...props }: FormTextareaProps) {
  const shake = useShakeOnError(error);
  const { fieldId, errorId, hintId, aria } = useFieldA11y(props.id, error, hint);
  return (
    <div className={className}>
      {label && <Label required={props.required} htmlFor={fieldId}>{label}</Label>}
      <textarea
        rows={3}
        className={`${INPUT_BASE} resize-y ${fieldStateClasses(error, success)}${shake}`}
        {...props}
        id={fieldId}
        {...aria}
      />
      {error ? <FieldError id={errorId}>{error}</FieldError> : hint ? <Hint id={hintId}>{hint}</Hint> : null}
    </div>
  );
}

// ── FileUpload ────────────────────────────────────────────────────────────────
interface FileUploadProps {
  label?: string;
  hint?: string;
  error?: string;
  accept?: string;
  multiple?: boolean;
  onChange?: (files: FileList | null) => void;
  disabled?: boolean;
  className?: string;
}

export function FileUpload({ label, hint, error, accept, multiple, onChange, disabled, className = '' }: FileUploadProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);

  function handleFiles(files: FileList | null) {
    if (!files || disabled) return;
    setSelectedFiles(Array.from(files).map((f) => f.name));
    onChange?.(files);
  }

  return (
    <div className={className}>
      {label && <Label htmlFor={id}>{label}</Label>}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center px-4 py-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-brand-500
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        style={{
          borderColor: error
            ? 'var(--aurora-danger)'
            : dragOver
            ? 'var(--aurora-primary)'
            : 'var(--aurora-border-strong)',
          background: dragOver ? 'var(--aurora-primary-subtle)' : 'var(--aurora-bg-subtle)',
        }}
      >
        <svg
          className="w-8 h-8 mb-2"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
          style={{ color: 'var(--aurora-text-muted)' }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        {selectedFiles.length > 0 ? (
          <div className="text-center">
            <p className="text-[12px] font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>{selectedFiles.join(', ')}</p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>Click to change</p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-[13px] font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>Drop files here or click to browse</p>
            {accept && <p className="text-[11px] mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>{accept}</p>}
          </div>
        )}
        <input
          id={id}
          aria-label={label || 'Upload file'}
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
          className="sr-only"
        />
      </div>
      {error ? <FieldError>{error}</FieldError> : hint ? <Hint>{hint}</Hint> : null}
    </div>
  );
}
