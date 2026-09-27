/**
 * Home page content, in page order. The lead lines are the group's core
 * message and are used verbatim.
 */
import 'server-only';
import { mediaImage, type MediaImage } from './media';
import type { CompanySlug, Gated, IconKey, LinkItem, SplitHeadline } from './types';

export type HomeStat = Gated & {
  value: string;
  label: string;
};

/**
 * A company's tile on home. The legal name, accent and photographs come
 * from the company itself (src/content/companies.ts), so the tile and the
 * company page never drift apart.
 */
export type HomeCompanyTile = {
  companySlug: CompanySlug;
  /** The tile's headline: the company's public short name. */
  name: string;
  /** The line under the headline: what the company does, in three words. */
  eyebrow: string;
  summary: string;
};

export type HomeSector = {
  icon: IconKey;
  name: string;
  serviceSlug: string;
  image: MediaImage;
};

export const homeHero = {
  eyebrow: 'Songwe Region · Tanzania–Zambia corridor',
  headline: { lead: 'Fuel, trade & logistics on the', accent: 'Tanzania–Zambia corridor.' } satisfies SplitHeadline,
  /** Two lines on desktop: the group in one sentence. The sectors follow further down the page. */
  lede: 'Itemba Group is a diversified Tanzanian holding group: three companies, six sectors, one base in Mpemba-Tunduma.',
  actions: [
    { label: 'Explore the group', href: '/companies' },
    { label: 'Start a business enquiry', href: '/partnerships' },
  ] satisfies LinkItem[],
  image: mediaImage('mpemba-hero', {
    alt: 'ITEMBA-MPEMBA filling station under a wide Songwe sky, managed by Mwanjalisi Oil Company Ltd',
  }),
};

export const homeStatement = {
  headline: { lead: 'One group. Three companies.', accent: 'The corridor that moves the south.' } satisfies SplitHeadline,
  body:
    'Each company operates independently, with full responsibility for its market — unified under one Itemba structure on the Tanzania–Zambia border.',
};

/** One tile per company, in public order. */
export const homeCompanyTiles: HomeCompanyTile[] = [
  {
    companySlug: 'mwanjalisi-oil',
    name: 'Mwanjalisi Oil',
    eyebrow: 'Energy · Fuel · Parking',
    summary:
      'ITEMBA-branded filling stations and UZUNGUNI PARKING YARD — diesel, petrol, kerosene and lubricants for the motorists, buses, trucks and fleets that keep the corridor moving.',
  },
  {
    companySlug: 'westsides-company',
    name: 'Westsides',
    eyebrow: 'Trade · Distribution',
    summary:
      'Wholesale beverages, ITEMBA-HARDWARE and UZUNGUNI INN — supplying 50+ stockists, bars, contractors, hospitality and cross-border bulk buyers across Songwe Region.',
  },
  {
    companySlug: 'itemba-enterprises',
    name: 'Itemba Enterprises',
    eyebrow: 'Logistics · Cross-border transit',
    summary:
      'Dar es Salaam to the Southern Highlands and cross-border transit through Tunduma — moving goods for businesses across Songwe, Mbeya, Rukwa, Ruvuma and Iringa, and on to four neighbouring countries.',
  },
];

/** The two links on every company tile: the company page and its enquiry form. */
export const homeTileActions = {
  explore: 'Explore',
  enquire: 'Enquire',
} as const;

export const homeSectors = {
  eyebrow: 'What we do',
  title: 'Six sectors. One corridor.',
  body:
    'Start from the sector that matches your need — each opens onto a focused service, the company behind it, and the right way to make an enquiry.',
  action: 'Explore',
  /** Before the company that runs a sector: "Run by Mwanjalisi Oil". */
  runBy: 'Run by',
  /** The last cell of the sectors grid: the group's routing promise. */
  routing: {
    title: 'Every sector. One front door.',
    body: 'One group office routes every enquiry to the right company.',
    link: { label: 'Start a business enquiry', href: '/partnerships' } satisfies LinkItem,
  },
  items: [
    {
      icon: 'energy',
      name: 'Energy, Fuel & Parking',
      serviceSlug: 'fuel-and-lubricants',
      image: mediaImage('uzunguni-pump-island', {
        alt: 'Pumps under the ITEMBA-UZUNGUNI canopy, managed by Mwanjalisi Oil',
      }),
    },
    {
      icon: 'trade',
      name: 'Trade & Distribution',
      serviceSlug: 'trade-and-distribution',
      image: mediaImage('westsides-order-truck'),
    },
    {
      icon: 'logistics',
      name: 'Logistics & Transit',
      serviceSlug: 'logistics-and-cross-border-transit',
      image: mediaImage('logistics-truck-front'),
    },
    {
      icon: 'construction',
      name: 'Construction & Hardware',
      serviceSlug: 'construction-supplies-and-hardware',
      image: mediaImage('hardware-storefront'),
    },
    {
      icon: 'hospitality',
      name: 'Hospitality & Lodging',
      serviceSlug: 'hospitality-and-lodging',
      image: mediaImage('inn-lodge-room'),
    },
    {
      icon: 'realestate',
      name: 'Real Estate & Property',
      serviceSlug: 'real-estate-and-property',
      image: mediaImage('estate-housing-development'),
    },
  ] satisfies HomeSector[],
};

export const homeCorridor = {
  eyebrow: 'The location advantage',
  title: 'Where Tanzania meets Zambia.',
  body:
    "The Mpemba-Tunduma base sits on one of Southern Africa's busiest trade corridors — giving every company direct access to cross-border flows and regional supply chains.",
  facts: [
    { label: 'Headquarters', value: 'Mpemba-Tunduma, Songwe Region' },
    { label: 'Border', value: 'Tanzania–Zambia, the Tunduma corridor' },
    { label: 'Reach', value: 'Southern Highlands · Zambia · DRC · Zimbabwe · Malawi' },
  ],
  link: { label: 'View the Songwe-Tunduma location profile', href: '/locations/songwe-tunduma' } satisfies LinkItem,
  image: mediaImage('mpemba-station-roadside', {
    alt: 'Itemba station yard on the Songwe Region corridor',
  }),
};

export const homeCorridorMap = {
  eyebrow: 'The corridor, mapped',
  title: 'One hub. Every business on the line.',
  body:
    "Stations, parking, hardware, hospitality and the group office all sit where Dar es Salaam's supply line meets the Tanzania–Zambia border. Explore the cluster.",
};

/** "By the numbers": static numerals, no count-up. `requires` marks the unconfirmed divisions count. */
export const homeNumbers: HomeStat[] = [
  { value: '3', label: 'Operating companies' },
  { value: '6', label: 'Business sectors' },
  { value: '50+', label: 'Stockists served' },
  { value: '4', label: 'Countries of transit' },
  { value: '5', label: 'Specialised divisions', requires: 'showDivisionsStat' },
];

export const homeNumbersCopy = {
  title: 'Itemba Group, by the numbers.',
} as const;

export const homeInsights = {
  eyebrow: 'Business guides',
  title: 'Insights for suppliers, buyers & partners.',
  action: 'Read insight',
  count: 3,
  all: { label: 'All insights', href: '/insights' } satisfies LinkItem,
};

export const homeClosing = {
  title: "Let's move something together.",
  body: 'Suppliers, bulk buyers, fuel and logistics customers — start from your need and reach the right company faster.',
  actions: [
    { label: 'Start a business enquiry', href: '/partnerships' },
    { label: 'Contact the group', href: '/contact' },
  ] satisfies LinkItem[],
  /** Visible labels of the direct channels beside the Enquire pill. */
  channels: {
    whatsapp: 'WhatsApp',
    call: 'Call',
  },
  link: { label: 'Browse frequently asked questions', href: '/faq' } satisfies LinkItem,
};
