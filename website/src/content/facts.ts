/**
 * Claims the site makes that the owner has or has not confirmed.
 *
 * Each fact records its status, why it is doubtful, which flag (if any)
 * governs it in src/content/flags.ts, and where it appears publicly.
 * `npm run content:report` lists every unconfirmed fact with the flag value
 * in effect, so the owner can confirm or correct them in one pass.
 *
 * Dependency-free on purpose (type imports only): the report script loads
 * this file directly.
 */
import type { FlagName } from './flags';

export type FactStatus = 'confirmed' | 'unconfirmed';

export type Fact<T> = {
  value: T;
  status: FactStatus;
  note: string;
  /** The flag that decides whether the rebuilt pages show it. */
  flag?: FlagName;
  /**
   * Where the rebuilt site and the documents state the claim (page and
   * section). A flagged claim is listed where it shows when its flag is on.
   */
  publicUse: readonly string[];
};

export function fact<T>(value: T, meta: Omit<Fact<T>, 'value'>): Fact<T> {
  return { value, ...meta };
}

export const facts = {
  divisionsCount: fact(5, {
    status: 'unconfirmed',
    flag: 'showDivisionsStat',
    note: 'Home shows "5 Specialised divisions"; About says "four specialised divisions". Owner: 4 or 5?',
    publicUse: ['/ (By the numbers)'],
  }),
  manufacturing: fact('Manufacturing is one of the group sectors', {
    status: 'unconfirmed',
    flag: 'mentionManufacturing',
    note: 'No manufacturing company, offering or image exists. Dropped by default; site.description then changes (approved-changes entry).',
    publicUse: ['site.description (root meta description, manifest)', 'group FAQ (/faq, /company-profile)', '/about (Why diversification?)'],
  }),
  legalIdentifiers: fact('TINs, incorporation numbers and directors of the three companies', {
    status: 'unconfirmed',
    flag: 'publishLegalIdentifiers',
    note: 'Published on /company-profile and in all four PDFs today. Owner to confirm they may stay on the public web page.',
    publicUse: ['/company-profile', 'public/downloads/*.pdf'],
  }),
  hqIsItembaMpemba: fact('The head office (Itemba Filling Station) is the ITEMBA-MPEMBA station', {
    status: 'unconfirmed',
    flag: 'stateHqIsItembaMpemba',
    note: 'Both are on the Tunduma-Ileje Highway in Mpemba, but no page states they are the same site.',
    publicUse: [],
  }),
  enterprisesSite: fact('Itemba Enterprises has no mapped depot or site', {
    status: 'unconfirmed',
    flag: 'showEnterprisesMapPin',
    note: 'The corridor map shows Mwanjalisi Oil, Westsides and group office sites only.',
    publicUse: ['/ (corridor map)'],
  }),
  hospitalityPhotos: fact('The UZUNGUNI INN room photos show UZUNGUNI INN', {
    status: 'unconfirmed',
    flag: 'useUnverifiedHospitalityPhotos',
    note: 'uzunguni-lodge-room.webp is 600x449 with a different JPEG provenance from the company phone photos (stock-looking).',
    publicUse: ['/services/hospitality-and-lodging (hero, gallery)', '/ (sector card)'],
  }),
  estateImagery: fact('The real-estate photos depict Itemba Estate work', {
    status: 'unconfirmed',
    flag: 'estateImagery',
    note: 'All real-estate images are external with no licence recorded, and none shows an Itemba project.',
    publicUse: ['/services/real-estate-and-property (hero, gallery)', '/ (sector card)'],
  }),
  songweGrowth: fact("Songwe Region is one of Tanzania's fastest-growing regions", {
    status: 'unconfirmed',
    flag: 'songweGrowthClaim',
    note: 'Unsourced claim.',
    publicUse: ['/about (Where we are)', '/contact (Growing economy card)'],
  }),
  corridorWording: fact('Tanzania–Zambia corridor', {
    status: 'unconfirmed',
    note: 'Copy mixes "Tanzania-Zambia corridor", "Tunduma corridor", "TANZAM Highway corridor" and "southern corridor". One canonical phrase to confirm.',
    publicUse: ['site-wide'],
  }),
  mwanjalisiLegalName: fact('Mwanjalisi Oil Company Ltd', {
    status: 'unconfirmed',
    note: 'Page titles use "Mwanjalisi Oil Co Ltd"; the legal profile and PDFs use "Mwanjalisi Oil Company Ltd".',
    publicUse: ['/companies/mwanjalisi-oil', '/company-profile', 'public/downloads/*.pdf'],
  }),
  thirdPartyBrands: fact('Third-party beverage and paint brands may appear prominently in imagery', {
    status: 'unconfirmed',
    note: 'Coca-Cola, Heineken, Konyagi, K-Vant and Coral Paints appear in the Westsides photographs.',
    publicUse: ['/companies/westsides-company', '/services/trade-and-distribution'],
  }),
  stockists: fact('More than 50 beverage stockists across Songwe Region', {
    status: 'confirmed',
    note: 'Owner-supplied company copy.',
    publicUse: ['/', '/companies', '/companies/westsides-company', '/services/trade-and-distribution'],
  }),
} as const;

export type FactKey = keyof typeof facts;
