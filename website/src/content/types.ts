/**
 * Shared content types. Content is plain data: no Tailwind classes, no JSX,
 * no colours (accents are token keys resolved by the design system).
 */
import type { BooleanFlagName } from './flags';

export type Faq = {
  question: string;
  answer: string;
};

/** Operating company ids (also the enquiry intent ids that route to them). */
export type CompanyId = 'mwanjalisi' | 'westsides' | 'enterprises';
export type CompanySlug = 'mwanjalisi-oil' | 'westsides-company' | 'itemba-enterprises';
export type IntentId = 'general' | CompanyId;

/** Accent token key: the group gold or one of the company accents (src/design/tokens.ts). */
export type AccentKey = 'group' | CompanyId;

/** Sector artwork / icon key used by services, companies and locations. */
export type SectorVisual = 'fuel' | 'trade' | 'logistics' | 'hardware' | 'estate' | 'hospitality' | 'parking';

/** Line-icon key (the SectorIcon set). */
export type IconKey = 'energy' | 'trade' | 'manufacturing' | 'construction' | 'hospitality' | 'realestate' | 'logistics';

/** A line icon content may name: the sector set plus a few general glyphs (src/ui/Icon.tsx). */
export type ContentIcon = IconKey | 'globe' | 'map-pin' | 'document' | 'arrow-up-right';

export type LinkItem = {
  label: string;
  href: string;
};

/**
 * A headline in two parts: `lead` then `accent`, read as one sentence
 * (`${lead} ${accent}`). Renderers may set the accent apart (a second line, a
 * quieter tone); the words never change.
 */
export type SplitHeadline = {
  lead: string;
  accent: string;
};

/** Inline rich text: plain runs and strongly emphasised runs, in order. */
export type RichText = ReadonlyArray<string | { strong: string }>;

/** Marks a list item that only renders when a boolean flag is on. */
export type Gated = {
  requires?: BooleanFlagName;
};

export function headlineText(headline: SplitHeadline): string {
  return `${headline.lead} ${headline.accent}`;
}

export function richTextPlain(text: RichText): string {
  return text.map((run) => (typeof run === 'string' ? run : run.strong)).join('');
}
