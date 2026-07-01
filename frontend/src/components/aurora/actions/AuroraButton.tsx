'use client';
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
  /**
   * When toggled to `true`, briefly flashes the button with success colors
   * (an affordance for "action completed"). The flash auto-clears after
   * `successFlashDuration` ms. Honors prefers-reduced-motion via the global
   * transition guard in globals.css. Existing variant styling is restored
   * automatically once the flash ends.
   */
  successFlash?: boolean;
  /** Duration (ms) the success flash stays on. Defaults to 1200ms. */
  successFlashDuration?: number;
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

const SUCCESS_FLASH_STYLE: React.CSSProperties = {
  background: 'var(--aurora-success-bg)',
  borderColor: 'var(--aurora-success)',
  color: 'var(--aurora-success-text)',
};

const SIZE_CLASSES: Record<AuroraButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
};

// Solid, prominent variants lift on hover for tactility; quiet variants
// (secondary/ghost) keep their place to stay calm in dense toolbars/tables.
// Every variant gets a subtle press response. Disabled buttons get none.
// All transforms ride on `aurora-transition`, so prefers-reduced-motion
// (media query + html.motion-reduced guard in globals.css) neutralizes them.
const LIFT_CLASSES: Record<AuroraButtonVariant, string> = {
  primary: 'hover:-translate-y-px hover:shadow-md active:translate-y-0 active:scale-[0.98]',
  secondary: 'hover:-translate-y-px hover:shadow-sm active:translate-y-0 active:scale-[0.98]',
  ghost: 'active:scale-[0.98]',
  danger: 'hover:-translate-y-px hover:shadow-md active:translate-y-0 active:scale-[0.98]',
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
      successFlash = false,
      successFlashDuration = 1200,
      trailingIcon,
      type = 'button',
      variant = 'secondary',
      ...props
    },
    ref,
  ) {
    const isDisabled = disabled || loading;

    // Latch the flash internally so a momentary `successFlash` toggle still
    // produces a visible, self-clearing flash even if the parent leaves the
    // prop `true`. The timer is a no-op under reduced motion (still clears).
    const [flashing, setFlashing] = React.useState(false);
    React.useEffect(() => {
      if (!successFlash) {
        setFlashing(false);
        return;
      }
      setFlashing(true);
      const timer = window.setTimeout(
        () => setFlashing(false),
        Math.max(0, successFlashDuration),
      );
      return () => window.clearTimeout(timer);
    }, [successFlash, successFlashDuration]);

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className={[
          'inline-flex items-center justify-center gap-2 rounded-aurora border font-medium select-none',
          'aurora-transition whitespace-nowrap',
          'disabled:cursor-not-allowed disabled:opacity-60',
          // Only tactile (cursor-pointer + lift/press) when interactive.
          isDisabled ? '' : `cursor-pointer ${LIFT_CLASSES[variant]}`,
          SIZE_CLASSES[size],
          fullWidth ? 'w-full' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        style={flashing ? SUCCESS_FLASH_STYLE : VARIANT_STYLES[variant]}
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
