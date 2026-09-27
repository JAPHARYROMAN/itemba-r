import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocationBySlug, locationPageCopy, locationProfiles } from '@/content/locations';
import { crumbs } from '@/content/nav';
import { locationUrl, site } from '@/content/site';
import { faqPageJsonLd, headOfficeJsonLd, placeJsonLd } from '@/lib/jsonld';
import { pageMetadata } from '@/lib/seo';
import { LocationCompanies } from '@/sections/locations/LocationCompanies';
import { LocationEnquire } from '@/sections/locations/LocationEnquire';
import { LocationFaqs } from '@/sections/locations/LocationFaqs';
import { LocationGlance } from '@/sections/locations/LocationGlance';
import { LocationHero } from '@/sections/locations/LocationHero';
import { LocationServices } from '@/sections/locations/LocationServices';
import { LocationVisit } from '@/sections/locations/LocationVisit';
import { LocationWhy } from '@/sections/locations/LocationWhy';
import { locationSectionIds } from '@/sections/locations/ids';
import { FooterTrail } from '@/shell/SiteFooter';
import { StructuredData } from '@/ui';

type PageProps = {
  params: Promise<{ slug: string }>;
};

/** Only the location slugs exist; anything else is a 404 at build time. */
export const dynamicParams = false;

export function generateStaticParams() {
  return locationProfiles.map((location) => ({ slug: location.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const location = getLocationBySlug(slug);
  if (!location) return {};
  return pageMetadata({
    title: location.shortTitle,
    description: location.metaDescription,
    path: locationUrl(location.slug),
    ogTitle: `${location.title} | ${site.name}`,
    keywords: location.searchTerms,
  });
}

/**
 * A location profile (/locations/songwe-tunduma), a server component: the
 * hero, at a glance, where to find the head office (address, directions,
 * the map facade), why the location matters (a bento), its services, the
 * companies behind them, its questions, and the compact enquiry form
 * (general intent). The quick-contact bar steps aside on this route (it has
 * a form). Place, the head office's LocalBusiness and the FAQPage describe
 * the page; the breadcrumb trail (and its BreadcrumbList) closes it.
 */
export default async function LocationPage({ params }: PageProps) {
  const { slug } = await params;
  const location = getLocationBySlug(slug);
  if (!location) notFound();

  return (
    <>
      <StructuredData data={[placeJsonLd(location), headOfficeJsonLd(location), faqPageJsonLd(location.faqs)]} />
      <LocationHero location={location} />
      <LocationGlance location={location} />
      <LocationVisit location={location} />
      <LocationWhy location={location} />
      <LocationServices
        location={location}
        id={locationSectionIds.services}
        titleId="services-title"
        title={locationPageCopy.servicesHeading}
        tone="alt"
      />
      <LocationCompanies location={location} />
      <LocationFaqs location={location} />
      <LocationEnquire />
      <FooterTrail items={[crumbs.home, crumbs.locations, { name: location.shortTitle, path: locationUrl(location.slug) }]} />
    </>
  );
}
