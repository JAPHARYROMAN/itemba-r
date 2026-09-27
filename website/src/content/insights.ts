/**
 * Insights: practical guides for customers, suppliers and partners.
 * Dates are ISO (YYYY-MM-DD); the article page shows them and JSON-LD publishes them.
 */
import 'server-only';
import { mediaImage, type MediaImage } from './media';
import type { CompanySlug, SplitHeadline, TypeVisual } from './types';

/**
 * The company line-up in an article's lead frame: one sentence over the
 * companies the article names, each with its accent dot and what it does.
 */
export type LineupVisual = {
  kind: 'lineup';
  /** Two short sentences, set in two tones on two lines. */
  statement: SplitHeadline;
};

/**
 * An article's lead visual, under its header (owner decision: the best
 * photographs, sparingly):
 * - a strong photograph, with a caption;
 * - where none exists, a typographic panel (a line icon and one strong
 *   sentence) or the company line-up.
 */
export type InsightLead = MediaImage | TypeVisual | LineupVisual;

/** True when the lead is a photograph (a registry image). */
export function isLeadPhoto(lead: InsightLead): lead is MediaImage {
  return !('kind' in lead);
}

export type InsightArticle = {
  slug: string;
  /** The article's title as published: the page title and metadata (a baseline contract). */
  title: string;
  /** The same title in the site's sentence case, for cards and headings. */
  displayTitle: string;
  eyebrow: string;
  summary: string;
  metaDescription: string;
  keywords: string[];
  publishedAt: string;
  updatedAt: string;
  readingTime: string;
  audience: string[];
  serviceSlugs: string[];
  companySlugs: CompanySlug[];
  locationSlugs: string[];
  /** The visual under the article's header (and on its featured card on /insights). */
  lead: InsightLead;
  sections: Array<{
    heading: string;
    body: string;
    points?: string[];
  }>;
  /**
   * The next step after reading. A general enquiry lands on the article's
   * own form (`#enquire`); partnership and profile routes keep their pages.
   */
  cta: {
    label: string;
    href: string;
  };
};

export const insightArticles: InsightArticle[] = [
  {
    slug: 'route-business-enquiry-itemba-group',
    title: 'How to Route a Business Enquiry to Itemba Group',
    displayTitle: 'How to route a business enquiry to Itemba Group',
    eyebrow: 'Business enquiries',
    summary:
      'A practical guide to choosing the right Itemba Group contact route for fuel, trade, logistics, construction supply, hospitality, property, and partnership enquiries.',
    metaDescription:
      'Learn how to route a business enquiry to Itemba Group companies and divisions across fuel, trade, logistics, construction supply, hospitality, and property services.',
    keywords: ['Itemba Group enquiry', 'business enquiry Tanzania', 'Songwe business services', 'Tunduma services'],
    publishedAt: '2026-05-14',
    updatedAt: '2026-05-14',
    readingTime: '4 min read',
    audience: ['Customers', 'Suppliers', 'Contractors', 'Transport operators'],
    serviceSlugs: ['fuel-and-lubricants', 'trade-and-distribution', 'logistics-and-cross-border-transit'],
    companySlugs: ['mwanjalisi-oil', 'westsides-company', 'itemba-enterprises'],
    locationSlugs: ['songwe-tunduma'],
    lead: {
      kind: 'type',
      icon: 'arrow-up-right',
      statement: 'One group office routes every enquiry to the right company.',
      caption: 'By phone, WhatsApp, email or the enquiry form.',
    },
    sections: [
      {
        heading: 'Start with the business need',
        body:
          'The fastest route is to identify the operating area first. Fuel and lubricants, trade distribution, logistics, hardware, hospitality, and property enquiries each point to different teams within the group.',
        points: [
          'Fuel, lubricant, and UZUNGUNI PARKING YARD enquiries usually align with Mwanjalisi Oil Co Ltd.',
          'Stockist, bar, night club, beverage, ITEMBA-HARDWARE, UZUNGUNI INN, construction goods, tools, and electrical supply enquiries usually align with Westsides Company Ltd.',
          'Dar es Salaam-to-Southern Highlands logistics and cross-border transit enquiries usually align with Itemba Enterprises Co Ltd.',
        ],
      },
      {
        heading: 'Use the service pages as the routing map',
        body:
          'Each service page explains the offer, the likely audience, and the operating company connected to that area. This helps a visitor prepare a focused message before contacting the group office.',
      },
      {
        heading: 'Send enough context for internal routing',
        body:
          'A good enquiry should include the service area, the company or division you think is relevant, the location or delivery context, and the preferred contact method.',
        points: [
          'For urgent requests, use phone or WhatsApp.',
          'For detailed commercial requests, include the scope, timing, and contact details in the enquiry form or email.',
          'For multi-sector requests, use the partnerships page so the group office can route it internally.',
        ],
      },
    ],
    cta: {
      label: 'Route an enquiry',
      href: '#enquire',
    },
  },
  {
    slug: 'tunduma-corridor-fuel-trade-logistics',
    title: 'Why the Tunduma Corridor Matters for Fuel, Trade, and Logistics',
    displayTitle: 'Why the Tunduma corridor matters for fuel, trade and logistics',
    eyebrow: 'Location advantage',
    summary:
      "How Itemba Group's location in Mpemba-Tunduma supports regional fuel, distribution, logistics, and cross-border business enquiries.",
    metaDescription:
      'Understand why Itemba Group location in Mpemba-Tunduma, Songwe Region, matters for fuel, trade distribution, logistics, and cross-border transit enquiries.',
    keywords: ['Tunduma corridor', 'Songwe logistics', 'Tanzania Zambia corridor', 'Mpemba Tunduma business'],
    publishedAt: '2026-05-14',
    updatedAt: '2026-05-14',
    readingTime: '4 min read',
    audience: ['Transport operators', 'Regional traders', 'Fleet customers', 'Suppliers'],
    serviceSlugs: ['fuel-and-lubricants', 'logistics-and-cross-border-transit', 'trade-and-distribution'],
    companySlugs: ['mwanjalisi-oil', 'westsides-company', 'itemba-enterprises'],
    locationSlugs: ['songwe-tunduma'],
    lead: mediaImage('parking-truck-line', {
      caption: 'UZUNGUNI PARKING YARD in Mpemba-Tunduma, run by Mwanjalisi Oil.',
    }),
    sections: [
      {
        heading: 'A practical operating base',
        body:
          'Itemba Group is headquartered at Itemba Filling Station along the Tunduma-Ileje Highway in Mpemba, Tunduma. This gives the group a clear regional point of contact for customers and partners in Songwe Region.',
      },
      {
        heading: 'Useful for multiple service lines',
        body:
          'The same location context supports fuel customers, regional trade, construction supply demand, logistics enquiries, hospitality customers, and property-related services.',
        points: [
          'Fuel enquiries connect to corridor movement and transport activity.',
          'Trade and construction supply enquiries connect to Songwe stockists, bars, night clubs, cross-border bulk buyers, and the real estate construction market.',
          'Logistics and transit enquiries connect Dar es Salaam sourcing routes to the Southern Highlands and neighbouring countries.',
        ],
      },
      {
        heading: 'What to confirm before contacting',
        body:
          'Customers should mention the origin, destination, preferred timing, product or service category, and whether the enquiry is local, regional, or cross-border.',
      },
    ],
    cta: {
      label: 'View location profile',
      href: '/locations/songwe-tunduma',
    },
  },
  {
    slug: 'choose-right-itemba-company',
    title: 'Choosing the Right Itemba Group Company for Your Enquiry',
    displayTitle: 'Choosing the right Itemba Group company for your enquiry',
    eyebrow: 'Company guide',
    summary:
      'A simple guide to Mwanjalisi Oil Co Ltd, Westsides Company Ltd, and Itemba Enterprises Co Ltd so visitors can contact the right operating team.',
    metaDescription:
      'Compare Itemba Group companies and learn which operating company fits fuel, trade distribution, logistics, hardware, hospitality, real estate, and parking enquiries.',
    keywords: ['Itemba Group companies', 'Mwanjalisi Oil', 'Westsides Company', 'Itemba Enterprises'],
    publishedAt: '2026-05-14',
    updatedAt: '2026-05-14',
    readingTime: '5 min read',
    audience: ['Business customers', 'Partners', 'Suppliers', 'Local service customers'],
    serviceSlugs: [
      'fuel-and-lubricants',
      'trade-and-distribution',
      'construction-supplies-and-hardware',
      'hospitality-and-lodging',
      'real-estate-and-property',
    ],
    companySlugs: ['mwanjalisi-oil', 'westsides-company', 'itemba-enterprises'],
    locationSlugs: ['songwe-tunduma'],
    lead: {
      kind: 'lineup',
      statement: { lead: 'Three companies.', accent: 'One group office.' },
    },
    sections: [
      {
        heading: 'Mwanjalisi Oil Co Ltd',
        body:
          'Mwanjalisi Oil is the petroleum retail and parking arm of Itemba Group, serving fuel, diesel, petrol, kerosene, lubricants, UZUNGUNI PARKING YARD, and business fuel enquiries.',
      },
      {
        heading: 'Westsides Company Ltd',
        body:
          'Westsides Company handles wholesale beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN for more than 50 Songwe stockists, bars and night clubs, international bulk buyers, and construction companies serving the growing real estate market.',
      },
      {
        heading: 'Itemba Enterprises Co Ltd',
        body:
          'Itemba Enterprises covers local logistics, cross-border transit, and emerging businesses. Its logistics market includes customers sourcing goods from Dar es Salaam to the Southern Highlands and transit customers moving to and from Zambia, DRC, Zimbabwe, and Malawi. ITEMBA-HARDWARE and UZUNGUNI INN are managed under Westsides Company Ltd, while UZUNGUNI PARKING YARD is managed under Mwanjalisi Oil Co Ltd.',
      },
      {
        heading: 'If the enquiry spans more than one company',
        body:
          'Use the general business enquiry or partnerships route. The group office can review the enquiry type and route it to the most relevant company or division.',
      },
    ],
    cta: {
      label: 'Compare capabilities',
      href: '/capabilities',
    },
  },
  {
    slug: 'supplier-bulk-purchase-enquiries',
    title: 'What Suppliers and Bulk Buyers Should Prepare Before Contacting Itemba Group',
    displayTitle: 'What suppliers and bulk buyers should prepare before contacting Itemba Group',
    eyebrow: 'Partnership readiness',
    summary:
      'A checklist for supplier introductions, bulk purchase requests, construction supply enquiries, hospitality customers, and commercial partners.',
    metaDescription:
      'Prepare supplier introductions and bulk purchase enquiries for Itemba Group with the right product, volume, delivery, company, and contact details.',
    keywords: ['supplier enquiry Tanzania', 'bulk purchase Songwe', 'construction supply enquiry', 'Itemba partnerships'],
    publishedAt: '2026-05-14',
    updatedAt: '2026-05-14',
    readingTime: '4 min read',
    audience: ['Suppliers', 'Bulk buyers', 'Contractors', 'Hospitality businesses'],
    serviceSlugs: ['trade-and-distribution', 'construction-supplies-and-hardware', 'hospitality-and-lodging'],
    companySlugs: ['westsides-company', 'itemba-enterprises'],
    locationSlugs: ['songwe-tunduma'],
    lead: {
      kind: 'type',
      icon: 'document',
      statement: 'Five details route a supplier or bulk enquiry.',
      caption: 'Product · Volume · Delivery · Timing · Contact',
    },
    sections: [
      {
        heading: 'Prepare the commercial basics',
        body:
          'A clear enquiry should include product category, expected volume, delivery or pickup context, timing, and the business contact person.',
        points: [
          'For supplier introductions, include product categories and supply coverage.',
          'For stockist or bulk purchase requests, include quantities, timing, preferred fulfilment location, and distribution area.',
          'For construction supply enquiries, mention the project type, such as filling stations, residential homes, commercial properties, or public infrastructure.',
        ],
      },
      {
        heading: 'Choose the closest route',
        body:
          'Westsides Company is usually the closest match for stockists, bars, night clubs, beverage, ITEMBA-HARDWARE, UZUNGUNI INN, construction goods, tools, and electrical supply enquiries. Mwanjalisi Oil is the closest match for fuel and UZUNGUNI PARKING YARD enquiries, while Itemba Enterprises is the route for Dar es Salaam-to-Southern Highlands logistics and cross-border transit opportunities.',
      },
      {
        heading: 'Use partnerships for multi-sector opportunities',
        body:
          'If an opportunity touches multiple services or companies, the partnerships page is the best starting point because it is designed for internal routing.',
      },
    ],
    cta: {
      label: 'Open partnerships page',
      href: '/partnerships',
    },
  },
];

export function getInsightBySlug(slug: string): InsightArticle | undefined {
  return insightArticles.find((article) => article.slug === slug);
}

/** /insights index copy. */
export const insightsPage = {
  meta: {
    title: 'Insights',
    description:
      'Practical Itemba Group articles for business enquiries, supplier introductions, location context, service routing, and company selection in Songwe Region, Tanzania.',
    ogTitle: 'Itemba Group Insights',
    ogDescription:
      'Guides for customers, suppliers, contractors, transport operators, and partners working with Itemba Group companies.',
  },
  hero: {
    eyebrow: 'Insights',
    headline: { lead: 'Practical guides for', accent: 'business enquiries.' } satisfies SplitHeadline,
    lede:
      'Focused articles for customers, suppliers, contractors, transport operators and partners who need to choose the right Itemba Group service route.',
  },
  featured: {
    eyebrow: 'Featured guide',
    action: 'Read guide',
  },
  more: {
    eyebrow: 'More articles',
    title: 'Guides by need',
    action: 'Read article',
  },
  directRoute: {
    title: 'Need a direct route?',
    body: 'Use the capability map or partnerships page when your enquiry spans more than one company, service or operating division.',
    links: [
      { label: 'Capability map', href: '/capabilities' },
      { label: 'Partnerships', href: '/partnerships' },
      { label: 'Logistics guide', href: '/services/logistics-and-cross-border-transit' },
    ],
  },
} as const;

/** /insights/[slug] copy. */
export const insightPageCopy = {
  backLink: 'All insights',
  /** The article's dates and reading time, under its headline. */
  meta: {
    updated: 'Updated',
    audience: 'Written for',
  },
  relatedServices: 'Related services',
  relatedCompanies: 'Related companies',
  relatedLocation: 'Related location',
  continueCta: {
    title: 'Continue from this guide',
    body: 'Use the next route that best matches the business need, or open the full insights hub for more practical guidance.',
    moreLabel: 'More insights',
  },
} as const;

/**
 * The enquiry section on an insight article and on /faq: the group's
 * routing promise and how an enquiry travels, beside the compact form
 * (which starts on General there).
 */
export const routedEnquiryCopy = {
  eyebrow: 'Enquire',
  body: 'One group office routes every enquiry to the right company.',
  stepsLabel: 'How it works',
  steps: [
    { title: 'Choose who it is for', body: 'The form starts with General. Pick a company if you already know which one.' },
    { title: 'Say how to reach you', body: 'A phone number, email or WhatsApp number, and a short message.' },
    { title: 'The group office routes it', body: 'Your enquiry reaches the right company team through one front door.' },
  ],
} as const;
