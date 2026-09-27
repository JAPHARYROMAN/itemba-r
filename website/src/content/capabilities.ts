/**
 * /capabilities: how a visitor verifies the fit and prepares an enquiry.
 */
import 'server-only';
import { mediaImage } from './media';
import type { SplitHeadline, TypeVisual } from './types';

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

/** The four things a visitor can confirm on the site before sending an enquiry. */
export type VerificationSignalId = 'structure' | 'ownership' | 'base' | 'contact';

export type VerificationSignal = {
  id: VerificationSignalId;
  title: string;
  summary: string;
};

export const verificationSignals: readonly VerificationSignal[] = [
  {
    id: 'structure',
    title: 'Group structure',
    summary: 'Three named operating companies are presented with separate profiles, sectors, services, and contact routes.',
  },
  {
    id: 'ownership',
    title: 'Service ownership',
    summary: 'Each service area maps back to the company most closely responsible for handling that enquiry.',
  },
  {
    id: 'base',
    title: 'Local operating base',
    summary: 'The Mpemba-Tunduma head office and Songwe Region location profile are consistent across the site.',
  },
  {
    id: 'contact',
    title: 'Contact accountability',
    summary: 'Partnership, service, company, and contact pages route enquiries through the same group channels.',
  },
];

export const partnerChecklist = [
  'The product, service, or operating area you need',
  'The closest Itemba Group company or division',
  'Delivery location, expected volume, or business context',
  'Preferred response method and urgency',
] as const;

/** /capabilities copy, in page order. */
export const capabilitiesPage = {
  meta: {
    title: 'Capabilities and Operating Proof',
    description:
      'A practical view of Itemba Group operating capabilities, company responsibilities, service routes, and enquiry paths across Songwe Region and the Tunduma corridor.',
    ogTitle: 'Itemba Group Capabilities and Operating Proof',
    ogDescription:
      'See how Itemba Group maps services, companies, location presence, and enquiry routing for customers, suppliers, and partners.',
  },
  /** The page's step in the breadcrumb trail (and its BreadcrumbList). */
  crumb: { name: 'Capabilities', path: '/capabilities' },
  hero: {
    eyebrow: 'Capability proof',
    headline: { lead: 'Verify the fit.', accent: 'Contact the right team.' } satisfies SplitHeadline,
    lede:
      "A practical guide for customers, suppliers, contractors, transport operators and partners who need to understand Itemba Group's operating coverage before sending a business enquiry.",
    /** The pill: the page's own enquiry form. */
    enquire: 'Route an enquiry',
    /** The group's ready-made profile and capability statement (a download link: the verb is implied). */
    download: 'Group profile',
    downloadFormat: 'PDF',
    /** Name of the row of service shortcuts under the actions. */
    shortcutsLabel: 'Jump to a service',
  },
  signals: {
    eyebrow: 'Verification signals',
    title: 'What a visitor can confirm quickly',
    /** The label over the three companies in the group-structure cell. */
    companiesLabel: 'The operating companies',
    /** The head office, under the local-base cell. */
    headOfficeLabel: 'Head office',
    /** An in-page link to the capability map. */
    ownershipAction: 'See who runs each service',
    /** The routing steps on /partnerships. */
    contactAction: { label: 'How enquiries move', href: '/partnerships#how-enquiries-move' },
    /** The local base, as a photograph: UZUNGUNI PARKING YARD, Mpemba-Tunduma. */
    image: mediaImage('parking-truck-line'),
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
    checklistLabel: 'Have these ready',
    visual: {
      kind: 'type',
      icon: 'document',
      statement: 'The company profile is written for banks and partners.',
      caption: 'The group profile and a profile for each company, ready to download.',
    } satisfies TypeVisual,
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
    /** Over the legend of the form's enquiry types (each with what it covers). */
    optionsLabel: 'Which option to choose',
  },
} as const;
