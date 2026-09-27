import type { ReactNode } from 'react';
import { sectionLeads, sectionNumber, sectionTitle, type ProfileSectionId } from '@/content/profile';
import type { Tone } from '@/design/tokens';
import { Container, Heading, Icon, Lede, Section, cn, keepCompounds, type IconName } from '@/ui';

/** The id of a report section's h2 (its section is labelled by it). */
export const titleIdFor = (id: ProfileSectionId) => `${id}-title`;

/**
 * One chapter of the profile, as an annual report sets it: a full-width
 * tile in the page's tone rhythm, carrying the outline id the contents
 * sheet (ProfileNav) and other pages link to. The tile is labelled by its
 * h2 (ReportHeader).
 */
export function ReportSection({
  id,
  tone = 'light',
  className,
  children,
}: {
  id: ProfileSectionId;
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Section tone={tone} id={id} labelledBy={titleIdFor(id)} className={className}>
      <Container>{children}</Container>
    </Section>
  );
}

/**
 * The chapter's heading block: its number in the document (decorative; the
 * contents sheet shows the same number), the outline title as the h2 at the
 * reference pages' section size, and the one-line introduction where the
 * outline has one.
 */
export function ReportHeader({
  id,
  lead = sectionLeads[id],
  className,
  children,
}: {
  id: ProfileSectionId;
  lead?: string;
  className?: string;
  /** Content under the heading block, in the same column (a split layout's aside). */
  children?: ReactNode;
}) {
  return (
    <div className={className}>
      <p aria-hidden="true" className="text-eyebrow tabular-nums text-gold-fg">
        {String(sectionNumber(id)).padStart(2, '0')}
      </p>
      <Heading as="h2" id={titleIdFor(id)} size="h1" className="mt-2">
        {sectionTitle(id)}
      </Heading>
      {lead ? (
        <Lede tone="muted" className="mt-5 max-w-[40rem]">
          {lead}
        </Lede>
      ) : null}
      {children}
    </div>
  );
}

/**
 * The report's two-column chapter (as the reference pages set FAQs and the
 * enquiry form): the heading block on the left, sticky under the nav and
 * the sub-nav from `lg` while a longer column scrolls past; the chapter's
 * content on the right. Stacked on smaller screens.
 */
export function ReportSplit({ header, children, className }: { header: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16', className)}>
      <div className="lg:sticky lg:top-[calc(var(--nav-height)+var(--subnav-height)+2rem)]">{header}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * A list of statements as hairline rows, each marked with a line icon in
 * the tone's graphic accent (group gold on this page): the check of the
 * reference strengths tile, or another glyph where a check would claim too
 * much (plans, documents).
 */
export function ReportList({
  items,
  icon = 'check',
  className,
}: {
  items: readonly string[];
  icon?: IconName;
  className?: string;
}) {
  return (
    <ul role="list" className={cn('border-b border-line', className)}>
      {items.map((item) => (
        <li key={item} className="flex items-start gap-4 border-t border-line py-4 md:py-5">
          <Icon name={icon} size="md" strokeWidth={1.6} className="mt-px text-accent" />
          <span className="text-body-lg text-fg">{keepCompounds(item)}</span>
        </li>
      ))}
    </ul>
  );
}
