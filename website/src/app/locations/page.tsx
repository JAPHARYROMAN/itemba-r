import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { locationProfiles, locationsPage } from '@/content/locations';
import { crumbs } from '@/content/nav';
import { locationUrl } from '@/content/site';
import { webPageJsonLd } from '@/lib/jsonld';
import { pageMetadata } from '@/lib/seo';
import { HomeCorridor } from '@/sections/home/HomeCorridor';
import { LocationServices } from '@/sections/locations/LocationServices';
import { LocationsClosing } from '@/sections/locations/LocationsClosing';
import { LocationsHeadquarters } from '@/sections/locations/LocationsHeadquarters';
import { LocationsHero } from '@/sections/locations/LocationsHero';
import { FooterTrail } from '@/shell/SiteFooter';
import { StructuredData } from '@/ui';

const { meta } = locationsPage;

export const metadata: Metadata = pageMetadata({
  title: meta.title,
  description: meta.description,
  path: '/locations',
  ogTitle: meta.ogTitle,
  ogDescription: meta.ogDescription,
});

/**
 * /locations, a server component: where the group is based and why it
 * matters. The hero (the Songwe landscape, credited), the corridor story
 * (home's signature section, reused: Dar es Salaam to the border and
 * beyond), the head office as a store-style card, the services connected
 * to it, and a closing call to action. No enquiry form on this page, so the
 * quick-contact bar shows. The CollectionPage lists the location profiles;
 * the breadcrumb trail (and its BreadcrumbList) closes the page.
 */
export default function LocationsPage() {
  const [location] = locationProfiles;
  if (!location) notFound();
  return (
    <>
      <StructuredData
        data={webPageJsonLd({
          type: 'CollectionPage',
          name: meta.ogTitle,
          path: '/locations',
          fragment: 'locations',
          description: meta.ogDescription,
          items: locationProfiles.map((profile) => ({ name: profile.title, path: locationUrl(profile.slug) })),
        })}
      />
      <LocationsHero location={location} />
      <HomeCorridor />
      <LocationsHeadquarters location={location} />
      <LocationServices
        location={location}
        titleId="services-title"
        title={locationsPage.servicesHeading}
        lede={locationsPage.servicesLede}
        tone="alt"
      />
      <LocationsClosing />
      <FooterTrail items={[crumbs.home, crumbs.locations]} />
    </>
  );
}
