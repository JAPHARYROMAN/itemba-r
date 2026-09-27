'use client';

import { usePathname } from 'next/navigation';
import { useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { contact, contactActionLabels, mailtoWithSubject, telHref, whatsappWithMessage } from '@/content/contact';
import { enquiryFormCopy as copy, enquiryIntents } from '@/content/enquiry';
import type { IntentId } from '@/content/types';
import type { AccentName, Tone } from '@/design/tokens';
import { trackConversion } from '@/lib/analytics';
import {
  buildMessage,
  enquiryConversion,
  enquiryPayload,
  intentFor,
  missingRequired,
  postEnquiry,
  resolveIntentId,
  type RequiredField,
} from '@/lib/enquiry-client';
import { buttonClasses } from '@/ui/actions';
import { cn } from '@/ui/cn';
import { Icon, type IconName } from '@/ui/Icon';
import { Eyebrow, Heading, type HeadingLevel } from '@/ui/text';
import { useHydrated } from './use-hydrated';

export type EnquiryRouterProps = {
  /** The intent selected at first; an unknown id falls back to `general`. */
  defaultIntentId?: string;
  title?: string;
  description?: string;
  /** The short form: preferred contact and message only (no name or organisation). */
  compact?: boolean;
  className?: string;
  /** Level of the form's heading, to fit the page outline (h2 by default). */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /**
   * The card's own tone. Omitted, the card takes the alternate surface of
   * the tile it sits on (#f5f5f7 on white, white on #f5f5f7), like a Card.
   */
  tone?: Tone;
};

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

/** The accent dot of each intent: group gold for the office, the company accent otherwise. */
const intentAccent = (id: IntentId): AccentName => (id === 'general' ? 'group' : id);

/** Containers wide enough for side-by-side fields and a single row of intents. */
const wide = {
  fields: '[@container(min-width:34rem)]:grid-cols-2',
  span: '[@container(min-width:34rem)]:col-span-2',
  intents: '[@container(min-width:44rem)]:grid-cols-4',
  row: '[@container(min-width:34rem)]:flex-row [@container(min-width:34rem)]:items-center',
  auto: '[@container(min-width:34rem)]:w-auto',
} as const;

/**
 * The enquiry form: one group office routes every enquiry to the right
 * company. The visitor picks who it is for (a fieldset of radio options),
 * writes a message, and either submits it to POST /api/enquiries or sends the
 * same prepared message by WhatsApp or email, or calls.
 *
 * - Logic, payload and analytics live in src/lib/enquiry-client.ts and are
 *   origin/main's, unchanged (`enquiry_submit` fires after a successful POST).
 * - Every field has a name, a label, autocomplete and, where needed,
 *   `required`. A failed check sets aria-invalid, fills the field's error
 *   line (its aria-describedby, always in the DOM) and focuses the first
 *   such field. The status line is always in the DOM too, so screen readers
 *   announce each change.
 * - The submit button stays disabled until the island has hydrated, so a
 *   visitor without JavaScript cannot submit the form natively (no GET with
 *   personal data in the URL); the WhatsApp, email and call links, rendered
 *   on the server, work for them, and a <noscript> line points to them.
 * - `data-enquiry-router` and `data-default-intent` mark the form for the
 *   route snapshot and the e2e harness.
 */
export default function EnquiryRouter({
  defaultIntentId = 'general',
  title = copy.title,
  description = copy.description,
  compact = false,
  className,
  headingLevel = 2,
  tone,
}: EnquiryRouterProps) {
  const initialIntent = resolveIntentId(defaultIntentId);
  const [intentId, setIntentId] = useState<IntentId>(initialIntent);
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [contactMethod, setContactMethod] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitMessage, setSubmitMessage] = useState('');
  const [invalid, setInvalid] = useState<readonly RequiredField[]>([]);
  const pathname = usePathname();
  const hydrated = useHydrated();

  const uid = useId();
  const ids = {
    heading: `${uid}-heading`,
    status: `${uid}-status`,
    name: `${uid}-name`,
    organization: `${uid}-organization`,
    contactMethod: `${uid}-contact`,
    contactMethodError: `${uid}-contact-error`,
    message: `${uid}-message`,
    messageError: `${uid}-message-error`,
  };
  const contactRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const selectedIntent = intentFor(intentId);
  const preparedMessage = useMemo(
    () =>
      buildMessage({
        intentLabel: selectedIntent.label,
        routeTo: selectedIntent.routeTo,
        name,
        organization,
        contactMethod,
        message,
      }),
    [contactMethod, message, name, organization, selectedIntent],
  );

  const submitting = submitState === 'submitting';
  const isInvalid = (field: RequiredField) => invalid.includes(field);
  const clearInvalid = (field: RequiredField) => {
    if (isInvalid(field)) setInvalid((current) => current.filter((f) => f !== field));
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const missing = missingRequired({ contactMethod, message });
    if (missing.length) {
      setInvalid(missing);
      setSubmitState('error');
      setSubmitMessage(copy.messages.required);
      (missing[0] === 'contactMethod' ? contactRef.current : messageRef.current)?.focus();
      return;
    }

    setInvalid([]);
    setSubmitState('submitting');
    setSubmitMessage('');

    const outcome = await postEnquiry(
      enquiryPayload({
        intentId: selectedIntent.id,
        name,
        organization,
        contactMethod,
        message,
        sourcePath: pathname,
        website,
      }),
    );

    if (!outcome.ok) {
      setSubmitState('error');
      setSubmitMessage(outcome.error);
      return;
    }

    setSubmitState('success');
    setSubmitMessage(outcome.message);
    trackConversion('enquiry_submit', enquiryConversion(outcome.result, selectedIntent, pathname));
    setMessage('');
  }

  const HeadingTag = `h${headingLevel}` as HeadingLevel;
  const fallbacks: { key: string; href: string; icon: IconName; label: string; name: string }[] = [
    {
      key: 'whatsapp',
      href: whatsappWithMessage(preparedMessage),
      icon: 'whatsapp',
      label: copy.actions.whatsapp,
      name: contactActionLabels.whatsapp,
    },
    {
      key: 'email',
      href: mailtoWithSubject(selectedIntent.subject, preparedMessage),
      icon: 'mail',
      label: copy.actions.email,
      name: contactActionLabels.email,
    },
    {
      key: 'call',
      href: telHref(contact.primaryPhone),
      icon: 'phone',
      label: copy.actions.call,
      name: contactActionLabels.call,
    },
  ];

  return (
    <form
      data-enquiry-router=""
      data-default-intent={initialIntent}
      data-tone={tone}
      aria-labelledby={ids.heading}
      aria-busy={submitting || undefined}
      noValidate
      onSubmit={handleSubmit}
      className={cn(
        'rounded-tile p-6 text-fg [container-type:inline-size] md:p-10',
        // Fields, options and panels take the other surface of the pair, so
        // they always stand off the card: white on #f5f5f7, #f5f5f7 on white.
        tone ? 'bg-surface [--field:var(--surface-alt)]' : 'bg-surface-alt [--field:var(--surface)]',
        className,
      )}
    >
      <div>
        <Eyebrow>{copy.eyebrow}</Eyebrow>
        <Heading as={HeadingTag} size={compact ? 'h3' : 'h2'} id={ids.heading} className="mt-2">
          {title}
        </Heading>
        <p className={cn('mt-3 text-fg-muted', compact ? 'text-body' : 'text-body-lg')}>{description}</p>
      </div>

      <fieldset className="mt-8 min-w-0">
        <legend className="text-body font-semibold text-fg">{copy.intentLegend}</legend>
        <div className={cn('mt-3 grid grid-cols-2 gap-2', wide.intents)}>
          {enquiryIntents.map((intent) => (
            <label key={intent.id} data-accent={intentAccent(intent.id)} className="relative flex">
              <input
                type="radio"
                name="intentId"
                value={intent.id}
                checked={intent.id === selectedIntent.id}
                onChange={() => setIntentId(intent.id)}
                className="peer sr-only"
              />
              <span className="flex min-h-14 w-full cursor-pointer items-center gap-2.5 rounded-input border border-line-strong bg-[rgb(var(--field))] px-3.5 py-2.5 text-caption font-semibold text-fg transition-[border-color,box-shadow] duration-fast ease-apple hover:border-fg peer-checked:border-fg peer-checked:shadow-[inset_0_0_0_1px_rgb(var(--fg))] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
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
          <span>
            {copy.routedToPrefix} <span className="font-semibold">{selectedIntent.routeTo}</span>
          </span>
        </p>
      </div>

      {/* Honeypot: hidden from people, often filled by bots (the API then stores nothing). */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(event) => setWebsite(event.target.value)}
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />

      <div className={cn('mt-6 grid grid-cols-1 gap-3', !compact && wide.fields)}>
        {compact ? null : (
          <Field id={ids.name} label={copy.fields.name.label} optional>
            <input
              id={ids.name}
              name="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={copy.fields.name.placeholder}
              className={inputClasses}
            />
          </Field>
        )}
        {compact ? null : (
          <Field id={ids.organization} label={copy.fields.organization.label} optional>
            <input
              id={ids.organization}
              name="organization"
              type="text"
              autoComplete="organization"
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
              placeholder={copy.fields.organization.placeholder}
              className={inputClasses}
            />
          </Field>
        )}
        <Field
          id={ids.contactMethod}
          label={copy.fields.contactMethod.label}
          errorId={ids.contactMethodError}
          error={isInvalid('contactMethod') ? copy.fields.contactMethod.error : undefined}
          className={compact ? undefined : wide.span}
        >
          <input
            ref={contactRef}
            id={ids.contactMethod}
            name="contactMethod"
            type="text"
            autoComplete="tel"
            required
            aria-invalid={isInvalid('contactMethod') || undefined}
            aria-describedby={ids.contactMethodError}
            value={contactMethod}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setContactMethod(event.target.value);
              clearInvalid('contactMethod');
            }}
            placeholder={copy.fields.contactMethod.placeholder}
            className={inputClasses}
          />
        </Field>
        <Field
          id={ids.message}
          label={copy.fields.message.label}
          errorId={ids.messageError}
          error={isInvalid('message') ? copy.fields.message.error : undefined}
          className={compact ? undefined : wide.span}
        >
          <textarea
            ref={messageRef}
            id={ids.message}
            name="message"
            autoComplete="off"
            rows={compact ? 4 : 5}
            required
            aria-invalid={isInvalid('message') || undefined}
            aria-describedby={ids.messageError}
            value={message}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
              setMessage(event.target.value);
              clearInvalid('message');
            }}
            placeholder={copy.fields.message.placeholder}
            className={textareaClasses}
          />
        </Field>
      </div>

      <div className={cn('mt-6 flex flex-col gap-4', wide.row)}>
        <button
          type="submit"
          disabled={!hydrated || submitting}
          className={cn(buttonClasses({ size: 'lg' }), 'w-full', wide.auto)}
        >
          {submitting ? copy.submitting : copy.submit}
        </button>
        <p
          id={ids.status}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={cn(
            'text-caption',
            submitState === 'success' && 'text-success',
            submitState === 'error' && 'text-danger',
            !submitMessage && 'sr-only',
          )}
        >
          {submitMessage ? (
            <span className="inline-flex items-start gap-2">
              {submitState === 'success' ? <Icon name="check" size="sm" className="-mt-px" /> : null}
              <span>{submitMessage}</span>
            </span>
          ) : null}
        </p>
      </div>

      <noscript>
        <p className="mt-4 text-caption text-fg-muted">{copy.noScript}</p>
      </noscript>

      <div className="mt-8 border-t border-line pt-6">
        <p className="text-caption text-fg-muted">{copy.fallbackLead}</p>
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {fallbacks.map((action) => (
            <li key={action.key} className="flex">
              <a
                href={action.href}
                aria-label={action.name}
                className="flex min-h-16 w-full flex-col items-center justify-center gap-1.5 rounded-input bg-[rgb(var(--field))] px-2 py-3 text-caption font-medium text-fg transition-shadow duration-fast ease-apple hover:shadow-card"
              >
                <Icon name={action.icon} size="sm" />
                <span>{action.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </form>
  );
}

/**
 * The field control: 56px tall, 12px radius, a strong hairline that turns
 * the focus blue. The label sits inside the field (Field) and floats up once
 * the field is focused or filled; the hint placeholder shows only while the
 * focused field is empty.
 */
const controlClasses = cn(
  'peer block w-full rounded-input border border-line-strong bg-[rgb(var(--field))] px-4 text-body text-fg',
  'transition-[border-color,box-shadow] duration-fast ease-apple',
  'placeholder:text-transparent focus:placeholder:text-fg-muted',
  'focus:border-focus focus:outline-none focus:ring-4 focus:ring-focus/20',
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/20',
);
const inputClasses = cn(controlClasses, 'h-14 pb-1.5 pt-[1.375rem]');
const textareaClasses = cn(controlClasses, 'min-h-36 resize-y pb-3 pt-7');

function Field({
  id,
  label,
  optional = false,
  errorId,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  /**
   * id of the field's error line. The line is always in the DOM (empty when
   * the field is fine) and the control's aria-describedby always points at
   * it: ID references are never added after hydration, so they stay right
   * even where a page's server and client ids disagree.
   */
  errorId?: string;
  error?: string;
  className?: string;
  /** The control; it must come first and carry the `peer` class. */
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <div className="relative">
        {children}
        {/* Floated (small, top) by default, so the label never overlaps a value; it drops into the empty field only where :placeholder-shown works. */}
        <label
          htmlFor={id}
          className="pointer-events-none absolute left-4 top-[0.4375rem] text-legal text-fg-muted transition-[top,font-size,line-height] duration-fast ease-apple peer-placeholder-shown:top-4 peer-placeholder-shown:text-body peer-focus:top-[0.4375rem] peer-focus:text-legal"
        >
          {label}
          {optional ? <span> ({copy.optional})</span> : null}
        </label>
      </div>
      {errorId ? (
        <p id={errorId} className="mt-1.5 px-1 text-caption text-danger empty:hidden">
          {error ?? ''}
        </p>
      ) : null}
    </div>
  );
}
