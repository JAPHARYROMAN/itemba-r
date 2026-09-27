/**
 * /about: who the group is, how it is structured, why it diversifies, how
 * it grew, who leads it and where it is.
 */
import 'server-only';
import { flags } from './flags';
import { mediaImage } from './media';
import type { history } from './profile/history';
import type { CompanyId, CompanySlug, ContentIcon, LinkItem, RichText, SplitHeadline } from './types';

/** A brand, branch or business under one of the companies (the third tier). */
export type StructureUnit = {
  name: string;
  focus: string;
  /** The company's flagship activity. */
  flagship?: boolean;
};

export type StructureCompany = {
  companyId: CompanyId;
  companySlug: CompanySlug;
  name: string;
  focus: string;
  units: readonly StructureUnit[];
};

/** A dated entry of the company history (src/content/profile/history.ts). */
export type HistoryDate = (typeof history)[number]['date'];

/**
 * One year on the milestones strip. `covers` names the company-history
 * entries it summarises, in chronological order; together the milestones
 * cover every entry once (tests/unit/about-companies.test.ts).
 */
export type Milestone = {
  year: string;
  /** ISO date (or year) for the <time> element. */
  dateTime: string;
  title: string;
  detail: string;
  covers: readonly HistoryDate[];
};

/**
 * A reason to diversify, as a bento cell. `visual` is what the cell shows
 * above its text: the six sectors (each a link to its service), the three
 * companies as their accent dots, or a line icon.
 */
export type Pillar = {
  title: string;
  summary: string;
  visual: 'sectors' | 'companies' | ContentIcon;
};

/** Flag-resolved (`mentionManufacturing`). */
const revenuePillar = flags.mentionManufacturing
  ? 'Multiple streams from energy, trade, manufacturing and services create lasting stability.'
  : 'Multiple streams from energy, trade and services create lasting stability.';

export const aboutPage = {
  meta: {
    title: 'About Us',
    description:
      'Learn about Itemba Group, a Tanzanian multi-industry holding group headquartered in Mpemba-Tunduma, Songwe Region.',
    ogTitle: 'About Itemba Group',
    ogDescription:
      'A Tanzanian holding group built on diversification, resilience, and long-term growth across multiple sectors.',
  },
  /** The page's own breadcrumb (the visible trail and its BreadcrumbList). */
  crumb: { name: 'About', path: '/about' },
  /** The AboutPage JSON-LD name. */
  jsonLdName: 'About Itemba Group',
  hero: {
    eyebrow: 'About the group',
    headline: { lead: 'Built for Tanzania.', accent: 'Built to last.' } satisfies SplitHeadline,
    lede:
      'A Tanzanian holding group built on diversification, resilience and long-term growth — operating three independent companies across six major business sectors.',
    actions: [
      { label: 'Meet the companies', href: '/companies' },
      { label: 'Read the company profile', href: '/company-profile' },
    ] satisfies LinkItem[],
  },
  /** The group in one sentence: the AboutPage JSON-LD description. */
  whoWeAre: {
    lead: 'Itemba Group is a Tanzanian-based diversified holding group made up of several subsidiary companies operating independently under one parent corporate structure.',
  },
  organisation: {
    eyebrow: 'Who we are',
    title: 'Three tiers. One vision.',
    /** Under the title: the conglomerate model, short enough for four lines on a phone. */
    lede: 'Each company is legally and operationally independent, with strategy, shared resources and governance from the group.',
    /** What each tier is, under the diagram (tier order: group, companies, brands). */
    tiers: [
      {
        level: 'Group',
        title: 'Itemba Group',
        summary: 'The parent holding company: strategic oversight, governance and central coordination.',
      },
      {
        level: 'Companies',
        title: 'Three subsidiaries',
        summary: 'Mwanjalisi Oil, Westsides and Itemba Enterprises, each with its own identity, focus and market.',
      },
      {
        level: 'Brands',
        title: 'Brands and businesses',
        summary: 'The stations, yard, branches, inn and businesses customers deal with every day.',
      },
    ],
    /** The group structure diagram: parent, companies, their brands and businesses. */
    structure: {
      root: { name: 'Itemba Group', note: 'Parent holding company' },
      flagshipLabel: 'Flagship',
      companies: [
        {
          companyId: 'mwanjalisi',
          companySlug: 'mwanjalisi-oil',
          name: 'Mwanjalisi Oil Co Ltd',
          focus: 'Fuel, parking & energy distribution',
          units: [
            { name: 'ITEMBA-MPEMBA', focus: 'Filling station' },
            { name: 'ITEMBA-UZUNGUNI', focus: 'Filling station' },
            { name: 'UZUNGUNI PARKING YARD', focus: 'Parking facilities' },
          ],
        },
        {
          companyId: 'westsides',
          companySlug: 'westsides-company',
          name: 'Westsides Company Ltd',
          focus: 'Beverages, hardware & hospitality',
          units: [
            { name: 'Wholesale beverages', focus: 'Mpemba, Mlowo and Sogea branches' },
            { name: 'ITEMBA-HARDWARE', focus: 'Hardware & construction equipment' },
            { name: 'UZUNGUNI INN', focus: 'Lodging, restaurant & bar' },
          ],
        },
        {
          companyId: 'enterprises',
          companySlug: 'itemba-enterprises',
          name: 'Itemba Enterprises Co Ltd',
          focus: 'Logistics & emerging businesses',
          units: [
            { name: 'Itemba Logistics', focus: 'Local & cross-border transit', flagship: true },
            { name: 'Itemba Estate', focus: 'Real estate & property' },
            { name: 'Emerging businesses', focus: 'New opportunities' },
          ],
        },
      ] satisfies readonly StructureCompany[],
    },
  },
  approach: {
    eyebrow: 'Our approach',
    title: 'Why diversification?',
    lede: 'Six sectors under one structure, so no single market decides the group’s future.',
    /** In page order: the first leads the bento, beside the sectors figure. */
    pillars: [
      {
        title: 'Risk reduction',
        summary: 'Operating across six sectors shields the group from downturns in any single industry.',
        visual: 'sectors',
      },
      { title: 'Revenue diversification', summary: revenuePillar, visual: 'companies' },
      {
        title: 'Market reach',
        summary: 'Serving distinct customer segments simultaneously expands our regional footprint.',
        visual: 'globe',
      },
      {
        title: 'Scalability',
        summary: "Each company scales independently without constraining the broader group's growth.",
        visual: 'arrow-up-right',
      },
    ] satisfies Pillar[],
    /** The figure beside the lead pillar. */
    figure: { value: '6', label: 'Business sectors', note: 'Across three independent companies' },
    /** Accessible name of the six sector links in the lead pillar. */
    sectorsLabel: 'The six sectors',
  },
  timeline: {
    eyebrow: 'Our story',
    title: 'Built step by step, since 2012.',
    lede: 'From one hardware business to three independent companies across six sectors.',
    /** Oldest first. 2017 keeps its order: 2 May, 9 June, then the ITEMBA-MPEMBA opening. */
    milestones: [
      {
        year: '2012',
        dateTime: '2012-01-20',
        title: 'Itemba Enterprises incorporated',
        detail: 'The group starts with one hardware business.',
        covers: ['20 January 2012'],
      },
      {
        year: '2013',
        dateTime: '2013',
        title: 'Parking opens',
        detail: 'Uzunguni Yard takes the group into parking facilities.',
        covers: ['2013'],
      },
      {
        year: '2014',
        dateTime: '2014',
        title: 'Beverage distribution begins',
        detail: 'Retail at the Sogea Branch, then wholesale at Vwawa.',
        covers: ['2014'],
      },
      {
        year: '2015',
        dateTime: '2015',
        title: 'Fuel and hospitality',
        detail: 'The first fuel station, today’s ITEMBA-UZUNGUNI, and UZUNGUNI INN open.',
        covers: ['2015'],
      },
      {
        year: '2017',
        dateTime: '2017',
        title: 'Mwanjalisi Oil and Westsides',
        detail: 'Incorporated on 2 May and 9 June, for fuel and beverages. ITEMBA-MPEMBA opens later.',
        covers: ['2 May 2017', '9 June 2017', '2017 onward'],
      },
      {
        year: '2021',
        dateTime: '2021',
        title: 'Logistics begins',
        detail: 'Itemba Enterprises moves into corridor transport.',
        covers: ['2021'],
      },
      {
        year: '2025',
        dateTime: '2025-11-01',
        title: 'Three focused companies',
        detail: 'On 1 November, trading and hospitality move to Westsides; Itemba Enterprises focuses on logistics.',
        covers: ['1 November 2025'],
      },
    ] satisfies readonly Milestone[],
  },
  /**
   * The leadership team (names and roles from the company profile, §8), as
   * typographic cards: no portraits. Gated with the directors and legal
   * identifiers (`publishLegalIdentifiers`), which the owner is still to
   * confirm for the public web page.
   */
  leadership: {
    eyebrow: 'Leadership',
    title: 'The team behind the group.',
    lede: 'Group leadership, and the roles each leader holds across the three companies.',
    requires: 'publishLegalIdentifiers',
  },
  headquarters: {
    eyebrow: 'Where we are',
    title: 'Headquartered in Songwe Region',
    /** One neutral corridor phrase (facts.corridorWording); no superlative. */
    body: [
      'Our head office is at the ',
      { strong: 'Itemba Filling Station' },
      ' along the Tunduma–Ileje Highway in Mpemba, Tunduma, on the Tanzania–Zambia border.',
    ] satisfies RichText,
    facts: {
      headOffice: 'Head office',
      postal: 'Postal address',
      region: 'Region',
      regionValue: 'Songwe Region, Tanzania',
    },
    links: {
      directions: 'Get directions',
      location: { label: 'Explore the Songwe-Tunduma location', href: '/locations/songwe-tunduma' } satisfies LinkItem,
    },
    image: mediaImage('songwe-landscape', { alt: 'Fields and mountains in Songwe Region, Tanzania' }),
    /** Unsourced claim: gated by `songweGrowthClaim`. */
    growth: {
      text: "The Songwe Region is one of Tanzania's fastest-growing regions, driven by trade, agriculture and infrastructure investment — and the group sits at the heart of it.",
      requires: 'songweGrowthClaim',
    },
  },
} as const;
