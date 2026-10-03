import type { Metadata } from 'next';
import { crumbs } from '@/content/nav';
import { serviceAreas, servicesPage } from '@/content/services';
import { serviceUrl } from '@/content/site';
import { webPageJsonLd } from '@/lib/jsonld';
import { pageMetadata } from '@/lib/seo';
import { ServicesClosing } from '@/sections/services/ServicesClosing';
import { ServicesDirectory } from '@/sections/services/ServicesDirectory';
import { ServicesHero } from '@/sections/services/ServicesHero';
import { FooterTrail } from '@/shell/SiteFooter';
import { StructuredData } from '@/ui';

const { meta } = servicesPage;

export const metadata: Metadata = pageMetadata({
  title: meta.title,
  description: meta.description,
  path: '/services',
  ogTitle: meta.ogTitle,
  ogDescription: meta.ogDescription,
});

/**
 * /services, a server component: the hero, the six services grouped under
 * the company that runs each (the sector bento), and the closing call to
 * action. The CollectionPage keeps its baseline @id (…/services#services)
 * and lists the six service pages; the breadcrumb trail (and the page's
 * only BreadcrumbList) closes the page above the footer. No enquiry form
 * here, so the quick-contact bar stays.
 */
export default function ServicesPage() {
  return (
    <>
      <StructuredData
        data={webPageJsonLd({
          type: 'CollectionPage',
          name: meta.ogTitle,
          path: '/services',
          fragment: 'services',
          description: meta.description,
          items: serviceAreas.map((service) => ({ name: service.title, path: serviceUrl(service.slug) })),
        })}
      />
      <ServicesHero />
      <ServicesDirectory />
      <ServicesClosing />
      <FooterTrail items={[crumbs.home, crumbs.services]} />
    </>
  );
}
