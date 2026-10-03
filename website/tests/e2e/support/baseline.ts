/**
 * Typed readers for the golden baseline (tests/baseline/*.json, recorded from
 * origin/main by scripts/snapshot-routes.mjs) and for the reviewed list of
 * intentional differences (tests/baseline/approved-changes.json).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASELINE_DIR = path.resolve(__dirname, '../../baseline');

function load<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(BASELINE_DIR, file), 'utf8')) as T;
}

export type LdEntitySummary = { '@type': unknown; '@id': string | null };

export type RouterInstance = { marker: string; defaultIntent: string | null };

export type BaselineRoute = {
  url: string;
  status: number;
  title: string;
  description: string | null;
  keywords: string | null;
  robots: string | null;
  canonical: string | null;
  og: [string, string][];
  twitter: [string, string][];
  h1: string[];
  ids: string[];
  hashLinks: string[];
  internalLinks: string[];
  contactHrefs: string[];
  jsonLd: { index: number; entities?: LdEntitySummary[]; data?: unknown; parseError?: string }[];
  jsonLdTypes: string[];
  enquiryRouter: { present: boolean; count: number; defaultIntent: string | null; instances: RouterInstance[] };
  quickContact: { present: boolean; marker: string | null; links: { href: string; label: string | null }[] };
  printHooks: {
    printDocumentRoot: number;
    printProfiles: string[];
    downloadLinks: { href: string; download: boolean }[];
  };
};

export type HeaderMap = Record<string, string>;

export type Baseline = {
  routes: Record<string, BaselineRoute>;
  headers: { routes: Record<string, HeaderMap>; assets: Record<string, HeaderMap> };
  redirects: {
    hostRedirects: { host: string; path: string; status: number; location: string | null }[];
    controlHosts: { host: string; path: string; status: number; location: string | null; xRobotsTag: string | null }[];
    trailingSlash: { path: string; status: number; location: string | null }[];
  };
  metadataRoutes: {
    sitemap: { status: number; entries: { loc: string; lastmod: string | null; changefreq: string | null; priority: string | null }[] };
    robots: { status: number; body: string };
    manifest: { status: number; json: Record<string, unknown> | null };
  };
  ogImages: Record<string, { route: string; status: number; contentType: string | null; metaOgImagePath: string | null }>;
  misc: {
    notFound: Record<string, { status: number; robots: string | null }>;
    assets: Record<string, { status: number; contentType: string | null }>;
  };
};

let cached: Baseline | null = null;

export function baseline(): Baseline {
  cached ??= {
    routes: load('routes.json'),
    headers: load('headers.json'),
    redirects: load('redirects.json'),
    metadataRoutes: load('metadata-routes.json'),
    ogImages: load('og-images.json'),
    misc: load('misc.json'),
  };
  return cached;
}

export function baselineRoute(pathname: string): BaselineRoute {
  const route = baseline().routes[pathname];
  if (!route) throw new Error(`No baseline entry for ${pathname}`);
  return route;
}

/**
 * Soft fields: copy that may be rewritten, but only through a reviewed entry
 * in approved-changes.json. Everything else the route inventory compares is a
 * hard contract and cannot be approved away.
 */
export const SOFT_FIELDS = [
  'description',
  'keywords',
  'og:title',
  'og:description',
  'og:image:alt',
  'og:site_name',
  'og:locale',
  'og:type',
  'twitter:title',
  'twitter:description',
  'twitter:image:alt',
] as const;

export type SoftField = (typeof SOFT_FIELDS)[number];

/** `value` is the exact text the rebuild renders; null approves removal. */
export type ApprovedChange = { value: string | null; reason: string };

export type ApprovedChanges = {
  routes: Record<string, Partial<Record<SoftField, ApprovedChange>>>;
};

export function approvedChanges(): ApprovedChanges {
  const raw = load<Partial<ApprovedChanges>>('approved-changes.json');
  const routes = raw.routes ?? {};
  for (const [route, fields] of Object.entries(routes)) {
    for (const [field, change] of Object.entries(fields ?? {})) {
      if (!(SOFT_FIELDS as readonly string[]).includes(field)) {
        throw new Error(
          `approved-changes.json: ${route} → "${field}" is not a soft field. Only ${SOFT_FIELDS.join(', ')} can be approved.`,
        );
      }
      if (!change || typeof change.reason !== 'string' || !change.reason.trim()) {
        throw new Error(`approved-changes.json: ${route} → "${field}" needs a non-empty "reason".`);
      }
      if (change.value !== null && typeof change.value !== 'string') {
        throw new Error(`approved-changes.json: ${route} → "${field}" value must be a string or null.`);
      }
    }
  }
  return { routes };
}

/** Intent aliases, identical to scripts/snapshot-routes.mjs. */
export const INTENT_ALIASES: Record<string, string[]> = {
  general: ['general', 'general business enquiry', 'group', 'itemba group'],
  mwanjalisi: ['mwanjalisi', 'fuel', 'fuel and petroleum supply', 'mwanjalisi oil', 'mwanjalisi oil co ltd'],
  westsides: ['westsides', 'trade', 'trade and distribution', 'westsides company', 'westsides company ltd'],
  enterprises: ['enterprises', 'logistics', 'logistics and operations', 'itemba enterprises', 'itemba enterprises co ltd'],
};

export function intentIdFor(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  for (const [id, aliases] of Object.entries(INTENT_ALIASES)) {
    if (aliases.includes(v)) return id;
  }
  return null;
}

/**
 * Contact hrefs compared by meaning, not encoding: mailto subjects switch
 * from `+` to `%20` for spaces in the rebuild (architecture §1), which is the
 * same subject.
 */
export function normaliseContactHref(href: string): string {
  if (/^mailto:/i.test(href)) {
    const [address, query = ''] = href.slice('mailto:'.length).split('?');
    const params = new URLSearchParams(query);
    const parts = [...params.entries()]
      .map(([k, v]) => `${k.toLowerCase()}=${v}`)
      .sort();
    return `mailto:${decodeURIComponent(address ?? '').toLowerCase()}${parts.length ? `?${parts.join('&')}` : ''}`;
  }
  if (/wa\.me\//.test(href)) {
    try {
      const url = new URL(href);
      const text = url.searchParams.get('text');
      return `https://wa.me${url.pathname}${text !== null ? `?text=${text}` : ''}`;
    } catch {
      return href;
    }
  }
  return href;
}
