import { cn } from './cn';

/**
 * The chevron of "Learn more ›" links: 0.62em, in the text colour, nudged
 * right on hover of a `group` parent. On its own so the error boundaries
 * (client components Next loads with every page) can draw a chevron link
 * without importing @/ui/actions and the icon set.
 */
export function Chevron({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn('size-[0.62em] shrink-0 transition-transform duration-fast ease-apple group-hover:translate-x-0.5', className)}
    >
      <path d="M4.25 1.75L8.5 6l-4.25 4.25" />
    </svg>
  );
}
