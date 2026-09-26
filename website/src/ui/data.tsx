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
  /** `display` (40–72px) by default; `h1` for denser rows. */
  size?: 'display' | 'h1';
  className?: string;
};

export function Stat({ value, label, note, size = 'display', className }: StatProps) {
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <dt className="order-2 mt-2 text-body text-fg-muted">{label}</dt>
      <dd className={cn('order-1 font-semibold tabular-nums text-fg', size === 'display' ? 'text-display' : 'text-h1')}>{value}</dd>
      {note ? <dd className="order-3 mt-1 text-caption text-fg-muted">{note}</dd> : null}
    </div>
  );
}

/* ── Chips ────────────────────────────────────────────────────────────── */

export type ChipProps = {
  /** A dot in the graphic accent before the label. */
  dot?: boolean;
  as?: 'span' | 'li';
  className?: string;
  children: ReactNode;
};

/** A small outlined label (product lines, brands, audiences). Not interactive. */
export function Chip({ dot = false, as: Tag = 'span', className, children }: ChipProps) {
  return (
    <Tag className={cn('inline-flex items-center gap-1.5 rounded-pill border border-line px-3 py-1 text-caption text-fg-muted', className)}>
      {dot ? <span aria-hidden="true" className="inline-block size-1.5 shrink-0 rounded-full bg-accent" /> : null}
      {children}
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
  className?: string;
};

/**
 * Disclosure rows with hairline separators, built on <details>: no JS,
 * keyboard and find-in-page work natively. Questions render as plain text,
 * so the FAQPage JSON-LD can match them exactly.
 */
export function FaqList({ faqs, headingLevel, getId, className }: FaqListProps) {
  const Question = headingLevel ? (`h${headingLevel}` as const) : 'span';
  return (
    <div className={cn('border-b border-line', className)}>
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
