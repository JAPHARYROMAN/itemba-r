/**
 * Company profile §1: the cover (screen hero, key facts, PDF downloads) and
 * the page metadata.
 */
import 'server-only';
import { mediaImage } from '../media';
import type { SplitHeadline } from '../types';

export const profileMeta = {
  title: 'Company Profile',
  description:
    'Itemba Group company profile covering overview, vision, activities, products, target markets, operations, ownership, assets, compliance, banking purpose, and contact information.',
  ogTitle: 'Itemba Group Company Profile',
  ogDescription: 'A full company profile and capability statement for Itemba Group in Songwe Region, Tanzania.',
} as const;

export const coverFacts = [
  { label: 'Group', value: 'Itemba Group' },
  { label: 'Head Office', value: 'Mpemba-Tunduma, Songwe Region' },
  { label: 'Companies', value: '3 independent subsidiaries' },
  { label: 'Sectors', value: 'Fuel, parking, wholesale beverages, hardware, lodging, restaurant, bar, and logistics' },
];

export const profileCover = {
  eyebrow: 'Company Profile and Capability Statement',
  headline: { lead: 'Itemba Group', accent: 'Company Profile' } satisfies SplitHeadline,
  lede:
    'A Tanzanian holding group headquartered in Mpemba-Tunduma, Songwe Region, operating through three independent companies across energy, trade, logistics, construction supply, hospitality, real estate, and related services.',
  enquireLabel: 'Send enquiry',
  image: mediaImage('mpemba-station-wide', {
    alt: 'ITEMBA-MPEMBA filling station forecourt representing Itemba Group operations',
  }),
  imageCaption: 'Prepared for customers, suppliers, partners, and banking review.',
  downloads: {
    heading: 'Download PDF',
    note: 'Ready-made snapshots — use Print above for the live, current page.',
  },
} as const;

/** Public URL of a profile's ready-made PDF (committed under public/downloads). */
export function profilePdfHref(profileId: string) {
  return `/downloads/itemba-${profileId}-profile.pdf`;
}
