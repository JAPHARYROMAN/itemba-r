/**
 * /capabilities: how a visitor verifies the fit and prepares an enquiry.
 */
import 'server-only';
import type { SplitHeadline } from './types';

/** One capability line per operating company (kept from the origin/main data set). */
export const capabilityAreas = [
  {
    title: 'Energy, Fuel and Parking',
    company: 'Mwanjalisi Oil Co Ltd',
    summary: 'Petroleum retail and parking operations for fuel, lubricant, and corridor customers in Songwe Region.',
    points: [
      'Diesel, petrol, kerosene, lubricants, and UZUNGUNI PARKING YARD',
      'Retail, business fuel, and parking enquiries',
      'Strategic corridor location in Mpemba-Tunduma',
    ],
  },
  {
    title: 'Trade and Distribution',
    company: 'Westsides Company Ltd',
    summary:
      'Wholesale beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN operations for stockists, hospitality outlets, bulk buyers, and construction customers.',
    points: [
      'More than 50 stockists across Songwe Region',
      'Bars, night clubs, restaurants, and hospitality outlets in Tunduma, Mlowo, Vwawa, and other centres',
      'International bulk buyers and construction companies buying hardware and materials',
    ],
  },
  {
    title: 'Logistics and Multi-Sector Operations',
    company: 'Itemba Enterprises Co Ltd',
    summary:
      'Local logistics and cross-border transit for businesses sourcing goods into the Southern Highlands and neighbouring countries.',
    points: [
      'Dar es Salaam to Songwe, Mbeya, Rukwa, Ruvuma, and Iringa logistics',
      'Transit business to and from Zambia, DRC, Zimbabwe, and Malawi',
      'Operations aligned with the Tunduma border corridor',
    ],
  },
] as const;

export const verificationSignals = [
  {
    title: 'Group structure',
    summary: 'Three named operating companies are presented with separate profiles, sectors, services, and contact routes.',
  },
  {
    title: 'Service ownership',
    summary: 'Each service area maps back to the company most closely responsible for handling that enquiry.',
  },
  {
    title: 'Local operating base',
    summary: 'The Mpemba-Tunduma head office and Songwe Region location profile are consistent across the site.',
  },
  {
    title: 'Contact accountability',
    summary: 'Partnership, service, company, and contact pages route enquiries through the same group channels.',
  },
] as const;

export const partnerChecklist = [
  'The product, service, or operating area you need',
  'The closest Itemba Group company or division',
  'Delivery location, expected volume, or business context',
  'Preferred response method and urgency',
] as const;

export const capabilitiesPage = {
  meta: {
    title: 'Capabilities and Operating Proof',
    description:
      'A practical view of Itemba Group operating capabilities, company responsibilities, service routes, and enquiry paths across Songwe Region and the Tunduma corridor.',
    ogTitle: 'Itemba Group Capabilities and Operating Proof',
    ogDescription:
      'See how Itemba Group maps services, companies, location presence, and enquiry routing for customers, suppliers, and partners.',
  },
  hero: {
    eyebrow: 'Capability proof',
    headline: { lead: 'Verify the fit.', accent: 'Contact the right team.' } satisfies SplitHeadline,
    lede:
      "A practical guide for customers, suppliers, contractors, transport operators and partners who need to understand Itemba Group's operating coverage before sending a business enquiry.",
  },
  signals: {
    eyebrow: 'Verification signals',
    title: 'What a visitor can confirm quickly',
  },
  map: {
    eyebrow: 'Capability map',
    title: 'Services, owners, and best-fit enquiries',
    companyLabel: 'Operating company',
    enquiriesLabel: 'Common enquiries',
    action: 'Open service page',
  },
  diligence: {
    eyebrow: 'Due-diligence path',
    title: 'Prepare a stronger business enquiry',
    body:
      'Before contacting Itemba Group, a partner can use this site to confirm the correct operating area, location context, company profile and contact route.',
    actions: {
      profile: { label: 'View company profile', href: '/company-profile' },
      location: { label: 'View location profile', href: '/locations/songwe-tunduma' },
    },
  },
  route: {
    eyebrow: 'Route an enquiry',
    title: 'Ready to contact the group?',
    body:
      'Use the enquiry router to send the request to the closest business area, or continue through the partnerships page for supplier and commercial routes.',
    link: { label: 'View partnership routes', href: '/partnerships' },
  },
} as const;
