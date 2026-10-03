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

/** "At a glance" under the hero: the facts a bank or partner reads first. */
export const coverFacts = [
  { label: 'Group', value: 'Itemba Group' },
  { label: 'Head Office', value: 'Mpemba-Tunduma, Songwe Region' },
  { label: 'Companies', value: '3 independent subsidiaries' },
  { label: 'Sectors', value: 'Fuel, parking, wholesale beverages, hardware, lodging, restaurant, bar, and logistics' },
];

/**
 * The cover: who the document is for, the title as a two-tone line, one
 * sentence on the group (the sectors follow in "At a glance"), the two
 * actions (the group profile as a PDF, and the enquiry form further down
 * the page) and the cover photograph: ITEMBA-MPEMBA seen from the highway,
 * a 2400px landscape master.
 */
export const profileCover = {
  eyebrow: 'Prepared for institutional review',
  headline: { lead: 'Itemba Group', accent: 'Company Profile' } satisfies SplitHeadline,
  lede: 'A Tanzanian holding group headquartered in Mpemba-Tunduma, Songwe Region, operating through three independent companies.',
  downloadLabel: 'Download PDF',
  enquireLabel: 'Send enquiry',
  image: mediaImage('mpemba-station-roadside'),
  glanceTitle: 'At a glance',
} as const;

/** Public URL of a profile's ready-made PDF (committed under public/downloads). */
export function profilePdfHref(profileId: string) {
  return `/downloads/itemba-${profileId}-profile.pdf`;
}
