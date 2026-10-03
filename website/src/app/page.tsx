import type { Metadata } from 'next';
import { site } from '@/content/site';
import { pageMetadata } from '@/lib/seo';
import { HomeClosing } from '@/sections/home/HomeClosing';
import { HomeCompanies } from '@/sections/home/HomeCompanies';
import { HomeCorridor } from '@/sections/home/HomeCorridor';
import { HomeHero } from '@/sections/home/HomeHero';
import { HomeInsights } from '@/sections/home/HomeInsights';
import { HomeNumbers } from '@/sections/home/HomeNumbers';
import { HomeSectors } from '@/sections/home/HomeSectors';
import { HomeStatement } from '@/sections/home/HomeStatement';

/**
 * Home's own metadata. The site title stands alone (no "| Itemba Group"
 * suffix), and the description is the flag-resolved group description
 * (no manufacturing: flags.mentionManufacturing).
 */
export const metadata: Metadata = pageMetadata({
  title: { absolute: site.title },
  description: site.description,
  path: '/',
  ogDescription: site.shortDescription,
});

/**
 * Home, a server component. One idea per screen, in the plan's order:
 * hero, statement, the three companies, six sectors, the corridor, the
 * numbers, insights and the closing call to action. The group's
 * Organization and WebSite JSON-LD come from the root layout.
 */
export default function HomePage() {
  return (
    <>
      <HomeHero />
      <HomeStatement />
      <HomeCompanies />
      <HomeSectors />
      <HomeCorridor />
      <HomeNumbers />
      <HomeInsights />
      <HomeClosing />
    </>
  );
}
