import { ImageResponse } from 'next/og';
import { locationProfiles } from '@/lib/site';
import { OG_CONTENT_TYPE, OG_SIZE, clamp, renderOgCard } from '@/lib/og-card';

export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Itemba Group location';

export function generateStaticParams() {
  return locationProfiles.map((location) => ({ slug: location.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const location = locationProfiles.find((item) => item.slug === slug);

  return new ImageResponse(
    renderOgCard({
      eyebrow: location?.eyebrow ?? 'Locations',
      title: location?.title ?? 'Itemba Group Location',
      subtitle: location ? clamp(location.summary) : undefined,
    }),
    size,
  );
}
