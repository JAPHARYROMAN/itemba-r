/**
 * Enquiry intents, direct contact copy and retained submission-helper strings. Client-safe: the EnquiryRouter
 * island imports this module directly, and the frozen POST /api/enquiries
 * handler reads `enquiryIntents` through the @/lib/site barrel.
 *
 * `enquiryIntents` is a non-empty tuple, so `enquiryIntents[0]` is always an
 * intent (the frozen route falls back to it).
 */
import type { IntentId } from './types';

export type EnquiryIntent = {
  id: IntentId;
  label: string;
  shortLabel: string;
  /** The company label in the intent selector. */
  segmentLabel: string;
  subject: string;
  routeTo: string;
  summary: string;
};

export const enquiryIntents: readonly [EnquiryIntent, ...EnquiryIntent[]] = [
  {
    id: 'general',
    label: 'General business enquiry',
    shortLabel: 'General',
    segmentLabel: 'General',
    subject: 'General business enquiry',
    routeTo: 'Itemba Group office',
    summary: 'Partnerships, group information, supplier introductions, and other business matters.',
  },
  {
    id: 'mwanjalisi',
    label: 'Fuel and petroleum supply',
    shortLabel: 'Fuel',
    segmentLabel: 'Mwanjalisi Oil',
    subject: 'Mwanjalisi Oil fuel supply enquiry',
    routeTo: 'Mwanjalisi Oil Co Ltd',
    summary: 'Diesel, petrol, kerosene, lubricants, UZUNGUNI PARKING YARD, and business fuel supply enquiries.',
  },
  {
    id: 'westsides',
    label: 'Trade and distribution',
    shortLabel: 'Trade',
    segmentLabel: 'Westsides',
    subject: 'Westsides Company trade supply enquiry',
    routeTo: 'Westsides Company Ltd',
    summary: 'Stockists, bars, night clubs, beverages, building materials, tools, electrical supplies, and bulk purchase enquiries.',
  },
  {
    id: 'enterprises',
    label: 'Logistics and operations',
    shortLabel: 'Logistics',
    segmentLabel: 'Itemba Enterprises',
    subject: 'Itemba Enterprises operations enquiry',
    routeTo: 'Itemba Enterprises Co Ltd',
    summary: 'Dar es Salaam-to-Southern Highlands logistics, cross-border transit, and property enquiries through Itemba Estate.',
  },
];

export const defaultIntentId: IntentId = 'general';

export function findIntent(id: string | undefined): EnquiryIntent {
  return enquiryIntents.find((intent) => intent.id === id) ?? enquiryIntents[0];
}

/** Subject for the generic "email us" links (footer, quick contact, contact page). */
export const businessEnquirySubject = 'Business enquiry';

/** Direct-contact copy plus retained strings for the frozen submission helper. */
export const enquiryFormCopy = {
  eyebrow: 'Business enquiry',
  title: 'Contact the group office',
  description: 'Choose an enquiry type, then contact the group office by WhatsApp, email or phone.',
  directLead: 'The links open your own app. Send the message or make the call there.',
  intentLegend: 'Enquiry type',
  routedToPrefix: 'Enquiry for',
  /** Appended to the labels of the fields a visitor may leave empty. */
  optional: 'optional',
  fields: {
    name: { label: 'Name', placeholder: 'Your name' },
    organization: { label: 'Organisation', placeholder: 'Company or organisation' },
    contactMethod: {
      label: 'Preferred contact',
      placeholder: 'Phone, email, or WhatsApp number',
      /** Under the field when it is left blank. */
      error: 'Add a phone number, email or WhatsApp number.',
    },
    message: {
      label: 'Message',
      placeholder: 'Briefly describe what you need',
      error: 'Add a short message.',
    },
  },
  submit: 'Submit enquiry',
  submitting: 'Submitting enquiry...',
  actions: {
    whatsapp: 'WhatsApp',
    email: 'Email',
    call: 'Call',
  },
  /** Retained for callers that present the direct contact channels. */
  fallbackLead: 'Contact the group office directly.',
  messages: {
    required: 'Preferred contact and message are required.',
    failed: 'The enquiry could not be submitted.',
    sentAndEmailed: 'Enquiry submitted and emailed to the team.',
    sentAndStored: 'Enquiry submitted and saved. Use WhatsApp for urgent follow-up.',
    sent: 'Enquiry submitted. Use WhatsApp for urgent follow-up.',
  },
  noScript:
    'You can contact the group office by WhatsApp, email or phone without JavaScript.',
  /** Lines of the prepared WhatsApp/email message. */
  preparedMessage: {
    greeting: 'Hello Itemba Group,',
    intent: 'Enquiry type',
    routeTo: 'Please route to',
    name: 'Name',
    organization: 'Organisation',
    contactMethod: 'Preferred contact',
    message: 'Message:',
    closing: 'Thank you.',
  },
} as const;

/** Shared steps for direct-contact cards; the website does not collect a message. */
export const directEnquirySteps = [
  { title: 'Choose the enquiry type', body: 'The company selection adds context to your WhatsApp message or email.' },
  { title: 'Choose WhatsApp, email or phone', body: 'Open your preferred app to send the message or make a call.' },
  { title: 'Tell us what you need', body: 'Include your request, location, timing and how the group office can reach you.' },
] as const;

/** Per-page title and description for the direct contact card. */
export const enquiryPrompts = {
  capabilities: {
    title: 'Route a capability enquiry',
    description: 'Choose the operating area you need, then contact the group office by WhatsApp, email or phone.',
  },
  company: {
    description:
      'Contact the group office by WhatsApp, email or phone about this operating company.',
  },
  companyProfile: {
    title: 'Contact the group office',
    description: 'Select the relevant operating area, then contact the group office by WhatsApp, email or phone.',
  },
  faq: {
    title: 'Still need help?',
    description: 'Choose an enquiry type, then ask the group office by WhatsApp, email or phone.',
  },
  insightArticle: {
    title: 'Ask about this topic',
    description: 'Ask the group office about this topic by WhatsApp, email or phone.',
  },
  location: {
    title: 'Ask about this location',
    description: 'Contact the group office by WhatsApp, email or phone about the Songwe-Tunduma operating base.',
  },
  partnerships: {
    title: 'Route a partnership enquiry',
    description: 'Choose the closest enquiry type, then contact the group office by WhatsApp, email or phone.',
  },
  service: {
    title: 'Start a service enquiry',
    description: 'Contact the group office by WhatsApp, email or phone about this service.',
  },
} as const;
