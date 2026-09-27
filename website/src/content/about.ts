/**
 * /about: who the group is, how it is structured, why it diversifies, where it is.
 */
import 'server-only';
import { flags } from './flags';
import { mediaImage } from './media';
import type { CompanyId, RichText, SplitHeadline } from './types';

export type StructureUnit = {
  name: string;
  focus: string;
  /** The company's flagship activity. */
  flagship?: boolean;
};

export type StructureCompany = {
  companyId: CompanyId;
  name: string;
  focus: string;
  units: readonly StructureUnit[];
};

/** Flag-resolved (`showDivisionsStat`): the divisions count is unconfirmed (home says 5, About said 4). */
const structureParagraph = flags.showDivisionsStat
  ? 'Headquartered in Mpemba-Tunduma, Songwe Region, we operate six business sectors across three independent subsidiary companies and four specialised divisions.'
  : 'Headquartered in Mpemba-Tunduma, Songwe Region, we operate six business sectors across three independent subsidiary companies.';

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
  hero: {
    eyebrow: 'About the group',
    headline: { lead: 'Built for Tanzania.', accent: 'Built to last.' } satisfies SplitHeadline,
    lede:
      'A Tanzanian holding group built on diversification, resilience and long-term growth — operating three independent companies across six major business sectors.',
    image: mediaImage('mpemba-station-wide'),
  },
  whoWeAre: {
    eyebrow: 'Who we are',
    title: 'A multi-industry business ecosystem',
    lead: 'Itemba Group is a Tanzanian-based diversified holding group made up of several subsidiary companies operating independently under one parent corporate structure.',
    model: [
      'Our model is that of a ',
      { strong: 'conglomerate' },
      ' — each company has its own legal identity and operational independence, while benefiting from strategic oversight, shared resources and central governance.',
    ] satisfies RichText,
    structure: structureParagraph,
    mosaic: [
      mediaImage('mpemba-station-wide', { alt: 'ITEMBA filling station forecourt' }),
      mediaImage('westsides-warehouse-stock', { alt: 'Westsides wholesale beverage warehouse stock' }),
      mediaImage('logistics-tanker', { alt: 'Itemba Logistics tanker truck' }),
      mediaImage('inn-bar-restaurant', { alt: 'UZUNGUNI INN bar and restaurant' }),
    ],
  },
  organisation: {
    eyebrow: 'Organisation',
    title: 'Three tiers. One vision.',
    tiers: [
      {
        level: 'Group',
        title: 'Itemba Group',
        summary: 'The parent holding company — strategic oversight, governance, and central coordination.',
      },
      {
        level: 'Companies',
        title: '3 Subsidiaries',
        summary: 'Mwanjalisi Oil, Westsides Company, and Itemba Enterprises — legally and operationally independent.',
      },
      {
        level: 'Brands',
        title: 'Operating brands',
        summary:
          'ITEMBA-MPEMBA, ITEMBA-UZUNGUNI and UZUNGUNI PARKING YARD under Mwanjalisi Oil; ITEMBA-HARDWARE and UZUNGUNI INN under Westsides.',
      },
    ],
    /** The group structure tree: parent, companies, their brands and units. */
    structure: {
      root: { name: 'ITEMBA GROUP', note: '(Parent Holding)' },
      flagshipLabel: 'flagship',
      companies: [
        {
          companyId: 'mwanjalisi',
          name: 'Mwanjalisi Oil Co Ltd',
          focus: 'Fuel, parking & energy distribution',
          units: [
            { name: 'ITEMBA-MPEMBA / ITEMBA-UZUNGUNI', focus: 'Fuel station brands' },
            { name: 'UZUNGUNI PARKING YARD', focus: 'Parking facilities' },
          ],
        },
        {
          companyId: 'westsides',
          name: 'Westsides Company Ltd',
          focus: 'Beverages, hardware & hospitality',
          units: [
            { name: 'ITEMBA-HARDWARE', focus: 'Hardware & construction equipment' },
            { name: 'UZUNGUNI INN', focus: 'Lodging, restaurant & bar' },
          ],
        },
        {
          companyId: 'enterprises',
          name: 'Itemba Enterprises Co Ltd',
          focus: 'Logistics & emerging businesses',
          units: [{ name: 'Itemba Logistics', focus: 'Local & cross-border transit', flagship: true }],
        },
      ] satisfies readonly StructureCompany[],
    },
  },
  approach: {
    eyebrow: 'Our approach',
    title: 'Why diversification?',
    image: mediaImage('mpemba-station-roadside', { alt: 'Itemba Group filling station yard and corridor operations' }),
    pillars: [
      {
        title: 'Risk reduction',
        summary: 'Operating across six sectors shields the group from downturns in any single industry.',
      },
      { title: 'Revenue diversification', summary: revenuePillar },
      {
        title: 'Market reach',
        summary: 'Serving distinct customer segments simultaneously expands our regional footprint.',
      },
      {
        title: 'Scalability',
        summary: "Each company scales independently without constraining the broader group's growth.",
      },
    ],
  },
  headquarters: {
    eyebrow: 'Where we are',
    title: 'Headquartered in Songwe Region',
    image: mediaImage('mpemba-station-wide', { alt: 'Itemba Filling Station along the Tunduma-Ileje Highway in Mpemba' }),
    body: [
      'Our head office is at the ',
      { strong: 'Itemba Filling Station' },
      " along the Tunduma–Ileje Highway in Mpemba, Tunduma — at the Tanzania–Zambia border, one of East and Southern Africa's most active trade corridors.",
    ] satisfies RichText,
    /** Unsourced claim: gated by `songweGrowthClaim`. */
    growth: {
      text: "The Songwe Region is one of Tanzania's fastest-growing regions, driven by trade, agriculture and infrastructure investment — and the group sits at the heart of it.",
      requires: 'songweGrowthClaim',
    },
  },
} as const;
