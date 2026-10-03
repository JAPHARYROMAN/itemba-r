import type { Metadata } from 'next';
import { insightArticles, insightsPage } from '@/content/insights';
import { crumbs } from '@/content/nav';
import { blogJsonLd } from '@/lib/jsonld';
import { pageMetadata } from '@/lib/seo';
import { InsightsDirectRoute, InsightsFeatured, InsightsGuides, InsightsHero, insightsOrder } from '@/sections/insights/InsightsIndex';
import { FooterTrail } from '@/shell/SiteFooter';
import { StructuredData } from '@/ui';

const { meta } = insightsPage;

export const metadata: Metadata = pageMetadata({
  title: meta.title,
  description: meta.description,
  path: '/insights',
  ogTitle: meta.ogTitle,
  ogDescription: meta.ogDescription,
});

/**
 * /insights, a server component: the hero, the featured guide beside its
 * lead visual, the other guides as cards, and "Need a direct route?". No
 * enquiry form here (the quick-contact bar serves phones). The Blog
 * JSON-LD lists every guide; the breadcrumb trail closes the page.
 */
export default function InsightsPage() {
  const { featured, rest } = insightsOrder();
  return (
    <>
      <StructuredData data={blogJsonLd({ name: meta.ogTitle, description: meta.description, path: '/insights', articles: insightArticles })} />
      <InsightsHero />
      <InsightsFeatured article={featured} />
      <InsightsGuides articles={rest} />
      <InsightsDirectRoute />
      <FooterTrail items={[crumbs.home, crumbs.insights]} />
    </>
  );
}
