/**
 * The enquiry form's logic, kept apart from its markup (src/islands/EnquiryRouter.tsx)
 * so it can be tested without a browser.
 *
 * The contract with the frozen POST /api/enquiries handler and with analytics
 * is origin/main's, unchanged:
 * - the JSON body `{intentId, name, organization, contactMethod, message,
 *   sourcePath, website}` in that key order, `website` being the honeypot;
 * - the client-side check that preferred contact and message are not blank;
 * - the success copy chosen from `emailStatus` / `storageStatus`;
 * - `trackConversion('enquiry_submit', …)` with the same parameters;
 * - the prepared WhatsApp / email message, line for line (buildMessage).
 *
 * One deliberate difference: a response that is not JSON (a proxy's HTML
 * error page, an empty 502) or a network failure now shows the form's own
 * failure copy instead of a raw parser or fetch error.
 *
 * Client-safe: it imports only the enquiry content module.
 */
import { enquiryFormCopy as copy, enquiryIntents, type EnquiryIntent } from '@/content/enquiry';
import type { IntentId } from '@/content/types';

export const ENQUIRY_ENDPOINT = '/api/enquiries';

export type EnquiryFields = {
  name: string;
  organization: string;
  contactMethod: string;
  message: string;
};

/** The fields the form (and the API) require. */
export type RequiredField = 'contactMethod' | 'message';

export type EnquiryPayload = EnquiryFields & {
  intentId: IntentId;
  sourcePath: string;
  /** Honeypot: always empty for a person. */
  website: string;
};

/** What POST /api/enquiries answers (src/app/api/enquiries/route.ts). */
export type EnquiryResponse = {
  ok?: boolean;
  id?: string | null;
  error?: string;
  emailStatus?: string;
  storageStatus?: string;
};

export type EnquiryOutcome =
  | { ok: true; result: EnquiryResponse; message: string }
  | { ok: false; error: string };

/** A known intent id, or `general` (an unknown default falls back, as before). */
export function resolveIntentId(id: string | undefined): IntentId {
  const match = enquiryIntents.find((intent) => intent.id === id);
  return match ? match.id : 'general';
}

/** The intent for an id; the general intent when there is none. */
export function intentFor(id: string | undefined): EnquiryIntent {
  return enquiryIntents.find((intent) => intent.id === id) ?? enquiryIntents[0];
}

/** Required fields left blank (whitespace counts as blank), in form order. */
export function missingRequired(fields: Pick<EnquiryFields, RequiredField>): RequiredField[] {
  const missing: RequiredField[] = [];
  if (!fields.contactMethod.trim()) missing.push('contactMethod');
  if (!fields.message.trim()) missing.push('message');
  return missing;
}

/**
 * The prepared message for the WhatsApp and email fallbacks, one item per
 * line (origin/main's format).
 */
export function buildMessage({
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
}): string {
  const m = copy.preparedMessage;
  const lines: string[] = [m.greeting, '', `${m.intent}: ${intentLabel}`, `${m.routeTo}: ${routeTo}`];

  if (name.trim()) lines.push(`${m.name}: ${name.trim()}`);
  if (organization.trim()) lines.push(`${m.organization}: ${organization.trim()}`);
  if (contactMethod.trim()) lines.push(`${m.contactMethod}: ${contactMethod.trim()}`);
  if (message.trim()) {
    lines.push('', m.message, message.trim());
  }

  lines.push('', m.closing);
  return lines.join('\n');
}

/** The request body, with origin/main's key order. */
export function enquiryPayload(input: EnquiryPayload): EnquiryPayload {
  return {
    intentId: input.intentId,
    name: input.name,
    organization: input.organization,
    contactMethod: input.contactMethod,
    message: input.message,
    sourcePath: input.sourcePath,
    website: input.website,
  };
}

/** The success copy for a stored or emailed enquiry. */
export function successMessage(result: EnquiryResponse): string {
  return result.emailStatus === 'sent'
    ? copy.messages.sentAndEmailed
    : result.storageStatus === 'stored'
      ? copy.messages.sentAndStored
      : copy.messages.sent;
}

/** The `enquiry_submit` conversion parameters (origin/main's, unchanged). */
export function enquiryConversion(result: EnquiryResponse, intent: EnquiryIntent, pagePath: string) {
  return {
    enquiry_id: result.id,
    intent_id: intent.id,
    intent_label: intent.label,
    route_to: intent.routeTo,
    email_status: result.emailStatus || 'unknown',
    page_path: pagePath,
  };
}

/** The response body as an object, or null when it is not a JSON object. */
async function readResponse(response: Response): Promise<EnquiryResponse | null> {
  try {
    const data: unknown = JSON.parse(await response.text());
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as EnquiryResponse) : null;
  } catch {
    return null;
  }
}

/**
 * Sends an enquiry. Never throws: a network failure, a non-JSON body or an
 * error status becomes `{ok: false, error}`, with the server's own error text
 * when it sent one.
 */
export async function postEnquiry(payload: EnquiryPayload, fetchImpl: typeof fetch = fetch): Promise<EnquiryOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(ENQUIRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(enquiryPayload(payload)),
    });
  } catch {
    return { ok: false, error: copy.messages.failed };
  }

  const result = await readResponse(response);
  if (!response.ok || !result?.ok) {
    const serverError = typeof result?.error === 'string' && result.error.trim() ? result.error : null;
    return { ok: false, error: serverError ?? copy.messages.failed };
  }
  return { ok: true, result, message: successMessage(result) };
}
