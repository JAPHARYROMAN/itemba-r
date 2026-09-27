/**
 * The /insights Blog entity. src/lib/jsonld.ts has no Blog builder yet, so
 * the page group builds it here from the same pieces (ORG_ID reference,
 * the WebSite @id, absolute URLs, the article OG cards as images); the
 * baseline's @id (`/insights#insights`) is kept.
 */
import 'server-only';
import type { Blog, WithContext } from 'schema-dts';
import { insightArticles, insightsPage } from '@/content/insights';
import { absoluteUrl, insightUrl, site } from '@/content/site';
import { WEBSITE_ID, entityId, orgRef } from '@/lib/jsonld';

export function insightsBlogJsonLd(): WithContext<Blog> {
  const { meta } = insightsPage;
  return {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    '@id': entityId('/insights', 'insights'),
    name: meta.ogTitle,
    description: meta.description,
    url: absoluteUrl('/insights'),
    inLanguage: site.language,
    isPartOf: { '@id': WEBSITE_ID },
    publisher: orgRef,
    blogPost: insightArticles.map((article) => {
      const path = insightUrl(article.slug);
      return {
        '@type': 'BlogPosting',
        headline: article.title,
        description: article.metaDescription,
        url: absoluteUrl(path),
        image: absoluteUrl(`${path}/opengraph-image`),
        datePublished: article.publishedAt,
        dateModified: article.updatedAt,
        author: orgRef,
        publisher: orgRef,
      };
    }),
  };
}
