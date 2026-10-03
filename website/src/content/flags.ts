/**
 * Build-time content flags for facts the owner has not confirmed yet.
 *
 * Every default is the conservative, internally consistent option (plan:
 * "Facts the owner should confirm later"). Content modules mark the items a
 * flag governs (`requires: '<flag>'` on list items, or a flag-resolved value
 * such as `site.description`); renderers decide what to show.
 *
 * WP1.1 note: the legacy pages still render the origin/main copy verbatim
 * (see ./legacy.ts). The rebuilt pages (Phase C) apply these flags, and any
 * visible change they cause goes on tests/baseline/approved-changes.json.
 *
 * `npm run content:report` prints the flags in effect and every unconfirmed
 * fact they cover (src/content/facts.ts).
 */
export type FlagValues = {
  /** Home "Specialised divisions" stat and the About divisions count (home says 5, About says 4). */
  showDivisionsStat: boolean;
  /** "Manufacturing" in site.description, the group FAQ and the About pillars: no manufacturing offering exists. */
  mentionManufacturing: boolean;
  /**
   * TINs, incorporation numbers and directors: the /company-profile screen
   * view, /about leadership and the company glance, and the print documents
   * (page source, Ctrl+P and, after `npm run pdf`, the four PDFs; flags.ts is
   * a PDF input, so flipping it fails the lock until they are regenerated).
   * The incorporation dates and numbers told in the company history
   * narrative are not covered: that stays on the owner's list.
   */
  publishLegalIdentifiers: boolean;
  /** Copy that equates the head office (Itemba Filling Station) with the ITEMBA-MPEMBA station. */
  stateHqIsItembaMpemba: boolean;
  /** A separate Itemba Enterprises pin on the corridor map (no known Enterprises depot). */
  showEnterprisesMapPin: boolean;
  /** The UZUNGUNI INN room photos, whose provenance is unconfirmed. */
  useUnverifiedHospitalityPhotos: boolean;
  /** Itemba Estate imagery: a 'typographic' tile with a line icon, or the 'current' stock-like photos. */
  estateImagery: 'current' | 'typographic';
  /** "Songwe is one of Tanzania's fastest-growing regions" (unsourced). */
  songweGrowthClaim: boolean;
};

export const flags: Readonly<FlagValues> = {
  showDivisionsStat: false,
  mentionManufacturing: false,
  publishLegalIdentifiers: true,
  stateHqIsItembaMpemba: false,
  showEnterprisesMapPin: false,
  useUnverifiedHospitalityPhotos: true,
  estateImagery: 'typographic',
  songweGrowthClaim: false,
};

export type FlagName = keyof FlagValues;
/** Flags that simply switch content on or off (usable as `requires` on an item). */
export type BooleanFlagName = { [K in FlagName]: FlagValues[K] extends boolean ? K : never }[FlagName];

/** True when an item gated by `requires` should render under the current flags. */
export function isEnabled(requires: BooleanFlagName | undefined): boolean {
  return requires === undefined ? true : flags[requires];
}

/** Keeps only the items whose `requires` flag (if any) is on. */
export function withFlags<T extends { requires?: BooleanFlagName }>(items: readonly T[]): T[] {
  return items.filter((item) => isEnabled(item.requires));
}
