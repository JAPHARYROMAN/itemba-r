import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { companies, getCompanyBySlug } from '@/content/companies';
import { crumbs } from '@/content/nav';
import { companyUrl } from '@/content/site';
import { companyJsonLd, faqPageJsonLd } from '@/lib/jsonld';
import { pageMetadata } from '@/lib/seo';
import { CompanyEnquire } from '@/sections/company/CompanyEnquire';
import { CompanyFaqs } from '@/sections/company/CompanyFaqs';
import { CompanyGlance } from '@/sections/company/CompanyGlance';
import { CompanyHero } from '@/sections/company/CompanyHero';
import { CompanySites } from '@/sections/company/CompanySites';
import { CompanyStrengths } from '@/sections/company/CompanyStrengths';
import { CompanySubNav } from '@/sections/company/CompanySubNav';
import { CompanyWhatWeDo } from '@/sections/company/CompanyWhatWeDo';
import { FooterTrail } from '@/shell/SiteFooter';
import { StructuredData } from '@/ui';

type PageProps = {
  params: Promise<{ slug: string }>;
};

/** Only the three company slugs exist; anything else is a 404 at build time. */
export const dynamicParams = false;

export function generateStaticParams() {
  return companies.map((company) => ({ slug: company.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const company = getCompanyBySlug(slug);
  if (!company) return {};
  return pageMetadata({
    title: company.name,
    description: company.metaDescription,
    path: companyUrl(company.slug),
  });
}

/**
 * A company page (/companies/mwanjalisi-oil, /westsides-company,
 * /itemba-enterprises), in the company's accent: the sticky sub-nav, then
 * hero, at a glance, what we do, brands and sites, key strengths, FAQs and
 * the enquiry form preset to the company. The breadcrumb trail (and its
 * BreadcrumbList) closes the page above the footer, as on Apple's pages.
 * The page shows one legal-name form, the registered name in "At a
 * glance"; the h1 and the trail use the short name.
 */
export default async function CompanyPage({ params }: PageProps) {
  const { slug } = await params;
  const company = getCompanyBySlug(slug);
  if (!company) notFound();

  return (
    <>
      <StructuredData data={[companyJsonLd(company), faqPageJsonLd(company.faqs)]} />
      <CompanySubNav company={company} />
      <CompanyHero company={company} />
      <CompanyGlance company={company} />
      <CompanyWhatWeDo company={company} />
      <CompanySites company={company} />
      <CompanyStrengths company={company} />
      <CompanyFaqs company={company} />
      <CompanyEnquire company={company} />
      <FooterTrail
        items={[crumbs.home, crumbs.companies, { name: company.shortName, path: companyUrl(company.slug) }]}
      />
    </>
  );
}
