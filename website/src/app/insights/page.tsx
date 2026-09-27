import type { Metadata } from 'next';
import { insightsPage } from '@/content/insights';
import { crumbs } from '@/content/nav';
import { pageMetadata } from '@/lib/seo';
import { InsightsDirectRoute, InsightsFeatured, InsightsGuides, InsightsHero, insightsOrder } from '@/sections/insights/InsightsIndex';
import { insightsBlogJsonLd } from '@/sections/insights/structured-data';
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
      <StructuredData data={insightsBlogJsonLd()} />
      <InsightsHero />
      <InsightsFeatured article={featured} />
      <InsightsGuides articles={rest} />
      <InsightsDirectRoute />
      <FooterTrail items={[crumbs.home, crumbs.insights]} />
    </>
  );
}
