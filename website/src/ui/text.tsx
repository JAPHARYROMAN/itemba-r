import { Fragment, type ReactNode } from 'react';
import type { SplitHeadline } from '@/content/types';
import { cn } from './cn';

/* ── Compounds ────────────────────────────────────────────────────────── */

/** Words joined by a hyphen or an en dash: ITEMBA-HARDWARE, Mpemba-Tunduma, Tanzania–Zambia, cross-border. */
const COMPOUND = /[\p{L}\p{N}]+(?:[-‐‑–][\p{L}\p{N}]+)+/gu;

/** From where a compound is kept whole: always, or from `md` for headline sizes. */
const keepFrom = { always: 'whitespace-nowrap', md: 'md:whitespace-nowrap' } as const;

function keepString(text: string, key: string, from: keyof typeof keepFrom): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(COMPOUND)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <span key={`${key}-${start}`} className={keepFrom[from]}>
        {match[0]}
      </span>,
    );
    last = start + match[0].length;
  }
  if (!parts.length) return text;
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment key={key}>{parts}</Fragment>;
}

/**
 * Keeps hyphenated and dashed compounds on one line, so a phone never sets
 * "ITEMBA- / HARDWARE" or "Tanzania– / Zambia". Plain-text children only;
 * elements pass through untouched, and the text content does not change.
 *
 * `always` suits copy up to h3 size. At h1 and display sizes a long
 * compound can be wider than a phone's whole line ("Tanzania–Zambia" at
 * 48px is about 370px), so there pass `md`: the compound is kept whole from
 * `md`, and a phone stays free to break it after the dash.
 */
export function keepCompounds(children: ReactNode, from: keyof typeof keepFrom = 'always'): ReactNode {
  if (typeof children === 'string') return keepString(children, 'c', from);
  if (Array.isArray(children)) {
    return children.map((child, index) => (typeof child === 'string' ? keepString(child, `c${index}`, from) : child));
  }
  return children;
}

/* ── Eyebrow ──────────────────────────────────────────────────────────── */

export type EyebrowProps = {
  /** `accent` uses the tone's text-safe accent; `muted` the secondary text colour. */
  tone?: 'accent' | 'muted';
  /** A small dot in the graphic accent before the text (company tiles). */
  dot?: boolean;
  as?: 'p' | 'span' | 'div';
  className?: string;
  children: ReactNode;
};

/** 14px, weight 600, +0.01em, sentence case. Never letter-spaced capitals. */
export function Eyebrow({ tone = 'accent', dot = false, as: Tag = 'p', className, children }: EyebrowProps) {
  return (
    <Tag
      className={cn(
        'text-eyebrow',
        tone === 'accent' ? 'text-accent-fg' : 'text-fg-muted',
        dot && 'inline-flex items-center gap-2',
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full bg-accent" /> : null}
      {children}
    </Tag>
  );
}

/* ── Heading ──────────────────────────────────────────────────────────── */

export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

/**
 * Visual size, independent of the level: a section can open with a display
 * h2, and a card title can be an h3 set at card size.
 * - `display-xl` 48–96px and `display` 40–72px: hero and statement lines.
 * - `h1` 40–56, `h2` 32–40, `h3` 24–28: page, section and block titles.
 * - `h4` 21–24 and `h5` 19px, both weight 600: card and row titles.
 */
export type HeadingSize = 'display-xl' | 'display' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5';

const headingSizes: Record<HeadingSize, string> = {
  'display-xl': 'text-display-xl',
  display: 'text-display',
  h1: 'text-h1',
  h2: 'text-h2',
  h3: 'text-h3',
  h4: 'text-lede font-semibold',
  h5: 'text-body-lg font-semibold',
};

const defaultSizeFor: Record<HeadingLevel, HeadingSize> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  h6: 'h5',
};

export type HeadingProps = {
  as: HeadingLevel;
  size?: HeadingSize;
  /** `muted` sets the whole heading in the secondary text colour. */
  tone?: 'default' | 'muted';
  id?: string;
  className?: string;
  children: ReactNode;
};

/** Sizes small enough that any compound fits a phone's line; larger ones keep compounds whole from `md` (keepCompounds). */
const compoundSafe: ReadonlySet<HeadingSize> = new Set(['h3', 'h4', 'h5']);

export function Heading({ as: Tag, size, tone = 'default', id, className, children }: HeadingProps) {
  const resolved = size ?? defaultSizeFor[Tag];
  return (
    <Tag id={id} className={cn(headingSizes[resolved], tone === 'muted' ? 'text-fg-muted' : 'text-fg', className)}>
      {keepCompounds(children, compoundSafe.has(resolved) ? 'always' : 'md')}
    </Tag>
  );
}

/**
 * The words of a SplitHeadline, read as one sentence (`${lead} ${accent}`).
 * - `muted`: Apple's two-tone line, the accent in the secondary colour.
 * - `break`: the accent starts a new line (from `md`), same colour.
 * - `muted-break`: both: two tones, on two lines from `md`.
 * - `inline`: plain text.
 * Place it inside a Heading.
 */
export function HeadlineText({
  headline,
  variant = 'muted',
}: {
  headline: SplitHeadline;
  variant?: 'muted' | 'break' | 'muted-break' | 'inline';
}) {
  if (variant === 'inline') return <>{`${headline.lead} ${headline.accent}`}</>;
  const muted = variant === 'muted' || variant === 'muted-break';
  const broken = variant === 'break' || variant === 'muted-break';
  return (
    <>
      {headline.lead}{' '}
      <span className={cn(muted && 'text-fg-muted', broken && 'md:block')}>{headline.accent}</span>
    </>
  );
}

/* ── Lede ─────────────────────────────────────────────────────────────── */

export type LedeProps = {
  tone?: 'default' | 'muted';
  as?: 'p' | 'div';
  className?: string;
  children: ReactNode;
};

/** The 21–24px introduction under a headline. Compounds stay on one line. */
export function Lede({ tone = 'default', as: Tag = 'p', className, children }: LedeProps) {
  return (
    <Tag className={cn('text-lede', tone === 'muted' ? 'text-fg-muted' : 'text-fg', className)}>{keepCompounds(children)}</Tag>
  );
}

/* ── Prose ────────────────────────────────────────────────────────────── */

/**
 * Long-form text (insight articles, legal copy): 19px body, 680px measure,
 * block rhythm, headings, lists and links styled from the tokens. Children
 * are plain elements (h2, h3, p, ul, ol, blockquote, a, strong).
 */
export function Prose({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'max-w-measure text-body-lg text-fg',
        '[&>*+*]:mt-6',
        '[&_h2]:text-h3 [&_h2]:text-fg [&>h2]:mt-14',
        '[&_h3]:text-lede [&_h3]:font-semibold [&_h3]:text-fg [&>h3]:mt-10',
        '[&>h2+*]:mt-4 [&>h3+*]:mt-3',
        '[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li+li]:mt-2 [&_li]:pl-1',
        '[&_a]:text-accent-fg [&_a]:underline [&_a]:decoration-1 [&_a]:underline-offset-4',
        '[&_strong]:font-semibold',
        '[&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-6 [&_blockquote]:text-fg-muted',
        className,
      )}
    >
      {children}
    </div>
  );
}
