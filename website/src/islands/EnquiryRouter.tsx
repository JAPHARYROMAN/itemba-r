'use client';

import { useId, useState } from 'react';
import { contact, contactActionLabels, mailtoWithSubject, telHref, whatsappWithMessage } from '@/content/contact';
import { enquiryFormCopy as copy, enquiryIntents } from '@/content/enquiry';
import type { IntentId } from '@/content/types';
import type { AccentName, Tone } from '@/design/tokens';
import { buildMessage, intentFor, resolveIntentId } from '@/lib/enquiry-client';
import { buttonClasses } from '@/ui/button';
import { cn } from '@/ui/cn';
import { Icon, type IconName } from '@/ui/Icon';
import { Eyebrow, Heading, keepCompounds, type HeadingLevel } from '@/ui/text';
import { useHydrated } from './use-hydrated';

export type EnquiryRouterProps = {
  defaultIntentId?: string;
  title?: string;
  description?: string;
  /** A smaller heading for enquiry cards nested within another section. */
  compact?: boolean;
  className?: string;
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  tone?: Tone;
};

const intentAccent = (id: IntentId): AccentName => (id === 'general' ? 'group' : id);
const intentDot = (id: IntentId) => (id === 'general' ? 'bg-fg' : 'bg-accent');

/**
 * Direct contact only: choosing a company prepares its WhatsApp message and
 * email subject. Visitors write and send in their chosen app, or call the
 * group office. This component never collects personal details or posts to
 * the retained enquiry API. ConversionTracker records actual channel clicks.
 * The default company and all three contact links are server-rendered.
 */
export default function EnquiryRouter({
  defaultIntentId = 'general', title = copy.title, description = copy.description,
  compact = false, className, headingLevel = 2, tone,
}: EnquiryRouterProps) {
  const initialIntent = resolveIntentId(defaultIntentId);
  const [intentId, setIntentId] = useState<IntentId>(initialIntent);
  const hydrated = useHydrated();
  const uid = useId();
  const headingId = `${uid}-heading`;
  const selectedIntent = intentFor(intentId);
  const preparedMessage = buildMessage({
    intentLabel: selectedIntent.label, routeTo: selectedIntent.routeTo,
    name: '', organization: '', contactMethod: '', message: '',
  });
  const HeadingTag = `h${headingLevel}` as HeadingLevel;
  const channels: { key: string; href: string; icon: IconName; label: string; name: string }[] = [
    { key: 'whatsapp', href: whatsappWithMessage(preparedMessage), icon: 'whatsapp', label: copy.actions.whatsapp, name: contactActionLabels.whatsapp },
    { key: 'email', href: mailtoWithSubject(selectedIntent.subject, preparedMessage), icon: 'mail', label: copy.actions.email, name: contactActionLabels.email },
    { key: 'call', href: telHref(contact.primaryPhone), icon: 'phone', label: copy.actions.call, name: contactActionLabels.call },
  ];

  return (
    <section
      data-enquiry-router=""
      data-default-intent={initialIntent}
      data-contact-mode="direct"
      data-tone={tone}
      aria-labelledby={headingId}
      className={cn(
        'rounded-tile p-6 text-fg [container-type:inline-size] md:p-10',
        tone ? 'bg-surface [--field:var(--surface-alt)]' : 'bg-surface-alt [--field:var(--surface)]',
        className,
      )}
    >
      <Eyebrow>{copy.eyebrow}</Eyebrow>
      <Heading as={HeadingTag} size={compact ? 'h3' : 'h2'} id={headingId} className="mt-2">{title}</Heading>
      <p className={cn('mt-3 text-fg-muted', compact ? 'text-body' : 'text-body-lg')}>{keepCompounds(description)}</p>
      <fieldset disabled={!hydrated} className="mt-8 min-w-0">
        <legend className="text-body font-semibold text-fg">{copy.intentLegend}</legend>
        <div className="mt-3 grid grid-cols-1 gap-2 [@container(min-width:25rem)]:grid-cols-2 [@container(min-width:50rem)]:grid-cols-4">
          {enquiryIntents.map((intent) => (
            <label key={intent.id} data-accent={intentAccent(intent.id)} className="relative flex">
              <input type="radio" name="intentId" value={intent.id} checked={intent.id === selectedIntent.id}
                onChange={() => setIntentId(intent.id)} className="peer sr-only" />
              <span className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2.5 whitespace-nowrap rounded-pill border border-line-strong bg-[rgb(var(--field))] px-4 py-2 text-caption font-semibold text-fg transition-[border-color,box-shadow] duration-fast ease-apple hover:border-fg peer-checked:border-fg peer-checked:shadow-[inset_0_0_0_1px_rgb(var(--fg))] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus">
                <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', intentDot(intent.id))} />
                {intent.segmentLabel}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div data-accent={intentAccent(selectedIntent.id)} className="mt-3 rounded-input bg-[rgb(var(--field))] px-4 py-3.5">
        <p className="text-body font-semibold text-fg">{selectedIntent.label}</p>
        <p className="mt-1 text-caption text-fg-muted">{selectedIntent.summary}</p>
        <p className="mt-2.5 flex items-center gap-1.5 text-caption text-fg">
          <Icon name="arrow-right" size="xs" className="text-accent" />
          <span>{copy.routedToPrefix} <span className="font-semibold">{selectedIntent.routeTo}</span></span>
        </p>
      </div>
      <p className="mt-7 text-body text-fg-muted">{copy.directLead}</p>
      <ul className="mt-4 grid grid-cols-1 gap-3 [@container(min-width:34rem)]:grid-cols-3">
        {channels.map((action, index) => (
          <li key={action.key}>
            <a href={action.href} aria-label={action.name}
              className={cn(buttonClasses({ size: 'lg', variant: index === 0 ? 'primary' : 'secondary' }), 'w-full gap-2')}>
              <Icon name={action.icon} size="sm" /><span>{action.label}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-5 break-words text-caption text-fg-muted">{contact.email} · {contact.primaryPhone}</p>
      <noscript><p className="mt-4 text-caption text-fg-muted">{copy.noScript}</p></noscript>
    </section>
  );
}
