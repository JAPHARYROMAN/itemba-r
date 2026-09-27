/**
 * Where the group operates from: one location profile today (Songwe-Tunduma),
 * plus the copy of /locations and /locations/[slug].
 */
import 'server-only';
import { mediaImage, type MediaImage } from './media';
import { contentUpdatedAt } from './site';
import type { CompanySlug, ContentIcon, Faq, LinkItem, SplitHeadline, TypeVisual } from './types';

export type LocationAdvantage = {
  /** A line icon for the advantage's bento cell. */
  icon: ContentIcon;
  title: string;
  summary: string;
};

export type LocationProfile = {
  slug: string;
  title: string;
  shortTitle: string;
  eyebrow: string;
  summary: string;
  /**
   * The page hero's lede: one sentence of 110 characters or fewer, so it
   * sets in at most three lines on a phone.
   */
  lede: string;
  detail: string;
  metaDescription: string;
  visual: 'corridor' | 'operations' | 'logistics';
  /**
   * The location's photograph (Place JSON-LD and the /locations hero). Its
   * `caption` is the photograph's title; the author, source and licence
   * come from the media registry and are rendered beside it.
   */
  image?: MediaImage;
  /**
   * The page hero's visual. There is no photograph of the head office
   * itself (flags.stateHqIsItembaMpemba), so it is typographic: a line icon
   * and one strong sentence.
   */
  heroPanel: TypeVisual;
  /** "At a glance", straight under the hero. */
  facts: ReadonlyArray<{ label: string; value: string }>;
  addressLines: string[];
  searchTerms: string[];
  advantages: LocationAdvantage[];
  /** The photograph beside the lead advantage (border corridor access). */
  advantagesImage?: MediaImage;
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
    lede: 'Home to the group head office and the Itemba sites, on the Tanzania–Zambia border at Tunduma.',
    detail:
      'The group location places its companies close to regional customers, transport movement, construction demand, and the Tanzania–Zambia border corridor. This position supports both local business activity and cross-border commercial enquiries.',
    metaDescription:
      'Itemba Group location in Mpemba-Tunduma, Songwe Region, Tanzania, serving fuel, trade, logistics, construction supply, hospitality, and real estate enquiries.',
    visual: 'corridor',
    image: mediaImage('songwe-landscape', {
      alt: 'Fields and mountains in Songwe Region, Tanzania',
      caption: 'Songwe Region landscape',
    }),
    heroPanel: {
      kind: 'type',
      icon: 'map-pin',
      statement: 'Where the Dar es Salaam supply line meets the Zambia border.',
      caption: 'Mpemba · Tunduma · Songwe Region',
    },
    facts: [
      { label: 'Head office', value: 'Itemba Filling Station, Mpemba' },
      { label: 'Region', value: 'Songwe Region, Tanzania' },
      { label: 'Border', value: 'Tanzania–Zambia, the Tunduma corridor' },
      { label: 'Reach', value: 'Southern Highlands · Zambia · DRC · Zimbabwe · Malawi' },
      { label: 'Companies', value: 'Mwanjalisi Oil · Westsides · Itemba Enterprises' },
      { label: 'Sectors', value: 'Fuel · trade · logistics · construction · hospitality · property' },
    ],
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
        icon: 'globe',
        title: 'Border corridor access',
        summary:
          'The Tunduma area connects local businesses with cross-border trade movement between Tanzania, Zambia, and wider regional markets.',
      },
      {
        icon: 'trade',
        title: 'Multi-sector coverage',
        summary:
          'One group location supports enquiries across fuel, wholesale supply, logistics, hardware, hospitality, parking, and property services.',
      },
      {
        icon: 'map-pin',
        title: 'Local operating presence',
        summary:
          'The Mpemba-Tunduma headquarters gives customers and partners a clear regional point of contact for Itemba Group companies.',
      },
    ],
    advantagesImage: mediaImage('parking-truck-line'),
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
export const locationAreaServed = ['Songwe Region', 'Tunduma', 'Mpemba', 'Tanzania–Zambia corridor'] as const;

/** The six services of a location, as cards (index and profile). */
export const locationServicesCopy = {
  /** Before the company that runs the service: "Run by Mwanjalisi Oil". */
  runBy: 'Run by',
  action: 'Learn more',
} as const;

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
    lede: 'Itemba Group is headquartered in Mpemba-Tunduma, Songwe Region, on the Tanzania–Zambia corridor.',
  },
  headquarters: {
    eyebrow: 'Headquarters',
    action: 'View location profile',
    addressLabel: 'Group head office',
    companiesLabel: 'Companies based here',
  },
  servicesHeading: 'Services connected to this location',
  servicesLede: 'Six sectors and three companies, with one group office in Mpemba-Tunduma routing every enquiry.',
  closing: {
    title: 'Talk to the group office.',
    body: 'Suppliers, bulk buyers, fuel and logistics customers: one office in Mpemba-Tunduma routes every enquiry to the right company.',
    enquire: { label: 'Start an enquiry', href: '/contact' } satisfies LinkItem,
    whatsapp: 'WhatsApp',
    call: 'Call',
  },
} as const;

/** /locations/[slug] copy. */
export const locationPageCopy = {
  hero: {
    /** The pill: down to the form. Not "Enquire", which the global nav's pill (to /contact) already says. */
    enquire: 'Ask about this location',
  },
  glanceTitle: 'At a glance',
  visit: {
    eyebrow: 'Find us',
    title: 'The group head office',
    addressHeading: 'Address',
  },
  mapTitle: 'Itemba Group Songwe-Tunduma location map',
  whyHeading: 'Why this location matters',
  routing: {
    title: 'One group office routes every enquiry.',
    body: 'Fuel, trade, logistics, hospitality or property: the head office in Mpemba-Tunduma sends it to the right company.',
    action: 'Ask about this location',
  },
  servicesHeading: 'Services available through this location',
  companiesHeading: 'Operating companies',
  companiesLede: 'Three legally independent companies of Itemba Group, and one group office for every enquiry.',
  companiesAction: 'Learn more',
  faqHeading: 'Location questions',
  enquire: {
    eyebrow: 'Enquire',
    body: 'One group office routes every enquiry to the right company.',
    stepsLabel: 'How it works',
    steps: [
      { title: 'Choose who it is for', body: 'The form starts with General. Pick a company if you already know which one you need.' },
      { title: 'Say how to reach you', body: 'A phone number, email or WhatsApp number, and a short message.' },
      { title: 'The group office routes it', body: 'Your enquiry reaches the right company team through one front door.' },
    ],
  },
} as const;
