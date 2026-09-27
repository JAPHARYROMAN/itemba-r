import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCompanyBySlug } from '@/content/companies';
import { crumbs } from '@/content/nav';
import { getServiceBySlug, serviceAreas } from '@/content/services';
import { serviceUrl } from '@/content/site';
import { faqPageJsonLd, serviceJsonLd } from '@/lib/jsonld';
import { pageMetadata } from '@/lib/seo';
import { ServiceCompany } from '@/sections/services/ServiceCompany';
import { ServiceEnquire } from '@/sections/services/ServiceEnquire';
import { ServiceFaqs } from '@/sections/services/ServiceFaqs';
import { ServiceHero } from '@/sections/services/ServiceHero';
import { ServiceOfferings } from '@/sections/services/ServiceOfferings';
import { ServiceSubNav } from '@/sections/services/ServiceSubNav';
import { ServiceWhere } from '@/sections/services/ServiceWhere';
import { FooterTrail } from '@/shell/SiteFooter';
import { StructuredData } from '@/ui';

type PageProps = {
  params: Promise<{ slug: string }>;
};

/** Only the six service slugs exist; anything else is a 404 at build time. */
export const dynamicParams = false;

export function generateStaticParams() {
  return serviceAreas.map((service) => ({ slug: service.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const service = getServiceBySlug(slug);
  if (!service) return {};
  return pageMetadata({
    title: service.title,
    description: service.metaDescription,
    path: serviceUrl(service.slug),
    keywords: service.keywords,
  });
}

/**
 * A service page (/services/fuel-and-lubricants and five more), in the
 * accent of the company that runs it, on the company template: the sticky
 * sub-nav, then hero, what it covers, where it runs (the fuel page's
 * stations showcase; the logistics route), the company behind it, FAQs and
 * the enquiry form preset to service.intentId. The Service keeps its
 * baseline @id (…#service), with the company as provider; the breadcrumb
 * trail (and its BreadcrumbList) closes the page above the footer.
 */
export default async function ServicePage({ params }: PageProps) {
  const { slug } = await params;
  const service = getServiceBySlug(slug);
  const company = service ? getCompanyBySlug(service.companySlug) : undefined;
  if (!service || !company) notFound();

  return (
    <>
      <StructuredData data={[serviceJsonLd(service), faqPageJsonLd(service.faqs)]} />
      <ServiceSubNav service={service} company={company} />
      <ServiceHero service={service} company={company} />
      <ServiceOfferings service={service} company={company} />
      <ServiceWhere service={service} company={company} />
      <ServiceCompany service={service} company={company} />
      <ServiceFaqs service={service} />
      <ServiceEnquire service={service} company={company} />
      <FooterTrail items={[crumbs.home, crumbs.services, { name: service.title, path: serviceUrl(service.slug) }]} />
    </>
  );
}
