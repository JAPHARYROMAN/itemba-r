import { locationProfiles } from '@/content/locations';
import { ogFallbacks } from '@/content/og';
import { OG_CONTENT_TYPE, OG_SIZE, clamp, ogImageResponse } from '@/lib/og-card';

export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;
export const alt = ogFallbacks.location.alt;

export function generateStaticParams() {
  return locationProfiles.map((location) => ({ slug: location.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const location = locationProfiles.find((item) => item.slug === slug);

  return ogImageResponse({
    eyebrow: location?.eyebrow ?? ogFallbacks.location.eyebrow,
    title: location?.title ?? ogFallbacks.location.title,
    subtitle: location ? clamp(location.summary) : undefined,
  });
}
