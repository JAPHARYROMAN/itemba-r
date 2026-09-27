import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { enquiryPrompts } from '@/content/enquiry';
import { getInsightBySlug, insightArticles } from '@/content/insights';
import { crumbs } from '@/content/nav';
import { insightUrl } from '@/content/site';
import { articleJsonLd } from '@/lib/jsonld';
import { pageMetadata } from '@/lib/seo';
import { InsightArticleBody } from '@/sections/insights/InsightArticleBody';
import { InsightContinue } from '@/sections/insights/InsightContinue';
import { RoutedEnquiry } from '@/sections/insights/RoutedEnquiry';
import { FooterTrail } from '@/shell/SiteFooter';
import { StructuredData } from '@/ui';

type PageProps = {
  params: Promise<{ slug: string }>;
};

/** Only the four guides exist; anything else is a 404 at build time. */
export const dynamicParams = false;

export function generateStaticParams() {
  return insightArticles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = getInsightBySlug(slug);
  if (!article) return {};
  return pageMetadata({
    title: article.title,
    description: article.metaDescription,
    path: insightUrl(article.slug),
    type: 'article',
    publishedTime: article.publishedAt,
    modifiedTime: article.updatedAt,
    keywords: article.keywords,
  });
}

/**
 * An insight article (/insights/<slug>): the story in one 680px reading
 * column (header, lead visual, body), then "Continue from this guide" with
 * the related services, companies and place, then the compact enquiry form
 * on General. The Article JSON-LD carries the dates the page shows and the
 * article's OG card as its image; the breadcrumb trail closes the page.
 */
export default async function InsightArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const article = getInsightBySlug(slug);
  if (!article) notFound();

  return (
    <>
      <StructuredData data={articleJsonLd(article)} />
      <InsightArticleBody article={article} />
      <InsightContinue article={article} />
      <RoutedEnquiry title={enquiryPrompts.insightArticle.title} description={enquiryPrompts.insightArticle.description} />
      <FooterTrail items={[crumbs.home, crumbs.insights, { name: article.displayTitle, path: insightUrl(article.slug) }]} />
    </>
  );
}
