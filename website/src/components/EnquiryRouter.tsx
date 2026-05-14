'use client';

import { type FormEvent, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  contact,
  enquiryIntents,
  mailtoWithSubject,
  whatsappWithMessage,
} from '@/lib/site';
import { trackConversion } from '@/lib/analytics';

type EnquiryRouterProps = {
  defaultIntentId?: string;
  title?: string;
  description?: string;
  compact?: boolean;
  className?: string;
};

function MailIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M3 8l7.9 5.26a2 2 0 002.2 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M3 5a2 2 0 012-2h2.2a1 1 0 01.95.68l1.1 3.3a1 1 0 01-.45 1.2l-1.5.82a12.5 12.5 0 005.7 5.7l.82-1.5a1 1 0 011.2-.45l3.3 1.1a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C8.82 21 3 15.18 3 8V5z"
      />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12.04 2a9.83 9.83 0 00-8.46 14.82L2.4 22l5.29-1.12A9.83 9.83 0 1012.04 2zm0 1.78a8.05 8.05 0 014.07 14.99 8.06 8.06 0 01-7.85.36l-.33-.17-3.05.65.67-2.95-.2-.34A8.05 8.05 0 0112.04 3.78zm-3.5 4.15c-.18 0-.47.07-.72.34-.25.27-.95.93-.95 2.27 0 1.34.97 2.63 1.1 2.81.14.18 1.88 3.02 4.63 4.12 2.28.91 2.75.73 3.24.69.5-.05 1.61-.66 1.84-1.3.23-.64.23-1.19.16-1.3-.07-.12-.25-.18-.52-.32-.27-.13-1.6-.79-1.85-.88-.25-.09-.43-.14-.61.14-.18.27-.7.88-.86 1.06-.16.18-.32.2-.59.07-.27-.14-1.14-.42-2.17-1.34-.8-.71-1.34-1.59-1.5-1.86-.16-.27-.02-.42.12-.55.12-.12.27-.32.41-.48.14-.16.18-.27.27-.45.09-.18.05-.34-.02-.48-.07-.13-.61-1.48-.84-2.02-.22-.53-.44-.45-.61-.46h-.52z" />
    </svg>
  );
}

function buildMessage({
  intentLabel,
  routeTo,
  name,
  organization,
  contactMethod,
  message,
}: {
  intentLabel: string;
  routeTo: string;
  name: string;
  organization: string;
  contactMethod: string;
  message: string;
}) {
  const lines = [
    'Hello Itemba Group,',
    '',
    `Enquiry type: ${intentLabel}`,
    `Please route to: ${routeTo}`,
  ];

  if (name.trim()) lines.push(`Name: ${name.trim()}`);
  if (organization.trim()) lines.push(`Organisation: ${organization.trim()}`);
  if (contactMethod.trim()) lines.push(`Preferred contact: ${contactMethod.trim()}`);
  if (message.trim()) {
    lines.push('', 'Message:', message.trim());
  }

  lines.push('', 'Thank you.');
  return lines.join('\n');
}

export default function EnquiryRouter({
  defaultIntentId = 'general',
  title = 'Route an enquiry',
  description = 'Choose the area that best matches your enquiry and contact the right team with a prepared message.',
  compact = false,
  className = '',
}: EnquiryRouterProps) {
  const initialIntent = enquiryIntents.some((intent) => intent.id === defaultIntentId)
    ? defaultIntentId
    : 'general';
  const [intentId, setIntentId] = useState(initialIntent);
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [contactMethod, setContactMethod] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [submitMessage, setSubmitMessage] = useState('');
  const pathname = usePathname();

  const selectedIntent = enquiryIntents.find((intent) => intent.id === intentId) ?? enquiryIntents[0];
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!contactMethod.trim() || !message.trim()) {
      setSubmitState('error');
      setSubmitMessage('Preferred contact and message are required.');
      return;
    }

    setSubmitState('submitting');
    setSubmitMessage('');

    try {
      const response = await fetch('/api/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intentId: selectedIntent.id,
          name,
          organization,
          contactMethod,
          message,
          sourcePath: pathname,
          website,
        }),
      });
      const result = (await response.json()) as { ok?: boolean; id?: string | null; error?: string; emailStatus?: string };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || 'The enquiry could not be submitted.');
      }

      setSubmitState('success');
      setSubmitMessage(
        result.emailStatus === 'sent'
          ? 'Enquiry submitted and emailed to the team.'
          : 'Enquiry submitted and saved. Use WhatsApp for urgent follow-up.',
      );
      trackConversion('enquiry_submit', {
        enquiry_id: result.id,
        intent_id: selectedIntent.id,
        intent_label: selectedIntent.label,
        route_to: selectedIntent.routeTo,
        email_status: result.emailStatus || 'unknown',
        page_path: pathname,
      });
      setMessage('');
    } catch (error) {
      setSubmitState('error');
      setSubmitMessage(error instanceof Error ? error.message : 'The enquiry could not be submitted.');
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 ${className}`}>
      <div className="mb-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gold-600">Business Enquiry</p>
        <h2 className="font-tight text-2xl font-black leading-tight tracking-tighter text-ink-900">{title}</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{description}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {enquiryIntents.map((intent) => {
          const selected = intent.id === selectedIntent.id;

          return (
            <button
              type="button"
              key={intent.id}
              onClick={() => setIntentId(intent.id)}
              aria-pressed={selected}
              className={`rounded-xl border p-3 text-left transition ${
                selected ? intent.ringClass : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300'
              }`}
            >
              <span className={`mb-3 block h-1.5 w-8 rounded-full ${intent.accentClass}`} />
              <span className="block text-sm font-semibold">{intent.shortLabel}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 rounded-xl bg-slate-50 p-4">
        <div className="text-sm font-semibold text-ink-900">{selectedIntent.label}</div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{selectedIntent.summary}</p>
        <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
          Routed to {selectedIntent.routeTo}
        </p>
      </div>

      <input
        type="text"
        value={website}
        onChange={(event) => setWebsite(event.target.value)}
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />

      <div className={`mt-5 grid grid-cols-1 gap-3 ${compact ? '' : 'sm:grid-cols-2'}`}>
        {!compact && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-500">Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-ink-900 transition focus:border-gold-400"
              placeholder="Your name"
            />
          </label>
        )}
        {!compact && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-500">Organisation</span>
            <input
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-ink-900 transition focus:border-gold-400"
              placeholder="Company or organisation"
            />
          </label>
        )}
        <label className={`block ${compact ? '' : 'sm:col-span-2'}`}>
          <span className="mb-1.5 block text-xs font-semibold text-slate-500">Preferred contact</span>
          <input
            value={contactMethod}
            onChange={(event) => setContactMethod(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-ink-900 transition focus:border-gold-400"
            placeholder="Phone, email, or WhatsApp number"
          />
        </label>
        <label className={`block ${compact ? '' : 'sm:col-span-2'}`}>
          <span className="mb-1.5 block text-xs font-semibold text-slate-500">Message</span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="min-h-28 w-full resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-ink-900 transition focus:border-gold-400"
            placeholder="Briefly describe what you need"
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={submitState === 'submitting'}
        className="btn-primary mt-5 inline-flex w-full items-center justify-center rounded-full bg-ink-900 px-5 py-3 text-sm font-semibold text-white hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitState === 'submitting' ? 'Submitting enquiry...' : 'Submit enquiry'}
      </button>

      {submitMessage && (
        <p
          className={`mt-3 rounded-xl px-4 py-3 text-sm ${
            submitState === 'success'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-red-50 text-red-700'
          }`}
          aria-live="polite"
        >
          {submitMessage}
        </p>
      )}

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <a
          href={whatsappWithMessage(preparedMessage)}
          className="btn-primary inline-flex items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          <WhatsAppIcon />
          WhatsApp
        </a>
        <a
          href={mailtoWithSubject(selectedIntent.subject, preparedMessage)}
          className="btn-primary inline-flex items-center justify-center gap-2 rounded-full bg-gold-500 px-5 py-3 text-sm font-semibold text-white hover:bg-gold-400"
        >
          <MailIcon />
          Email
        </a>
        <a
          href={`tel:${contact.primaryPhone}`}
          className="btn-primary inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-ink-900 hover:border-ink-900"
        >
          <PhoneIcon />
          Call
        </a>
      </div>
    </form>
  );
}
