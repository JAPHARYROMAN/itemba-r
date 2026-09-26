/**
 * Enquiry intents and the enquiry form's copy. Client-safe: the EnquiryRouter
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
  subject: string;
  routeTo: string;
  summary: string;
};

export const enquiryIntents: readonly [EnquiryIntent, ...EnquiryIntent[]] = [
  {
    id: 'general',
    label: 'General business enquiry',
    shortLabel: 'General',
    subject: 'General business enquiry',
    routeTo: 'Itemba Group office',
    summary: 'Partnerships, group information, supplier introductions, and other business matters.',
  },
  {
    id: 'mwanjalisi',
    label: 'Fuel and petroleum supply',
    shortLabel: 'Fuel',
    subject: 'Mwanjalisi Oil fuel supply enquiry',
    routeTo: 'Mwanjalisi Oil Co Ltd',
    summary: 'Diesel, petrol, kerosene, lubricants, UZUNGUNI PARKING YARD, and business fuel supply enquiries.',
  },
  {
    id: 'westsides',
    label: 'Trade and distribution',
    shortLabel: 'Trade',
    subject: 'Westsides Company trade supply enquiry',
    routeTo: 'Westsides Company Ltd',
    summary: 'Stockists, bars, night clubs, beverages, building materials, tools, electrical supplies, and bulk purchase enquiries.',
  },
  {
    id: 'enterprises',
    label: 'Logistics and operations',
    shortLabel: 'Logistics',
    subject: 'Itemba Enterprises operations enquiry',
    routeTo: 'Itemba Enterprises Co Ltd',
    summary: 'Dar es Salaam-to-Southern Highlands logistics, cross-border transit, and emerging-business enquiries.',
  },
];

export const defaultIntentId: IntentId = 'general';

export function findIntent(id: string | undefined): EnquiryIntent {
  return enquiryIntents.find((intent) => intent.id === id) ?? enquiryIntents[0];
}

/** Subject for the generic "email us" links (footer, quick contact, contact page). */
export const businessEnquirySubject = 'Business enquiry';

/** The enquiry form's fixed copy. */
export const enquiryFormCopy = {
  eyebrow: 'Business Enquiry',
  title: 'Route an enquiry',
  description: 'Choose the area that best matches your enquiry and contact the right team with a prepared message.',
  intentLegend: 'Enquiry type',
  routedToPrefix: 'Routed to',
  fields: {
    name: { label: 'Name', placeholder: 'Your name' },
    organization: { label: 'Organisation', placeholder: 'Company or organisation' },
    contactMethod: { label: 'Preferred contact', placeholder: 'Phone, email, or WhatsApp number' },
    message: { label: 'Message', placeholder: 'Briefly describe what you need' },
  },
  submit: 'Submit enquiry',
  submitting: 'Submitting enquiry...',
  actions: {
    whatsapp: 'WhatsApp',
    email: 'Email',
    call: 'Call',
  },
  messages: {
    required: 'Preferred contact and message are required.',
    failed: 'The enquiry could not be submitted.',
    sentAndEmailed: 'Enquiry submitted and emailed to the team.',
    sentAndStored: 'Enquiry submitted and saved. Use WhatsApp for urgent follow-up.',
    sent: 'Enquiry submitted. Use WhatsApp for urgent follow-up.',
  },
  noScript:
    'This form needs JavaScript. You can still reach the group office directly by WhatsApp, email or phone.',
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

/** Per-page title and description for the enquiry form (verbatim from each page). */
export const enquiryPrompts = {
  capabilities: {
    title: 'Route a capability enquiry',
    description: 'Choose the area that best matches the capability, service, or operating company you need.',
  },
  company: {
    description:
      'Contact the group office with a prepared message that can be routed to the relevant operating team.',
  },
  companyProfile: {
    title: 'Send a routed enquiry',
    description: 'Select the relevant operating area and contact the group office with a prepared message.',
  },
  faq: {
    title: 'Still need help?',
    description: 'Choose the relevant enquiry type and send a prepared message to the group office.',
  },
  insightArticle: {
    title: 'Ask about this topic',
    description: 'Route a focused enquiry to the closest Itemba Group operating area.',
  },
  location: {
    title: 'Ask about this location',
    description: 'Contact the group office for enquiries connected to the Songwe-Tunduma operating base.',
  },
  partnerships: {
    title: 'Route a partnership enquiry',
    description: 'Choose the closest enquiry type and send a prepared message to the group office.',
  },
  service: {
    title: 'Start a service enquiry',
    description: 'Choose a contact route and send a prepared message to the group office.',
  },
} as const;
