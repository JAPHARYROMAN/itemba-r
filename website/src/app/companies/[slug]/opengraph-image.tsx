import { ImageResponse } from 'next/og';
import { companyProfiles } from '@/lib/site';
import { COMPANY_ACCENT, OG_CONTENT_TYPE, OG_SIZE, clamp, renderOgCard } from '@/lib/og-card';

export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Itemba Group company profile';

export function generateStaticParams() {
  return companyProfiles.map((company) => ({ slug: company.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const company = companyProfiles.find((item) => item.slug === slug);

  return new ImageResponse(
    renderOgCard({
      eyebrow: company?.eyebrow ?? 'Our Companies',
      title: company?.name ?? 'Itemba Group',
      subtitle: company ? clamp(company.sector) : undefined,
      accent: COMPANY_ACCENT[slug],
    }),
    size,
  );
}
