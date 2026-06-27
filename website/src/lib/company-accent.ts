import type { IconName } from '@/components/SectorIcon';

/**
 * Single source of truth for the per-company accent used across the site
 * (Mwanjalisi Oil = amber, Westsides = blue, Itemba Enterprises = emerald),
 * keyed by companySlug. Class strings are full literals so Tailwind's JIT keeps
 * them. `wash` is an rgba for hero gradient overlays (matches the hex in
 * og-card.tsx). Reused by the services index + service detail pages.
 */
export interface CompanyAccent {
  /** Accent text colour, e.g. eyebrow. */
  text: string;
  /** Accent border. */
  border: string;
  /** Hover ring (for cards using `ring-1`). */
  ring: string;
  /** Chip background + text + border. */
  chip: string;
  /** Small accent dot/bar background. */
  dot: string;
  /** rgba for hero gradient washes. */
  wash: string;
}

const GOLD: CompanyAccent = {
  text: 'text-gold-300',
  border: 'border-gold-400/30',
  ring: 'hover:ring-gold-400/50',
  chip: 'border-gold-400/30 bg-gold-500/15 text-gold-200',
  dot: 'bg-gold-400',
  wash: 'rgba(200,134,10,0.30)',
};

const ACCENTS: Record<string, CompanyAccent> = {
  'mwanjalisi-oil': {
    text: 'text-amber-300',
    border: 'border-amber-400/30',
    ring: 'hover:ring-amber-400/50',
    chip: 'border-amber-400/30 bg-amber-500/15 text-amber-200',
    dot: 'bg-amber-400',
    wash: 'rgba(245,158,11,0.30)',
  },
  'westsides-company': {
    text: 'text-blue-300',
    border: 'border-blue-400/30',
    ring: 'hover:ring-blue-400/50',
    chip: 'border-blue-400/30 bg-blue-500/15 text-blue-200',
    dot: 'bg-blue-400',
    wash: 'rgba(59,130,246,0.30)',
  },
  'itemba-enterprises': {
    text: 'text-emerald-300',
    border: 'border-emerald-400/30',
    ring: 'hover:ring-emerald-400/50',
    chip: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200',
    dot: 'bg-emerald-400',
    wash: 'rgba(16,185,129,0.30)',
  },
};

/** Accent for a company slug, falling back to brand gold. */
export function getCompanyAccent(companySlug: string): CompanyAccent {
  return ACCENTS[companySlug] ?? GOLD;
}

/** Map a service's `visual` to a SectorIcon name. */
const VISUAL_ICON: Record<string, IconName> = {
  fuel: 'energy',
  trade: 'trade',
  logistics: 'logistics',
  hardware: 'construction',
  estate: 'realestate',
  hospitality: 'hospitality',
  parking: 'logistics',
};

export function getServiceIcon(visual: string): IconName {
  return VISUAL_ICON[visual] ?? 'trade';
}
