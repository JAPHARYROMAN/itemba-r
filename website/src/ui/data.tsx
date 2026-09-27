import type { ReactNode } from 'react';
import type { Faq } from '@/content/types';
import { cn } from './cn';
import { Icon } from './Icon';

/* ── Stats ("By the numbers") ─────────────────────────────────────────── */

const statColumns = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 md:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
} as const;

/**
 * A row of big static numerals. It is a description list, so a screen reader
 * hears each label with its value; the value is shown first visually. No
 * count-up animation.
 */
export function StatList({ columns = 4, className, children }: { columns?: keyof typeof statColumns; className?: string; children: ReactNode }) {
  return <dl className={cn('grid gap-x-6 gap-y-10 md:gap-x-10', statColumns[columns], className)}>{children}</dl>;
}

export type StatProps = {
  value: ReactNode;
  label: ReactNode;
  /** A short note under the label. */
  note?: ReactNode;
  /**
   * `display` (40–72px) by default; `display-xl` (56px on phones, up to
   * 96px) for a "by the numbers" moment that must outrank its section
   * title; `h1` for denser rows.
   */
  size?: 'display-xl' | 'display' | 'h1';
  /** `accent` sets the numeral in the tone's text-safe accent (a company's figure on its page). */
  tone?: 'default' | 'accent';
  className?: string;
};

const statSizes = {
  'display-xl': 'text-display-xl max-md:text-[3.5rem]',
  display: 'text-display',
  h1: 'text-h1',
} as const;

export function Stat({ value, label, note, size = 'display', tone = 'default', className }: StatProps) {
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <dt className="order-2 mt-2 text-body text-fg-muted">{label}</dt>
      <dd
        className={cn('order-1 font-semibold tabular-nums', tone === 'accent' ? 'text-accent-fg' : 'text-fg', statSizes[size])}
      >
        {value}
      </dd>
      {note ? <dd className="order-3 mt-1 text-caption text-fg-muted">{note}</dd> : null}
    </div>
  );
}

/* ── Chips ────────────────────────────────────────────────────────────── */

export type ChipProps = {
  /** A dot in the graphic accent before the label. */
  dot?: boolean;
  /**
   * `md` (the default) for chip rows; `compact` drops the vertical padding,
   * for a chip set inline in a line of text (a "Flagship" label beside a
   * name), so the line keeps its height. (cn does not resolve conflicting
   * classes, so a caller's `py-0` could not override the built-in `py-1`.)
   */
  size?: 'md' | 'compact';
  as?: 'span' | 'li';
  className?: string;
  children: ReactNode;
};

const chipSizes = { md: 'px-3 py-1', compact: 'px-2.5' } as const;

/**
 * A small outlined label (product lines, brands, audiences). Not
 * interactive. Always regular weight, even inside a bold line. The label
 * sits in its own span, so text split by keepCompounds wraps as one line
 * of text rather than as separate flex items.
 */
export function Chip({ dot = false, size = 'md', as: Tag = 'span', className, children }: ChipProps) {
  return (
    <Tag
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill border border-line text-caption font-normal text-fg-muted',
        chipSizes[size],
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className="inline-block size-1.5 shrink-0 rounded-full bg-accent" /> : null}
      <span className="min-w-0">{children}</span>
    </Tag>
  );
}

/** A wrapping list of chips; render each item as `<Chip as="li">`. */
export function ChipList({ className, children }: { className?: string; children: ReactNode }) {
  return <ul className={cn('flex flex-wrap gap-2', className)}>{children}</ul>;
}

/* ── Fact list ────────────────────────────────────────────────────────── */

export type Fact = { term: ReactNode; detail: ReactNode; key?: string };

export type FactListProps = {
  items: readonly Fact[];
  /**
   * `rows`: hairline-separated rows, term beside detail from `md` (legal
   * details, addresses). `grid`: short facts in two or three columns.
   */
  layout?: 'rows' | 'grid';
  className?: string;
};

export function FactList({ items, layout = 'rows', className }: FactListProps) {
  if (layout === 'grid') {
    return (
      <dl className={cn('grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3', className)}>
        {items.map((item, index) => (
          <div key={item.key ?? index} className="border-t border-line pt-4">
            <dt className="text-caption text-fg-muted">{item.term}</dt>
            <dd className="mt-1 text-body-lg text-fg">{item.detail}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl className={cn('border-b border-line', className)}>
      {items.map((item, index) => (
        <div key={item.key ?? index} className="grid gap-1 border-t border-line py-4 md:grid-cols-3 md:gap-8">
          <dt className="text-body text-fg-muted">{item.term}</dt>
          <dd className="text-body text-fg md:col-span-2">{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ── FAQ ──────────────────────────────────────────────────────────────── */

export type FaqListProps = {
  faqs: readonly Faq[];
  /**
   * Wrap each question in a heading of this level (2–6) so it appears in the
   * page outline. Omit when the list sits under a heading that already
   * names it and the questions should not be headings.
   */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** id for each row (for deep links); receives the index. */
  getId?: (faq: Faq, index: number) => string | undefined;
  /**
   * Hairlines: `all` (the default) above every question and below the last;
   * `between` only between questions, for a list under a rule of its own (a
   * topic heading's); `lg:between` keeps the outer rules until `lg`, where
   * the list sits beside its heading under that heading's rule.
   */
  rules?: 'all' | 'between' | 'lg:between';
  className?: string;
};

const faqRules = {
  all: 'border-b border-line',
  between: '[&>details:first-child]:border-t-0',
  'lg:between': 'border-b border-line lg:border-b-0 lg:[&>details:first-child]:border-t-0',
} as const;

/**
 * Disclosure rows with hairline separators, built on <details>: no JS,
 * keyboard and find-in-page work natively. Questions render as plain text,
 * so the FAQPage JSON-LD can match them exactly.
 */
export function FaqList({ faqs, headingLevel, getId, rules = 'all', className }: FaqListProps) {
  const Question = headingLevel ? (`h${headingLevel}` as const) : 'span';
  return (
    <div className={cn(faqRules[rules], className)}>
      {faqs.map((faq, index) => (
        <details key={faq.question} id={getId?.(faq, index)} className="group border-t border-line">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-6 py-5 text-fg [&::-webkit-details-marker]:hidden">
            <Question className="text-body-lg font-semibold">{faq.question}</Question>
            <Icon name="plus" size="sm" className="text-fg-muted transition-transform duration-base ease-apple group-open:rotate-45" />
          </summary>
          <div className="pb-6 pr-10 text-body text-fg-muted">
            <p>{faq.answer}</p>
          </div>
        </details>
      ))}
    </div>
  );
}
