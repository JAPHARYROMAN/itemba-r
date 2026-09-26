import { ImageResponse } from 'next/og';
import { ogFallbacks } from '@/content/og';
import { serviceAreas } from '@/content/services';
import { COMPANY_ACCENT, OG_CONTENT_TYPE, OG_SIZE, clamp, renderOgCard } from '@/lib/og-card';

export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;
export const alt = ogFallbacks.service.alt;

export function generateStaticParams() {
  return serviceAreas.map((service) => ({ slug: service.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const service = serviceAreas.find((item) => item.slug === slug);

  return new ImageResponse(
    renderOgCard({
      eyebrow: service?.eyebrow ?? ogFallbacks.service.eyebrow,
      title: service?.title ?? ogFallbacks.service.title,
      subtitle: service ? clamp(service.summary) : undefined,
      accent: service ? COMPANY_ACCENT[service.companySlug] : undefined,
    }),
    size,
  );
}
