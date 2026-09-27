/**
 * Partnership routes: who each kind of partner should talk to.
 */
import 'server-only';
import type { CompanySlug, ContentIcon, IntentId, SplitHeadline, TypeVisual } from './types';

export type PartnershipArea = {
  id: string;
  title: string;
  /** A two- or three-word name for the route (the hero's shortcuts). */
  shortTitle: string;
  /** The route's line icon. */
  icon: ContentIcon;
  routeTo: string;
  /** The enquiry type to choose in the form for this route. */
  intentId: IntentId;
  summary: string;
  goodFit: string[];
  serviceSlugs: string[];
  companySlugs: CompanySlug[];
};

export const partnershipAreas: PartnershipArea[] = [
  {
    id: 'suppliers',
    title: 'Supplier and Distributor Introductions',
    shortTitle: 'Suppliers',
    icon: 'globe',
    routeTo: 'Itemba Group office',
    intentId: 'general',
    summary:
      'For suppliers, manufacturers, and distributors looking to introduce products, supply categories, or regional business opportunities.',
    goodFit: ['Beverage suppliers', 'Construction goods suppliers', 'Hardware and electrical product suppliers', 'Regional distributors'],
    serviceSlugs: ['trade-and-distribution', 'construction-supplies-and-hardware'],
    companySlugs: ['westsides-company', 'itemba-enterprises'],
  },
  {
    id: 'bulk-buyers',
    title: 'Bulk Purchase and Commercial Supply',
    shortTitle: 'Bulk buyers',
    icon: 'trade',
    routeTo: 'Westsides Company Ltd',
    intentId: 'westsides',
    summary:
      'For stockists, bars, night clubs, cross-border bulk buyers, contractors, construction companies, hospitality operators, and institutional buyers seeking beverage, construction, tool, or electrical supply support.',
    goodFit: ['Songwe stockists', 'Bars and night clubs', 'Cross-border bulk buyers', 'Construction companies', 'Hospitality businesses'],
    serviceSlugs: ['trade-and-distribution', 'construction-supplies-and-hardware'],
    companySlugs: ['westsides-company'],
  },
  {
    id: 'fuel-logistics',
    title: 'Fuel, Parking, Fleet, and Logistics Customers',
    shortTitle: 'Fuel & logistics',
    icon: 'logistics',
    routeTo: 'Mwanjalisi Oil Co Ltd and Itemba Enterprises Co Ltd',
    intentId: 'mwanjalisi',
    summary:
      'For transport operators, commercial fleets, traders, local businesses sourcing goods from Dar es Salaam, and cross-border customers that need fuel, lubricants, UZUNGUNI PARKING YARD access, local logistics, or transit support.',
    goodFit: ['Transport operators', 'Dar es Salaam sourcing customers', 'Southern Highlands businesses', 'Parking and corridor customers', 'Cross-border traders'],
    serviceSlugs: ['fuel-and-lubricants', 'logistics-and-cross-border-transit'],
    companySlugs: ['mwanjalisi-oil', 'itemba-enterprises'],
  },
  {
    id: 'property-hospitality',
    title: 'Hospitality, Parking, Property, and Local Services',
    shortTitle: 'Property & hospitality',
    icon: 'hospitality',
    routeTo: 'Mwanjalisi Oil Co Ltd, Westsides Company Ltd, and Itemba Enterprises Co Ltd',
    intentId: 'general',
    summary:
      'For enquiries connected to UZUNGUNI PARKING YARD under Mwanjalisi Oil, UZUNGUNI INN under Westsides, property, estate services, and related local business opportunities.',
    goodFit: ['Business guests', 'Property stakeholders', 'Parking and corridor customers', 'Local service partners'],
    serviceSlugs: ['hospitality-and-lodging', 'real-estate-and-property'],
    companySlugs: ['mwanjalisi-oil', 'westsides-company', 'itemba-enterprises'],
  },
];

/** /partnerships copy, in page order. */
export const partnershipsPage = {
  meta: {
    title: 'Partnerships',
    description:
      'Partnership and business enquiry routes for suppliers, bulk buyers, contractors, logistics customers, fuel customers, property, hospitality, and regional partners working with Itemba Group.',
    ogTitle: 'Partner with Itemba Group',
    ogDescription:
      'Supplier introductions, bulk purchase enquiries, fuel, logistics, construction supply, hospitality, and property opportunities with Itemba Group.',
  },
  /** The page's step in the breadcrumb trail (and its BreadcrumbList). */
  crumb: { name: 'Partnerships', path: '/partnerships' },
  hero: {
    eyebrow: 'Business development',
    headline: { lead: 'Partner with', accent: 'Itemba Group.' } satisfies SplitHeadline,
    lede:
      'A clear route for suppliers, commercial buyers, contractors, transport operators, hospitality customers, property stakeholders and regional business partners.',
    /** The pill: the page's own enquiry form. */
    enquire: 'Route an enquiry',
    link: { label: 'See capabilities', href: '/capabilities' },
    /** Name of the row of route shortcuts under the actions. */
    shortcutsLabel: 'Jump to a partnership route',
  },
  routes: {
    eyebrow: 'Partnership routes',
    title: 'Start with the right operating team',
    routedToPrefix: 'Routed to',
    goodFitLabel: 'Good fit for',
    companiesLabel: 'Companies',
    servicesLabel: 'Services',
    /** Before the enquiry type to pick in the form ("In the form, choose ● Westsides"). */
    formHint: 'In the form, choose',
    action: 'Enquire',
  },
  process: {
    eyebrow: 'How enquiries move',
    title: 'From first message to follow-up.',
    visual: {
      kind: 'type',
      icon: 'map-pin',
      statement: 'One group office routes every enquiry to the right company.',
    } satisfies TypeVisual,
    steps: [
      {
        title: 'Select the closest route',
        body: 'Suppliers, bulk buyers, fuel and logistics customers, or property and hospitality.',
      },
      {
        title: 'Send details by WhatsApp, email, or phone',
        body: 'Or submit the form on this page. Each channel carries the same prepared message.',
      },
      {
        title: 'The group office routes the enquiry internally',
        body: 'The office reviews the enquiry type and passes it to the company or division that handles it.',
      },
      {
        title: 'The relevant company or division follows up',
        body: 'Mwanjalisi Oil, Westsides or Itemba Enterprises takes it from there.',
      },
    ],
  },
  faq: {
    title: 'Partnership questions',
    body: 'Practical answers for suppliers, buyers, logistics customers and partners preparing to contact Itemba Group.',
  },
  enquire: {
    eyebrow: 'Partnership enquiry',
    title: 'Ready to talk to Itemba Group?',
    body: 'Choose the closest route and add a few details. The group office passes the enquiry to the company or division that can act on it.',
    checklistLabel: 'What to include',
  },
} as const;
