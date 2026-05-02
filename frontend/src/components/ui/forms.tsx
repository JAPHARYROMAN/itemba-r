'use client';
import React, { useRef, useState } from 'react';

// ── Shared base styles ────────────────────────────────────────────────────────
//
// Inputs use the `aurora-input` utility class defined in globals.css, which
// already wires up bg/text/border/placeholder against the theme tokens for
// both light and dark mode. We only add layout + width here.
const INPUT_BASE =
  'aurora-input w-full px-3 py-2 text-[13px] rounded-lg ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors ' +
  'disabled:cursor-not-allowed';

// ── Label ─────────────────────────────────────────────────────────────────────
function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label
      className="block text-[12px] font-medium mb-1"
      style={{ color: 'var(--aurora-text-secondary)' }}
    >
      {children}
      {required && (
        <span className="ml-0.5" style={{ color: 'var(--aurora-danger)' }}>
          *
        </span>
      )}
    </label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
      {children}
    </p>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-danger)' }}>
      {children}
    </p>
  );
}

// ── FormInput ─────────────────────────────────────────────────────────────────
interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function FormInput({ label, hint, error, className = '', ...props }: FormInputProps) {
  return (
    <div className={className}>
      {label && <Label required={props.required}>{label}</Label>}
      <input className={`${INPUT_BASE} ${error ? 'border-red-400 focus:ring-red-400' : ''}`} {...props} />
      {error ? <FieldError>{error}</FieldError> : hint ? <Hint>{hint}</Hint> : null}
    </div>
  );
}

// ── FormSelect ────────────────────────────────────────────────────────────────
interface SelectOption { value: string; label: string }

interface FormSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  options?: SelectOption[];
  placeholder?: string;
  children?: React.ReactNode;
}

export function FormSelect({ label, hint, error, options, placeholder, children, className = '', ...props }: FormSelectProps) {
  return (
    <div className={className}>
      {label && <Label required={props.required}>{label}</Label>}
      <select className={`${INPUT_BASE} ${error ? 'border-red-400 focus:ring-red-400' : ''}`} {...props}>
        {placeholder && <option value="">{placeholder}</option>}
        {options
          ? options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
          : children}
      </select>
      {error ? <FieldError>{error}</FieldError> : hint ? <Hint>{hint}</Hint> : null}
    </div>
  );
}

// ── FormTextarea ──────────────────────────────────────────────────────────────
interface FormTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function FormTextarea({ label, hint, error, className = '', ...props }: FormTextareaProps) {
  return (
    <div className={className}>
      {label && <Label required={props.required}>{label}</Label>}
      <textarea
        rows={3}
        className={`${INPUT_BASE} resize-y ${error ? 'border-red-400 focus:ring-red-400' : ''}`}
        {...props}
      />
      {error ? <FieldError>{error}</FieldError> : hint ? <Hint>{hint}</Hint> : null}
    </div>
  );
}

// ── DateInput ─────────────────────────────────────────────────────────────────
interface DateInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  hint?: string;
  error?: string;
}

export function DateInput({ label, hint, error, className = '', ...props }: DateInputProps) {
  return (
    <div className={className}>
      {label && <Label required={props.required}>{label}</Label>}
      <input
        type="date"
        className={`${INPUT_BASE} ${error ? 'border-red-400 focus:ring-red-400' : ''}`}
        {...props}
      />
      {error ? <FieldError>{error}</FieldError> : hint ? <Hint>{hint}</Hint> : null}
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);

  function handleFiles(files: FileList | null) {
    if (!files) return;
    setSelectedFiles(Array.from(files).map((f) => f.name));
    onChange?.(files);
  }

  return (
    <div className={className}>
      {label && <Label>{label}</Label>}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center px-4 py-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors
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
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={(e) => handleFiles(e.target.files)}
          className="sr-only"
        />
      </div>
      {error ? <FieldError>{error}</FieldError> : hint ? <Hint>{hint}</Hint> : null}
    </div>
  );
}
