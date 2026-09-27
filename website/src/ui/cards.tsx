import type { ReactNode } from 'react';
import type { AccentName, Tone } from '@/design/tokens';
import { Chevron, SmartLink } from './actions';
import { cn } from './cn';
import { Eyebrow, Heading, type HeadingLevel, type HeadingSize } from './text';

/*
 * Cards sit on the tile around them: `bg-surface-alt` is #f5f5f7 inside a
 * light tile, white inside an alt tile and the raised black inside cinema.
 * Give a card its own `tone` to break that rule (a cinema card among light
 * ones); it then paints its tone's surface.
 */

const cardPadding = {
  none: '',
  md: 'p-6 md:p-8',
  lg: 'p-8 md:p-10',
} as const;

export type CardPadding = keyof typeof cardPadding;

type CardTag = 'div' | 'article' | 'li' | 'section';

export type CardProps = {
  as?: CardTag;
  tone?: Tone;
  accent?: AccentName;
  padding?: CardPadding;
  className?: string;
  children: ReactNode;
};

/** A rounded (18px) panel. */
export function Card({ as: Tag = 'div', tone, accent, padding = 'md', className, children }: CardProps) {
  return (
    <Tag
      data-tone={tone}
      data-accent={accent}
      className={cn('rounded-card', tone ? 'bg-surface' : 'bg-surface-alt', cardPadding[padding], className)}
    >
      {children}
    </Tag>
  );
}

export type CardLinkProps = {
  href: string;
  title: ReactNode;
  /** Heading level of the title; the visual size stays the card size. */
  titleAs?: HeadingLevel;
  titleSize?: HeadingSize;
  eyebrow?: ReactNode;
  eyebrowDot?: boolean;
  description?: ReactNode;
  /** Media shown above the text (a <Media> without its own radius). */
  media?: ReactNode;
  /**
   * A visible call to action at the foot of the card ("Learn more"). It is
   * decorative (aria-hidden): the link's accessible name is the title only.
   */
  cta?: ReactNode;
  as?: CardTag;
  tone?: Tone;
  accent?: AccentName;
  className?: string;
  /** Extra content between the description and the call to action. */
  children?: ReactNode;
};

/**
 * A whole-card link. Only the title is a link, and its ::after stretches over
 * the card, so the card is one click target whose accessible name is just
 * the title. The focus ring is drawn on that stretched area.
 */
export function CardLink({
  href,
  title,
  titleAs = 'h3',
  titleSize = 'h4',
  eyebrow,
  eyebrowDot,
  description,
  media,
  cta,
  as: Tag = 'article',
  tone,
  accent,
  className,
  children,
}: CardLinkProps) {
  return (
    <Tag
      data-tone={tone}
      data-accent={accent}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-card transition-shadow duration-base ease-apple hover:shadow-card',
        tone ? 'bg-surface' : 'bg-surface-alt',
        className,
      )}
    >
      {media ? <div className="overflow-hidden">{media}</div> : null}
      <div className="flex flex-1 flex-col p-6 md:p-8">
        {eyebrow ? (
          <Eyebrow dot={eyebrowDot} className="mb-2">
            {eyebrow}
          </Eyebrow>
        ) : null}
        <Heading as={titleAs} size={titleSize}>
          <SmartLink
            href={href}
            className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
          >
            {title}
          </SmartLink>
        </Heading>
        {description ? <p className="mt-2 text-body text-fg-muted">{description}</p> : null}
        {children}
        {cta ? (
          <span aria-hidden="true" className="mt-auto inline-flex items-center gap-[0.3em] pt-6 text-body text-accent-fg">
            {cta}
            <Chevron />
          </span>
        ) : null}
      </div>
    </Tag>
  );
}

/* ── Bento ────────────────────────────────────────────────────────────── */

/**
 * A mixed-size grid of rounded tiles (sectors, strengths, verification
 * signals). Six columns from `lg`; cells span a third, half, two thirds or
 * the full row, and may be two rows tall. Phones get one column, or two
 * compact ones (`phoneColumns={2}`, where a cell that must stay full width
 * adds `col-span-2`); `third` cells pair up at `md`.
 */
export function Bento({
  as: Tag = 'div',
  phoneColumns = 1,
  className,
  children,
  ...aria
}: {
  as?: 'div' | 'ul';
  phoneColumns?: 1 | 2;
  className?: string;
  children: ReactNode;
  /** Names the grid, e.g. a `ul` labelled by its section heading. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}) {
  return (
    <Tag {...aria} className={cn('grid gap-3 md:grid-cols-6 md:gap-4', phoneColumns === 2 ? 'grid-cols-2' : 'grid-cols-1', className)}>
      {children}
    </Tag>
  );
}

const bentoSpans = {
  third: 'md:col-span-3 lg:col-span-2',
  half: 'md:col-span-3',
  'two-thirds': 'md:col-span-6 lg:col-span-4',
  full: 'md:col-span-6',
} as const;

export type BentoSpan = keyof typeof bentoSpans;

const bentoPadding = {
  none: '',
  md: 'p-7 md:p-8',
  lg: 'p-8 md:p-10 lg:p-12',
} as const;

export type BentoCellProps = {
  span?: BentoSpan;
  /** Two rows tall from `md`. */
  tall?: boolean;
  tone?: Tone;
  accent?: AccentName;
  padding?: keyof typeof bentoPadding;
  as?: 'div' | 'li' | 'article';
  className?: string;
  children: ReactNode;
};

export function BentoCell({ span = 'third', tall = false, tone, accent, padding = 'md', as: Tag = 'div', className, children }: BentoCellProps) {
  return (
    <Tag
      data-tone={tone}
      data-accent={accent}
      className={cn(
        'relative flex min-w-0 flex-col overflow-hidden rounded-tile',
        tone ? 'bg-surface' : 'bg-surface-alt',
        bentoSpans[span],
        tall && 'md:row-span-2',
        bentoPadding[padding],
        className,
      )}
    >
      {children}
    </Tag>
  );
}
