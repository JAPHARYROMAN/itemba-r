import { cn } from './cn';

/**
 * The pill's class list, on its own so client islands (the global nav, the
 * quick-contact bar, the enquiry form) can style their own elements
 * without importing @/ui/actions, whose Button and ChevronLink bring the
 * icon set and the contact helpers into every page's first-load script.
 *
 * - `primary`: the tone's solid pill (ink with white text on light tones,
 *   white with ink text on cinema).
 * - `secondary`: an outlined pill in the tone's text colour; it fills on
 *   hover.
 * - `inverse`: the cinema pill (white, ink text) whatever the section tone
 *   (the element also sets data-tone="cinema": @/ui/actions does).
 */

export type ButtonVariant = 'primary' | 'secondary' | 'inverse';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-pill text-center transition-colors duration-fast ease-apple disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-btn text-btn-fg hover:bg-btn-hover',
  secondary: 'border border-fg text-fg hover:bg-fg hover:text-surface',
  inverse: 'bg-btn text-btn-fg hover:bg-btn-hover',
};

/**
 * `sm` is 32px tall with an invisible hit area that reaches 44px; `md` is
 * 44px; `lg` is 52px.
 */
const sizes: Record<ButtonSize, string> = {
  sm: "min-h-8 px-4 text-caption after:absolute after:-inset-x-1 after:-inset-y-1.5 after:content-['']",
  md: 'min-h-11 px-[22px] text-body',
  lg: 'min-h-[52px] px-8 text-body-lg',
};

/** Class list for a pill, for elements that render their own tag. */
export function buttonClasses({ variant = 'primary', size = 'md' }: { variant?: ButtonVariant; size?: ButtonSize } = {}) {
  return cn(base, variants[variant], sizes[size]);
}
