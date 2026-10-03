import type { Metadata } from 'next';
import { partnershipFaqs } from '@/content/faqs';
import { crumbs } from '@/content/nav';
import { partnershipAreas, partnershipsPage } from '@/content/partnerships';
import { faqPageJsonLd, webPageJsonLd } from '@/lib/jsonld';
import { pageMetadata } from '@/lib/seo';
import { PartnershipsEnquire } from '@/sections/partnerships/PartnershipsEnquire';
import { PartnershipsFaqs } from '@/sections/partnerships/PartnershipsFaqs';
import { PartnershipsHero } from '@/sections/partnerships/PartnershipsHero';
import { PartnershipsProcess } from '@/sections/partnerships/PartnershipsProcess';
import { PartnershipsRoutes } from '@/sections/partnerships/PartnershipsRoutes';
import { FooterTrail } from '@/shell/SiteFooter';
import { StructuredData } from '@/ui';

const { meta } = partnershipsPage;
const crumb = crumbs.partnerships;

export const metadata: Metadata = pageMetadata({
  title: meta.title,
  description: meta.description,
  path: crumb.path,
  ogTitle: meta.ogTitle,
  ogDescription: meta.ogDescription,
});

/**
 * /partnerships, an Apple support-style page for suppliers, buyers and
 * partners: the hero with a shortcut to each route, the four partnership
 * routes, how an enquiry moves (the one cinema tile), the partnership
 * questions and the full enquiry form, for the general route. The WebPage
 * lists the four routes (each now with its card's URL) and the FAQPage the
 * four questions shown; the trail closes the page above the footer and
 * carries its BreadcrumbList.
 */
export default function PartnershipsPage() {
  return (
    <>
      <StructuredData
        data={[
          webPageJsonLd({
            type: 'WebPage',
            name: meta.ogTitle,
            path: crumb.path,
            fragment: 'partnerships',
            description: meta.description,
            items: partnershipAreas.map((area) => ({
              name: area.title,
              path: `${crumb.path}#${area.id}`,
              description: area.summary,
            })),
          }),
          faqPageJsonLd(partnershipFaqs),
        ]}
      />
      <PartnershipsHero />
      <PartnershipsRoutes />
      <PartnershipsProcess />
      <PartnershipsFaqs />
      <PartnershipsEnquire />
      <FooterTrail items={[crumbs.home, crumb]} />
    </>
  );
}
