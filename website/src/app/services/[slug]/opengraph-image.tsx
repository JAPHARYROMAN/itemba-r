import { ImageResponse } from 'next/og';
import { serviceAreas } from '@/lib/site';
import { COMPANY_ACCENT, OG_CONTENT_TYPE, OG_SIZE, clamp, renderOgCard } from '@/lib/og-card';

export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Itemba Group service area';

export function generateStaticParams() {
  return serviceAreas.map((service) => ({ slug: service.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const service = serviceAreas.find((item) => item.slug === slug);

  return new ImageResponse(
    renderOgCard({
      eyebrow: service?.eyebrow ?? 'Services',
      title: service?.title ?? 'Itemba Group Services',
      subtitle: service ? clamp(service.summary) : undefined,
      accent: service ? COMPANY_ACCENT[service.companySlug] : undefined,
    }),
    size,
  );
}
