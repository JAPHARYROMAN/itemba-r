/**
 * origin/main copy that the default flags change, kept verbatim so the legacy
 * pages (and the @/lib/site barrel) keep rendering exactly what production
 * renders today. Only the legacy pages read this module; the rebuilt pages
 * use the flag-resolved content and must not import it. Deleted together with
 * the legacy pages (WP3.1).
 */
import 'server-only';
import { siteDescriptions } from './site';

export const legacyCopy = {
  /** site.description on origin/main (mentions manufacturing). */
  siteDescription: siteDescriptions.withManufacturing,
  /** Group FAQ "Which sectors does Itemba Group operate in?" answer on origin/main. */
  groupSectorsAnswer:
    'The group operates across energy, trade, logistics, construction supplies, hospitality, parking, real estate, and manufacturing-related activities.',
  /** About "Revenue diversification" pillar on origin/main. */
  aboutRevenuePillar: 'Multiple streams from energy, trade, manufacturing and services create lasting stability.',
  /** About "Who we are" closing paragraph on origin/main (states four specialised divisions). */
  aboutStructureParagraph:
    'Headquartered in Mpemba-Tunduma, Songwe Region, we operate six business sectors across three independent subsidiary companies and four specialised divisions.',
} as const;
