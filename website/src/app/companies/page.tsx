import type { Metadata } from 'next';
import { companies, companiesPage } from '@/content/companies';
import { crumbs } from '@/content/nav';
import { companyUrl } from '@/content/site';
import { webPageJsonLd } from '@/lib/jsonld';
import { pageMetadata } from '@/lib/seo';
import { CompaniesGlance } from '@/sections/companies/CompaniesGlance';
import { CompaniesHero } from '@/sections/companies/CompaniesHero';
import { CompaniesTiles } from '@/sections/companies/CompaniesTiles';
import { FooterTrail } from '@/shell/SiteFooter';
import { StructuredData } from '@/ui';

const { meta } = companiesPage;

export const metadata: Metadata = pageMetadata({
  title: meta.title,
  description: meta.description,
  path: crumbs.companies.path,
  ogTitle: meta.ogTitle,
  ogDescription: meta.ogDescription,
});

/**
 * /companies, a server component: the index of the three legally
 * independent companies. The hero and its jump row, the three company tiles
 * (home's own component; anchors #mwanjalisi, #westsides, #enterprises),
 * then the three side by side ("At a glance") with the group's routing
 * promise. The page adds a CollectionPage listing the companies; the trail
 * (and the page's only BreadcrumbList) closes it above the footer. No
 * enquiry form: each tile's "Enquire" opens its company's form, and the
 * quick-contact bar stays (QuickContact's route matrix).
 */
export default function CompaniesPage() {
  return (
    <>
      <StructuredData
        data={webPageJsonLd({
          type: 'CollectionPage',
          name: meta.ogTitle,
          path: crumbs.companies.path,
          description: meta.description,
          items: companies.map((company) => ({
            name: company.name,
            path: companyUrl(company.slug),
            description: company.metaDescription,
          })),
        })}
      />
      <CompaniesHero />
      <CompaniesTiles />
      <CompaniesGlance />
      <FooterTrail items={[crumbs.home, crumbs.companies]} />
    </>
  );
}
