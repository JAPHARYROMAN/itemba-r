import { ImageResponse } from 'next/og';
import { insightArticles } from '@/lib/site';
import { OG_CONTENT_TYPE, OG_SIZE, clamp, renderOgCard } from '@/lib/og-card';

export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Itemba Group insight article';

export function generateStaticParams() {
  return insightArticles.map((article) => ({ slug: article.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = insightArticles.find((item) => item.slug === slug);

  return new ImageResponse(
    renderOgCard({
      eyebrow: article?.eyebrow ?? 'Insights',
      title: article?.title ?? 'Itemba Group Insights',
      subtitle: article ? clamp(article.summary) : undefined,
    }),
    size,
  );
}
