import type { AccentName } from '@/design/tokens';
import { SmartLink } from './actions';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export type Shortcut = {
  href: string;
  label: string;
  icon: IconName;
  /** Colours the icon only (graphic accent); the label stays ink. */
  accent?: AccentName;
};

/** Columns, and a width that keeps each shortcut 120 to 170px wide from `sm`. */
const columnClasses = {
  4: 'max-w-2xl grid-cols-2 sm:grid-cols-4',
  6: 'max-w-[46rem] grid-cols-3 sm:grid-cols-6',
} as const;

/**
 * The row of topic shortcuts under a support page's hero, as on Apple
 * Support: a line icon in a round well above a short label, each one link
 * to its section further down the page. The icon takes the accent of the
 * company behind the topic (the group gold otherwise); the labels stay ink,
 * so the row reads as one quiet navigation band rather than a set of
 * buttons. Static server markup; every target is an in-page anchor.
 */
export function Shortcuts({
  label,
  items,
  columns,
  className,
}: {
  /** The list's accessible name ("Jump to a service"). */
  label: string;
  items: readonly Shortcut[];
  columns: keyof typeof columnClasses;
  className?: string;
}) {
  return (
    <ul
      aria-label={label}
      className={cn('mx-auto grid gap-x-2 gap-y-5 md:gap-x-4', columnClasses[columns], className)}
    >
      {items.map((item) => (
        <li key={item.href} data-accent={item.accent} className="flex min-w-0">
          <SmartLink
            href={item.href}
            className="group flex w-full min-w-0 flex-col items-center gap-2.5 rounded-card px-1 py-2 text-center text-caption text-fg md:gap-3"
          >
            <span
              aria-hidden="true"
              className="flex size-14 items-center justify-center rounded-full bg-surface-alt transition-transform duration-base ease-apple group-hover:-translate-y-0.5 md:size-16"
            >
              <Icon name={item.icon} size="md" strokeWidth={1.4} className="text-accent md:size-7" />
            </span>
            <span className="text-balance decoration-1 underline-offset-4 group-hover:underline">{item.label}</span>
          </SmartLink>
        </li>
      ))}
    </ul>
  );
}
