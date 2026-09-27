import type { Metadata } from 'next';
import { capabilitiesPage } from '@/content/capabilities';
import { crumbs } from '@/content/nav';
import { serviceAreas } from '@/content/services';
import { serviceUrl } from '@/content/site';
import { webPageJsonLd } from '@/lib/jsonld';
import { pageMetadata } from '@/lib/seo';
import { CapabilitiesDiligence } from '@/sections/capabilities/CapabilitiesDiligence';
import { CapabilitiesEnquire } from '@/sections/capabilities/CapabilitiesEnquire';
import { CapabilitiesHero } from '@/sections/capabilities/CapabilitiesHero';
import { CapabilitiesMap } from '@/sections/capabilities/CapabilitiesMap';
import { CapabilitiesSignals } from '@/sections/capabilities/CapabilitiesSignals';
import { FooterTrail } from '@/shell/SiteFooter';
import { StructuredData } from '@/ui';

const { meta } = capabilitiesPage;
const crumb = crumbs.capabilities;

export const metadata: Metadata = pageMetadata({
  title: meta.title,
  description: meta.description,
  path: crumb.path,
  ogTitle: meta.ogTitle,
  ogDescription: meta.ogDescription,
});

/**
 * /capabilities, an Apple support-style page for anyone checking the fit
 * before an enquiry: the hero with a shortcut to each service, the four
 * verification signals (bento), the capability map (who runs each service
 * and who usually asks), the due-diligence path (the one cinema tile) and
 * the full enquiry form, for the general route. The CollectionPage lists
 * the six services, as on origin/main; the trail closes the page above the
 * footer and carries its BreadcrumbList.
 */
export default function CapabilitiesPage() {
  return (
    <>
      <StructuredData
        data={[
          webPageJsonLd({
            type: 'CollectionPage',
            name: meta.ogTitle,
            path: crumb.path,
            fragment: 'capabilities',
            description: meta.description,
            items: serviceAreas.map((service) => ({
              name: service.title,
              path: serviceUrl(service.slug),
              description: service.summary,
            })),
          }),
        ]}
      />
      <CapabilitiesHero />
      <CapabilitiesSignals />
      <CapabilitiesMap />
      <CapabilitiesDiligence />
      <CapabilitiesEnquire />
      <FooterTrail items={[crumbs.home, crumb]} />
    </>
  );
}
