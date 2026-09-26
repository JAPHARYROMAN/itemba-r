/**
 * Page metadata in one call. Every page gets:
 * - an absolute canonical and og:url for its path;
 * - a complete openGraph object (site name, locale, type, url), because a
 *   page's openGraph replaces the layout's instead of merging with it;
 * - `twitter: { card }` only, so Next fills twitter:title, description and
 *   image from this page's openGraph (and a layout-level twitter title can
 *   never leak onto every page).
 *
 * openGraph deliberately has no `images` key: the route's
 * opengraph-image.tsx supplies the card, and Next only applies a file-based
 * image when the page's openGraph does not own the `images` property.
 */
import type { Metadata } from 'next';
import { absoluteUrl, site } from '@/content/site';

export type PageTitle = string | { absolute: string };

export type PageMetadataInput = {
  /** Document title. A string is completed by the layout template ("%s | Itemba Group"). */
  title: PageTitle;
  description: string;
  /** Site path, e.g. "/about" ("/" for home). */
  path: string;
  /** og:title; defaults to the full document title. */
  ogTitle?: string;
  /** og:description; defaults to `description`. */
  ogDescription?: string;
  type?: 'website' | 'article';
  /** Article dates (ISO), for `type: 'article'`. */
  publishedTime?: string;
  modifiedTime?: string;
  keywords?: string | readonly string[];
  /** robots noindex (error and preview pages). */
  noindex?: boolean;
};

/** The full document title for a page title, as the layout template renders it. */
export function documentTitle(title: PageTitle): string {
  return typeof title === 'string' ? `${title} | ${site.name}` : title.absolute;
}

export function pageMetadata(input: PageMetadataInput): Metadata {
  const url = absoluteUrl(input.path);
  const type = input.type ?? 'website';

  const openGraph: NonNullable<Metadata['openGraph']> =
    type === 'article'
      ? {
          type: 'article',
          title: input.ogTitle ?? documentTitle(input.title),
          description: input.ogDescription ?? input.description,
          url,
          siteName: site.name,
          locale: site.locale,
          ...(input.publishedTime ? { publishedTime: input.publishedTime } : {}),
          ...(input.modifiedTime ? { modifiedTime: input.modifiedTime } : {}),
        }
      : {
          type: 'website',
          title: input.ogTitle ?? documentTitle(input.title),
          description: input.ogDescription ?? input.description,
          url,
          siteName: site.name,
          locale: site.locale,
        };

  const metadata: Metadata = {
    title: input.title,
    description: input.description,
    alternates: { canonical: url },
    openGraph,
    twitter: { card: 'summary_large_image' },
  };
  if (input.keywords !== undefined) {
    metadata.keywords = typeof input.keywords === 'string' ? input.keywords : [...input.keywords];
  }
  if (input.noindex) {
    metadata.robots = { index: false, follow: true };
  }
  return metadata;
}
