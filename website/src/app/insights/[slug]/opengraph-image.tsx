import { insightArticles } from '@/content/insights';
import { ogFallbacks } from '@/content/og';
import { OG_CONTENT_TYPE, OG_SIZE, clamp, ogImageResponse } from '@/lib/og-card';

export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;
export const alt = ogFallbacks.insight.alt;

export function generateStaticParams() {
  return insightArticles.map((article) => ({ slug: article.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = insightArticles.find((item) => item.slug === slug);

  return ogImageResponse({
    eyebrow: article?.eyebrow ?? ogFallbacks.insight.eyebrow,
    title: article?.title ?? ogFallbacks.insight.title,
    subtitle: article ? clamp(article.summary) : undefined,
  });
}
