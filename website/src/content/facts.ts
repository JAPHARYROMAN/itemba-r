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
    note: 'Unverified statutory identifiers and named directors/leadership are omitted from screen, structured data and print source. The flag remains off. All four downloadable PDFs must be regenerated and reviewed before release; archived values remain internal data and are not evidence of verification.',
    publicUse: [],
  }),
  datedHistory: fact('Founding, company incorporation, opening and reorganisation dates from 2012 to 2025', {
    status: 'unconfirmed',
    note: 'No supporting records were supplied for the chronology. Removed from About, profile narratives and print source, including EST. 2012. Current operating responsibilities replace the dated timeline. Do not restore dates without verified records.',
    publicUse: [],
  }),
  exclusiveSupplierRights: fact('Exclusive supplier contracts, territorial rights and little or no direct competition', {
    status: 'unconfirmed',
    note: 'Contract scope and competition claims were not independently supported. Omitted; the established beverage distribution and more-than-50-stockists description remains.',
    publicUse: [],
  }),
  plannedFuelLocations: fact('Three upcoming ITEMBA fuel station locations', {
    status: 'unconfirmed',
    note: 'No verified locations or opening status were supplied. Omitted from public branch, asset and company descriptions; retain the operating ITEMBA-MPEMBA and ITEMBA-UZUNGUNI stations.',
    publicUse: [],
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
    note: 'Room-photo provenance and permission have not been verified. The flag is off and the room image is omitted from public pages and print documents. Hospitality services remain described. Other photographs recorded as owned remain eligible; their inclusion is an editorial choice, not confirmation of this room photo.',
    publicUse: [],
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
    note: 'Tanzania–Zambia corridor is used as a consistent descriptive phrase for the existing Tunduma border context. It does not verify new geographic coverage or a formal route designation.',
    publicUse: ['site-wide'],
  }),
  mwanjalisiLegalName: fact('Mwanjalisi Oil Company Ltd', {
    status: 'unconfirmed',
    note: 'The legal-name variant is unresolved. Public copy and new print documents use the established public name Mwanjalisi Oil Co Ltd or the brand Mwanjalisi Oil; no legalName metadata assertion is made while the legal flag is off.',
    publicUse: [],
  }),
  thirdPartyBrands: fact('Third-party beverage and paint brands may appear prominently in imagery', {
    status: 'unconfirmed',
    note: 'Brands visible on existing owned product/stock photographs identify the photographed stock. No exclusive relationship, endorsement or sponsorship is inferred from their appearance.',
    publicUse: ['/companies/westsides-company', '/services/trade-and-distribution'],
  }),
  stockists: fact('More than 50 beverage stockists across Songwe Region', {
    status: 'confirmed',
    note: 'Owner-supplied company copy.',
    publicUse: ['/', '/companies', '/companies/westsides-company', '/services/trade-and-distribution'],
  }),
} as const;

export type FactKey = keyof typeof facts;
