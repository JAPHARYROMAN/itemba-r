import type { ReactNode } from 'react';
import type { AccentName, Tone } from '@/design/tokens';
import { cn } from './cn';

/* ── Container ────────────────────────────────────────────────────────── */

/**
 * Container widths (tokens.containers): `measure` 680px for article text,
 * `prose` 980px, `content` 1068px, `wide` 1440px for full-width tiles. The
 * width is the content box; the 22px side gutter sits outside it, so text
 * never touches the viewport edge on a phone.
 */
export type ContainerSize = 'measure' | 'prose' | 'content' | 'wide';

const containerWidths: Record<ContainerSize, string> = {
  measure: 'max-w-measure',
  prose: 'max-w-prose',
  content: 'max-w-content',
  wide: 'max-w-wide',
};

type ContainerTag = 'div' | 'header' | 'footer' | 'article' | 'nav';

export type ContainerProps = {
  size?: ContainerSize;
  as?: ContainerTag;
  /** Drop the side gutter (for a child that is already inside one). */
  flush?: boolean;
  className?: string;
  id?: string;
  children: ReactNode;
};

export function Container({ size = 'content', as: Tag = 'div', flush = false, className, id, children }: ContainerProps) {
  return (
    <Tag id={id} className={cn('mx-auto box-content', containerWidths[size], !flush && 'px-gutter', className)}>
      {children}
    </Tag>
  );
}

/* ── Section ──────────────────────────────────────────────────────────── */

/**
 * Section spacing: `default` is 80px mobile / 120px desktop, `tight` is
 * 56 / 80px, `none` leaves the padding to the caller.
 */
export type SectionSpace = 'default' | 'tight' | 'none';

const sectionSpace: Record<SectionSpace, string> = {
  default: 'py-section',
  tight: 'py-section-tight',
  none: '',
};

type SectionTag = 'section' | 'div' | 'aside' | 'header' | 'article';

export type SectionProps = {
  /**
   * The tile's tone: `light` (white canvas), `alt` (#f5f5f7) or `cinema`
   * (black, for photography; at most once per two screens). The tone
   * re-maps every semantic colour inside it, so children need no tone props.
   */
  tone?: Tone;
  /** Company accent for everything inside (eyebrows, chevron links, dots). */
  accent?: AccentName;
  space?: SectionSpace;
  id?: string;
  /** id of the heading that names this section (sets aria-labelledby). */
  labelledBy?: string;
  /** Accessible name when the section has no visible heading. */
  label?: string;
  as?: SectionTag;
  /**
   * Render as a rounded tile inset from the viewport edges (max 1440px wide,
   * 20px/28px radius) instead of a full-bleed band.
   */
  inset?: boolean;
  className?: string;
  children: ReactNode;
};

export function Section({
  tone = 'light',
  accent,
  space = 'default',
  id,
  labelledBy,
  label,
  as: Tag = 'section',
  inset = false,
  className,
  children,
}: SectionProps) {
  // aria-label(ledby) is prohibited on generic elements (a div, or a header
  // inside main), so only landmark-capable tags carry the name.
  const nameable = Tag === 'section' || Tag === 'aside' || Tag === 'article';
  const a11y = nameable ? { 'aria-labelledby': labelledBy, 'aria-label': labelledBy ? undefined : label } : {};

  if (inset) {
    return (
      <Tag id={id} {...a11y} data-accent={accent} className="px-gutter py-1.5 md:py-2">
        {/* overflow: clip, not hidden, where supported: a clip is not a scroll container, so sticky children and scroll-driven (view()) animations inside the tile still follow the page. */}
        <div
          data-tone={tone}
          className={cn('mx-auto max-w-wide overflow-hidden rounded-tile supports-[overflow:clip]:overflow-clip', sectionSpace[space], className)}
        >
          {children}
        </div>
      </Tag>
    );
  }

  return (
    <Tag id={id} {...a11y} data-tone={tone} data-accent={accent} className={cn(sectionSpace[space], className)}>
      {children}
    </Tag>
  );
}

/* ── Grid and Stack ───────────────────────────────────────────────────── */

export type GridColumns = 1 | 2 | 3 | 4;
export type Gap = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Columns collapse to one on phones and step up at `md` / `lg`. */
const gridColumns: Record<GridColumns, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
};

const gaps: Record<Gap, string> = {
  xs: 'gap-2',
  sm: 'gap-3',
  md: 'gap-4 md:gap-5',
  lg: 'gap-6 md:gap-8',
  xl: 'gap-10 md:gap-16',
};

type ListTag = 'div' | 'ul' | 'ol';

export type GridProps = {
  cols?: GridColumns;
  gap?: Gap;
  as?: ListTag;
  className?: string;
  children: ReactNode;
};

export function Grid({ cols = 3, gap = 'md', as: Tag = 'div', className, children }: GridProps) {
  return <Tag className={cn('grid', gridColumns[cols], gaps[gap], className)}>{children}</Tag>;
}

const stackAlign = {
  stretch: 'items-stretch',
  start: 'items-start',
  center: 'items-center',
} as const;

export type StackProps = {
  gap?: Gap;
  align?: keyof typeof stackAlign;
  as?: ListTag;
  className?: string;
  children: ReactNode;
};

/** Vertical rhythm for a column of blocks. */
export function Stack({ gap = 'md', align = 'stretch', as: Tag = 'div', className, children }: StackProps) {
  return <Tag className={cn('flex flex-col', stackAlign[align], gaps[gap], className)}>{children}</Tag>;
}

/* ── Divider ──────────────────────────────────────────────────────────── */

/** A hairline rule in the tone's line colour. */
export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-0 border-t border-line', className)} />;
}
