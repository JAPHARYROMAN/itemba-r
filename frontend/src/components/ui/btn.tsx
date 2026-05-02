'use client';
import React from 'react';

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'warning' | 'success';
type BtnSize = 'xs' | 'sm' | 'md' | 'lg';

const VARIANT_MAP: Record<BtnVariant, string> = {
  primary:   'bg-brand-600 text-white hover:bg-brand-700 border border-brand-600 hover:border-brand-700',
  secondary: 'bg-white text-zinc-700 hover:bg-zinc-50 border border-zinc-200 hover:border-zinc-300',
  danger:    'bg-red-600 text-white hover:bg-red-700 border border-red-600 hover:border-red-700',
  ghost:     'bg-transparent text-zinc-600 hover:bg-zinc-100 border border-transparent',
  warning:   'bg-amber-500 text-white hover:bg-amber-600 border border-amber-500 hover:border-amber-600',
  success:   'bg-emerald-600 text-white hover:bg-emerald-700 border border-emerald-600 hover:border-emerald-700',
};

const SIZE_MAP: Record<BtnSize, string> = {
  xs: 'px-2.5 py-1    text-[11px] rounded-md  gap-1',
  sm: 'px-3   py-1.5  text-[12px] rounded-lg  gap-1.5',
  md: 'px-4   py-2    text-[13px] rounded-lg  gap-2',
  lg: 'px-5   py-2.5  text-[14px] rounded-xl  gap-2',
};

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
}

export function Btn({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  children,
  disabled,
  className = '',
  ...props
}: BtnProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      className={`
        inline-flex items-center justify-center font-medium transition-colors select-none
        ${VARIANT_MAP[variant]}
        ${SIZE_MAP[size]}
        ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : icon ? (
        <span className="flex-shrink-0">{icon}</span>
      ) : null}
      {children && <span>{children}</span>}
      {iconRight && !loading && <span className="flex-shrink-0">{iconRight}</span>}
    </button>
  );
}

// ── Icon-only variant (square) ─────────────────────────────────────────────
interface IconBtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  label: string; // aria-label, required for accessibility
}

export function IconBtn({ variant = 'ghost', size = 'sm', label, children, className = '', ...props }: IconBtnProps) {
  return (
    <button
      aria-label={label}
      className={`
        inline-flex items-center justify-center rounded-lg transition-colors
        ${VARIANT_MAP[variant]}
        ${size === 'xs' ? 'w-6 h-6' : size === 'sm' ? 'w-7 h-7' : size === 'md' ? 'w-8 h-8' : 'w-9 h-9'}
        ${className}
      `}
      {...props}
    >
      {children}
    </button>
  );
}
