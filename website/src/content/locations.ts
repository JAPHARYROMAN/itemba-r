/**
 * Where the group operates from: one location profile today (Songwe-Tunduma).
 */
import 'server-only';
import { mediaImage, type MediaImage } from './media';
import { contentUpdatedAt } from './site';
import type { CompanySlug, Faq, SplitHeadline } from './types';

export type LocationProfile = {
  slug: string;
  title: string;
  shortTitle: string;
  eyebrow: string;
  summary: string;
  detail: string;
  metaDescription: string;
  visual: 'corridor' | 'operations' | 'logistics';
  image?: MediaImage;
  addressLines: string[];
  searchTerms: string[];
  advantages: Array<{ title: string; summary: string }>;
  serviceSlugs: string[];
  companySlugs: CompanySlug[];
  faqs: Faq[];
  updatedAt: string;
};

export const locationProfiles: LocationProfile[] = [
  {
    slug: 'songwe-tunduma',
    title: 'Songwe Region and Tunduma Corridor',
    shortTitle: 'Songwe-Tunduma',
    eyebrow: 'Mpemba, Tunduma, Tanzania',
    summary:
      'Itemba Group is headquartered in Mpemba-Tunduma, Songwe Region, a practical operating base for fuel, trade, logistics, construction supply, hospitality, and property services.',
    detail:
      'The group location places its companies close to regional customers, transport movement, construction demand, and the Tanzania-Zambia border corridor. This position supports both local business activity and cross-border commercial enquiries.',
    metaDescription:
      'Itemba Group location in Mpemba-Tunduma, Songwe Region, Tanzania, serving fuel, trade, logistics, construction supply, hospitality, and real estate enquiries.',
    visual: 'corridor',
    image: mediaImage('songwe-landscape', {
      alt: 'Fields and mountains in Songwe Region, Tanzania',
      caption: 'Songwe Region landscape, Richard grivas / Wikimedia Commons, CC BY-SA 4.0.',
    }),
    addressLines: ['Itemba Filling Station', 'Along Tunduma-Ileje Highway', 'Mpemba, Tunduma', 'Songwe Region, Tanzania'],
    searchTerms: [
      'Itemba Group Tunduma',
      'Songwe Region business group',
      'Mpemba Tunduma fuel and logistics',
      'Tanzania Zambia corridor services',
      'Tunduma trade and construction supplies',
    ],
    advantages: [
      {
        title: 'Border Corridor Access',
        summary:
          'The Tunduma area connects local businesses with cross-border trade movement between Tanzania, Zambia, and wider regional markets.',
      },
      {
        title: 'Multi-Sector Coverage',
        summary:
          'One group location supports enquiries across fuel, wholesale supply, logistics, hardware, hospitality, parking, and property services.',
      },
      {
        title: 'Local Operating Presence',
        summary:
          'The Mpemba-Tunduma headquarters gives customers and partners a clear regional point of contact for Itemba Group companies.',
      },
    ],
    serviceSlugs: [
      'fuel-and-lubricants',
      'trade-and-distribution',
      'logistics-and-cross-border-transit',
      'construction-supplies-and-hardware',
      'hospitality-and-lodging',
      'real-estate-and-property',
    ],
    companySlugs: ['mwanjalisi-oil', 'westsides-company', 'itemba-enterprises'],
    faqs: [
      {
        question: 'Where is Itemba Group located?',
        answer:
          'Itemba Group is headquartered at Itemba Filling Station along the Tunduma-Ileje Highway in Mpemba, Tunduma, Songwe Region, Tanzania.',
      },
      {
        question: 'Why is Tunduma important for Itemba Group operations?',
        answer:
          'Tunduma is a strategic border corridor area that supports regional trade, transport movement, logistics, and customer access for the group companies.',
      },
      {
        question: 'Which services are available from the Songwe-Tunduma location?',
        answer:
          'The group supports enquiries across fuel, trade distribution, logistics, construction supplies, hospitality, real estate, and related services.',
      },
    ],
    updatedAt: contentUpdatedAt,
  },
];

export function getLocationBySlug(slug: string): LocationProfile | undefined {
  return locationProfiles.find((location) => location.slug === slug);
}

/** Places the location's LocalBusiness serves (JSON-LD). */
export const locationAreaServed = ['Songwe Region', 'Tunduma', 'Mpemba', 'Tanzania-Zambia corridor'] as const;

/** /locations index copy. */
export const locationsPage = {
  meta: {
    title: 'Locations',
    description:
      'Find Itemba Group in Mpemba-Tunduma, Songwe Region, Tanzania, and explore services connected to the Tunduma trade corridor.',
    ogTitle: 'Itemba Group Locations',
    ogDescription:
      'Itemba Group headquarters and operating presence in Mpemba-Tunduma, Songwe Region, Tanzania.',
  },
  hero: {
    eyebrow: 'Local presence',
    headline: { lead: 'Based in Songwe.', accent: 'Connected through Tunduma.' } satisfies SplitHeadline,
    fallbackVisualLabel: 'Songwe and Tunduma corridor',
  },
  headquarters: {
    eyebrow: 'Headquarters',
    action: 'View location profile',
  },
  servicesHeading: 'Services connected to this location',
} as const;

/** /locations/[slug] copy. */
export const locationPageCopy = {
  backLink: 'All locations',
  whyHeading: 'Why this location matters',
  servicesHeading: 'Services available through this location',
  faqHeading: 'Location questions',
  mapTitle: 'Itemba Group Songwe-Tunduma location map',
  addressHeading: 'Address',
  companiesHeading: 'Operating companies',
} as const;
