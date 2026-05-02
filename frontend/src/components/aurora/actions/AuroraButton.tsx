import React from 'react';

type AuroraButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type AuroraButtonSize = 'sm' | 'md';

export interface AuroraButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: AuroraButtonVariant;
  size?: AuroraButtonSize;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
}

const VARIANT_STYLES: Record<AuroraButtonVariant, React.CSSProperties> = {
  primary: {
    background: 'var(--aurora-primary)',
    borderColor: 'var(--aurora-primary)',
    color: '#fff',
  },
  secondary: {
    background: 'var(--aurora-bg-subtle)',
    borderColor: 'var(--aurora-border)',
    color: 'var(--aurora-text)',
  },
  ghost: {
    background: 'transparent',
    borderColor: 'transparent',
    color: 'var(--aurora-text-secondary)',
  },
  danger: {
    background: 'var(--aurora-danger-bg)',
    borderColor: 'var(--aurora-danger)',
    color: 'var(--aurora-danger-text)',
  },
};

const SIZE_CLASSES: Record<AuroraButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
};

export const AuroraButton = React.forwardRef<HTMLButtonElement, AuroraButtonProps>(
  function AuroraButton(
    {
      children,
      className = '',
      disabled,
      fullWidth = false,
      leadingIcon,
      loading = false,
      size = 'md',
      trailingIcon,
      type = 'button',
      variant = 'secondary',
      ...props
    },
    ref,
  ) {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className={[
          'inline-flex items-center justify-center gap-2 rounded-aurora border font-medium',
          'aurora-transition whitespace-nowrap',
          'disabled:cursor-not-allowed disabled:opacity-60',
          SIZE_CLASSES[size],
          fullWidth ? 'w-full' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        style={VARIANT_STYLES[variant]}
        {...props}
      >
        {loading ? (
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
          />
        ) : (
          leadingIcon
        )}
        {children && <span className="min-w-0 truncate">{children}</span>}
        {!loading && trailingIcon}
      </button>
    );
  },
);
