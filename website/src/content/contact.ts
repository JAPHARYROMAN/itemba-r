/**
 * The ONE place contact literals live (phone numbers, email, WhatsApp number,
 * addresses). tests/unit/content-rules.test.ts ("contact literals live only in
 * src/content/contact.ts") fails if any other
 * file under src/ spells them out. Client-safe: EnquiryRouter and the quick
 * contact bar import this module directly.
 */

export const defaultWhatsappMessage = 'Hello Itemba Group, I would like to make a business enquiry.';

const email = 'info@itembagrouptz.com';
const primaryPhone = '+255758793511';
const secondaryPhone = '+255745215047';

/** `https://wa.me/<number>?text=<message>` for the primary line. */
export function whatsappWithMessage(message: string) {
  return `https://wa.me/${primaryPhone.replace('+', '')}?text=${encodeURIComponent(message)}`;
}

export const contact = {
  email,
  /** E.164 */
  primaryPhone,
  /** E.164 */
  secondaryPhone,
  primaryPhoneDisplay: '+255 758 793 511',
  secondaryPhoneDisplay: '+255 745 215 047',
  /** Prepared general-enquiry WhatsApp link. */
  whatsapp: whatsappWithMessage(defaultWhatsappMessage),
  headOffice: 'Itemba Filling Station, Along Tunduma-Ileje Highway, Mpemba, Tunduma',
  postal: 'P.O. Box 132, Tunduma-Songwe, Tanzania',
  mapQuery: 'Itemba Filling Station Mpemba Tunduma Tanzania',
  /** Structured head-office address (schema.org PostalAddress parts). */
  address: {
    street: 'Itemba Filling Station, Along Tunduma-Ileje Highway, Mpemba',
    locality: 'Tunduma',
    region: 'Songwe',
    regionName: 'Songwe Region',
    country: 'Tanzania',
    countryCode: 'TZ',
    postOfficeBox: '132',
  },
  /** Head office as display lines (contact page). */
  headOfficeLines: ['Itemba Filling Station', 'Along Tunduma–Ileje Highway', 'Mpemba, Tunduma'],
  /** Postal address as display lines (contact page). */
  postalLines: ['P.O. Box 132', 'Tunduma–Songwe', 'Tanzania'],
  /** Postal address, short form (footer). */
  postalShort: 'P.O. Box 132, Tunduma-Songwe',
  /** Countries the contact point serves (ISO 3166-1 alpha-2). */
  areaServed: ['TZ', 'ZM'],
  availableLanguages: ['English', 'Swahili'],
} as const;

export type ContactKind = 'tel' | 'mailto' | 'whatsapp';

/** `tel:` link (E.164), the form ConversionTracker classifies as phone_click. */
export function telHref(phone: string = contact.primaryPhone) {
  return `tel:${phone}`;
}

/**
 * `mailto:` link to the group inbox. Query values use encodeURIComponent, so
 * spaces are `%20` (RFC 6068); URLSearchParams' `+` shows up literally in
 * several mail clients.
 */
export function mailtoWithSubject(subject: string, body?: string) {
  const query = [`subject=${encodeURIComponent(subject)}`];
  if (body) {
    query.push(`body=${encodeURIComponent(body)}`);
  }

  return `mailto:${contact.email}?${query.join('&')}`;
}

/** Plain `mailto:` link to the group inbox. */
export function mailtoHref(address: string = contact.email) {
  return `mailto:${address}`;
}

/** Google Maps search URL for the head office (directions link, always visible). */
export function mapsDirectionsUrl() {
  return `https://www.google.com/maps?q=${encodeURIComponent(contact.mapQuery)}`;
}

/** Google Maps embed URL for the head office (iframe inside the map facade). */
export function mapsEmbedUrl() {
  return `${mapsDirectionsUrl()}&output=embed`;
}

/** Accessible names of the contact actions (footer, quick contact bar, enquiry actions). */
export const contactActionLabels = {
  call: 'Call Itemba Group',
  whatsapp: 'Send Itemba Group a WhatsApp message',
  whatsappFooter: 'Message Itemba Group on WhatsApp',
  email: 'Email Itemba Group',
} as const;

/**
 * The head office map (the zero-JS map facade and the directions link):
 * its label, the facade's controls and the new-tab note.
 */
export const mapCopy = {
  /** The facade's label: the town and region, as a map labels them (the page gives the street address). */
  place: 'Mpemba, Tunduma',
  area: 'Songwe Region, on the Tanzania–Zambia border',
  show: 'Show map',
  hide: 'Hide map',
  /** Under "Show map": nothing loads from Google until the map is opened. */
  note: 'Opens an embedded Google Map.',
  directions: 'Get directions',
  /** Screen-reader note on links that open a new tab. */
  newTab: '(opens in a new tab)',
} as const;
