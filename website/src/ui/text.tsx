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
  /**
   * `accent` uses the tone's text-safe accent; `gold` group gold whatever
   * the accent (home, where a company shows only in its dot); `muted` the
   * secondary text colour.
   */
  tone?: 'accent' | 'gold' | 'muted';
  /** A small dot in the graphic accent before the text (company tiles). */
  dot?: boolean;
  as?: 'p' | 'span' | 'div';
  className?: string;
  children: ReactNode;
};

const eyebrowTones = { accent: 'text-accent-fg', gold: 'text-gold-fg', muted: 'text-fg-muted' } as const;

/**
 * 14px, weight 600, +0.01em, sentence case. Never letter-spaced capitals.
 *
 * With `dot`, the text sits in its own span beside the dot, so text split
 * by keepCompounds still wraps as one line of text (not as separate flex
 * items), and a wrapped eyebrow hangs under its first word. The dot sits
 * in a box one line tall (1.43em, the eyebrow's line height), so it stays
 * centred on the first line when the eyebrow wraps.
 */
export function Eyebrow({ tone = 'accent', dot = false, as: Tag = 'p', className, children }: EyebrowProps) {
  if (!dot) return <Tag className={cn('text-eyebrow', eyebrowTones[tone], className)}>{children}</Tag>;
  return (
    <Tag className={cn('text-eyebrow', eyebrowTones[tone], 'inline-flex items-start gap-2', className)}>
      <span aria-hidden="true" className="flex h-[1.43em] shrink-0 items-center">
        <span className="inline-block size-2 rounded-full bg-accent" />
      </span>
      <span className="min-w-0">{children}</span>
    </Tag>
  );
}

/* ── Heading ──────────────────────────────────────────────────────────── */

export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

/**
 * Visual size, independent of the level: a section can open with a display
 * h2, and a card title can be an h3 set at card size.
 * - `display-xl` 48–96px and `display` 40–72px: hero lines.
 * - `statement`: display from `md`; on phones it steps down to 33px at
 *   360px (joining display at 46px at `md`), so a page's h1 leads a
 *   statement or closing line there by at least 1.2x.
 * - `h1` 32–56, `h2` 32–40, `h3` 24–28: page, section and block titles.
 * - `h4` 21–24 and `h5` 19px, both weight 600: card and row titles.
 */
export type HeadingSize = 'display-xl' | 'display' | 'statement' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5';

const headingSizes: Record<HeadingSize, string> = {
  'display-xl': 'text-display-xl',
  display: 'text-display',
  statement: 'text-display max-md:text-[length:clamp(2.0625rem,1.341rem_+_3.206vw,2.875rem)]',
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

/** A short sentence (up to this many characters) may be kept on one line, even on a phone. */
const SHORT_SENTENCE = 20;

/**
 * Keeps each short sentence of a lead on one line ("One group. / Three
 * companies.", never "One group. Three / companies."). Longer sentences
 * wrap freely, so nothing can overflow a phone.
 */
function keepSentences(text: string): ReactNode {
  const parts = text.split(/(?<=[.!?])\s+/);
  if (parts.length < 2) return text;
  return parts.map((part, index) => (
    <Fragment key={index}>
      {index ? ' ' : null}
      {part.length <= SHORT_SENTENCE ? <span className="whitespace-nowrap">{part}</span> : part}
    </Fragment>
  ));
}

/**
 * The words of a SplitHeadline, read as one sentence (`${lead} ${accent}`).
 * - `muted`: Apple's two-tone line, the accent in the secondary colour.
 * - `break`: the accent starts a new line, same colour.
 * - `muted-break`: both: two tones, on two lines.
 * - `inline`: plain text.
 * The break applies from `md` by default; `breakFrom="always"` keeps it on
 * phones too, and keeps each short sentence of the lead whole, so a
 * two-tone statement keeps its structure at 360px.
 * Place it inside a Heading.
 */
export function HeadlineText({
  headline,
  variant = 'muted',
  breakFrom = 'md',
}: {
  headline: SplitHeadline;
  variant?: 'muted' | 'break' | 'muted-break' | 'inline';
  breakFrom?: 'md' | 'always';
}) {
  if (variant === 'inline') return <>{`${headline.lead} ${headline.accent}`}</>;
  const muted = variant === 'muted' || variant === 'muted-break';
  const broken = variant === 'break' || variant === 'muted-break';
  const always = broken && breakFrom === 'always';
  return (
    <>
      {always ? keepSentences(headline.lead) : headline.lead}{' '}
      <span className={cn(muted && 'text-fg-muted', broken && (always ? 'block' : 'md:block'))}>{headline.accent}</span>
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

/**
 * The 21–24px introduction under a headline. Compounds stay on one line,
 * and a lede keeps `text-wrap: pretty` at every width (body copy drops it
 * on phones: base.css), so its short last line never strands a word.
 */
export function Lede({ tone = 'default', as: Tag = 'p', className, children }: LedeProps) {
  return (
    <Tag className={cn('text-lede text-pretty', tone === 'muted' ? 'text-fg-muted' : 'text-fg', className)}>
      {keepCompounds(children)}
    </Tag>
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
