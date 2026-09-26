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

export type HomeCompanyTile = {
  companySlug: CompanySlug;
  eyebrow: string;
  name: string;
  summary: string;
  brands: string[];
  stat: { value: string; label: string };
  image: MediaImage;
  ctaLabel: string;
};

export type HomeSector = {
  icon: IconKey;
  name: string;
  serviceSlug: string;
  image: MediaImage;
};

export const homeHero = {
  eyebrow: 'Songwe Region · Tanzania–Zambia Corridor',
  headline: { lead: 'Fuel, trade & logistics on the', accent: 'Tanzania–Zambia corridor.' } satisfies SplitHeadline,
  lede:
    'Itemba Group is a diversified Tanzanian holding company based in Mpemba-Tunduma, Songwe Region — spanning fuel and energy, trade and distribution, logistics, hospitality, real estate and construction supply.',
  actions: [
    { label: 'Explore the group', href: '/companies' },
    { label: 'Start a business enquiry', href: '/partnerships' },
  ] satisfies LinkItem[],
  image: mediaImage('mpemba-station-wide'),
};

/** Hero stat strip (legacy home). `requires` marks the unconfirmed divisions count. */
export const homeHeroStats: HomeStat[] = [
  { value: '3', label: 'Operating companies' },
  { value: '6', label: 'Business sectors' },
  { value: '5', label: 'Specialised divisions', requires: 'showDivisionsStat' },
  { value: 'Songwe', label: 'Regional base' },
];

/** "By the numbers": static numerals, no count-up. */
export const homeNumbers: HomeStat[] = [
  { value: '3', label: 'Operating companies' },
  { value: '6', label: 'Business sectors' },
  { value: '50+', label: 'Stockists served' },
  { value: '4', label: 'Countries of transit' },
  { value: '5', label: 'Specialised divisions', requires: 'showDivisionsStat' },
];

export const homeStatement = {
  headline: { lead: 'One group. Three companies.', accent: 'The corridor that moves the south.' } satisfies SplitHeadline,
  body:
    'Each company operates independently, with full responsibility for its market — unified under one Itemba structure on the Tanzania-Zambia border.',
};

/** One tile per company, in public order. */
export const homeCompanyTiles: HomeCompanyTile[] = [
  {
    companySlug: 'mwanjalisi-oil',
    eyebrow: 'Energy · Fuel · Parking',
    name: 'Mwanjalisi Oil',
    summary:
      'ITEMBA-branded filling stations and UZUNGUNI PARKING YARD — diesel, petrol, kerosene and lubricants for the motorists, buses, trucks and fleets that keep the corridor moving.',
    brands: ['ITEMBA-MPEMBA', 'ITEMBA-UZUNGUNI', 'UZUNGUNI PARKING YARD'],
    stat: { value: '2 live · 3 coming', label: 'Fuel stations' },
    image: mediaImage('mpemba-truck-canopy', {
      alt: 'Trucks refuelling under an ITEMBA filling station canopy managed by Mwanjalisi Oil',
    }),
    ctaLabel: 'Enter Mwanjalisi Oil',
  },
  {
    companySlug: 'westsides-company',
    eyebrow: 'Trade · Distribution',
    name: 'Westsides',
    summary:
      'Wholesale beverages, ITEMBA-HARDWARE and UZUNGUNI INN — supplying 50+ stockists, bars, contractors, hospitality and cross-border bulk buyers across Songwe Region.',
    brands: ['Wholesale beverages', 'ITEMBA-HARDWARE', 'UZUNGUNI INN'],
    stat: { value: '50+', label: 'Stockists served' },
    image: mediaImage('westsides-warehouse-stock', {
      alt: 'Westsides Company Ltd wholesale beverage warehouse stock for distribution customers',
    }),
    ctaLabel: 'Enter Westsides',
  },
  {
    companySlug: 'itemba-enterprises',
    eyebrow: 'Logistics · Cross-border transit',
    name: 'Itemba Enterprises',
    summary:
      'Dar es Salaam to the Southern Highlands and cross-border transit through Tunduma — moving goods for businesses across Songwe, Mbeya, Rukwa, Ruvuma and Iringa, and on to four neighbouring countries.',
    brands: ['Dar → Highlands', 'Cross-border transit', 'Emerging businesses'],
    stat: { value: '4 countries', label: 'Transit reach' },
    image: mediaImage('logistics-tanker', {
      alt: 'Itemba Logistics tanker supporting goods movement and cross-border transit',
    }),
    ctaLabel: 'Enter Itemba Enterprises',
  },
];

export const homeSectors = {
  eyebrow: 'What we do',
  title: 'Six sectors. One corridor.',
  body:
    'Start from the sector that matches your need — each opens onto a focused service, the company behind it, and the right way to make an enquiry.',
  action: 'Explore',
  items: [
    {
      icon: 'energy',
      name: 'Energy, Fuel & Parking',
      serviceSlug: 'fuel-and-lubricants',
      image: mediaImage('mpemba-forecourt'),
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
    { label: 'Border', value: 'Tanzania – Zambia, the Tunduma corridor' },
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
    "Stations, parking, hardware, hospitality and the group office all sit where Dar es Salaam's supply line meets the Tanzania-Zambia border. Explore the cluster.",
};

export const homeInsights = {
  eyebrow: 'Business guides',
  title: 'Insights for suppliers, buyers & partners.',
  action: 'Read insight',
  count: 3,
};

export const homeClosing = {
  title: "Let's move something together.",
  body: 'Suppliers, bulk buyers, fuel and logistics customers — start from your need and reach the right company faster.',
  actions: [
    { label: 'Start a business enquiry', href: '/partnerships' },
    { label: 'Contact the group', href: '/contact' },
  ] satisfies LinkItem[],
  link: { label: 'Browse frequently asked questions', href: '/faq' } satisfies LinkItem,
};
