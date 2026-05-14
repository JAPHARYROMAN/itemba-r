import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import AnimatedSection from '@/components/AnimatedSection';
import BrandVisual from '@/components/BrandVisual';
import EnquiryRouter from '@/components/EnquiryRouter';
import FaqList from '@/components/FaqList';
import JsonLd from '@/components/JsonLd';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  companyProfiles,
  contact,
  faqJsonLd,
  site,
} from '@/lib/site';

type PageProps = {
  params: Promise<{ slug: string }>;
};

function getCompany(slug: string) {
  return companyProfiles.find((company) => company.slug === slug);
}

export function generateStaticParams() {
  return companyProfiles.map((company) => ({ slug: company.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const company = getCompany(slug);

  if (!company) {
    return {};
  }

  const url = absoluteUrl(`/companies/${company.slug}`);

  return {
    title: company.name,
    description: company.metaDescription,
    alternates: { canonical: url },
    openGraph: {
      title: `${company.name} | ${site.name}`,
      description: company.metaDescription,
      url,
      type: 'website',
    },
  };
}

export default async function CompanyProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const company = getCompany(slug);

  if (!company) {
    notFound();
  }

  const pageUrl = absoluteUrl(`/companies/${company.slug}`);
  const businessJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${pageUrl}#business`,
    name: company.name,
    url: pageUrl,
    image: absoluteUrl('/opengraph-image'),
    description: company.metaDescription,
    parentOrganization: {
      '@type': 'Organization',
      name: site.name,
      url: site.url,
    },
    address: {
      '@type': 'PostalAddress',
      streetAddress: contact.headOffice,
      addressLocality: 'Tunduma',
      addressRegion: 'Songwe',
      addressCountry: 'TZ',
    },
    telephone: contact.primaryPhoneDisplay,
    email: contact.email,
    areaServed: ['Songwe Region', 'Tunduma', 'Tanzania-Zambia corridor'],
    makesOffer: company.services.map((service) => ({
      '@type': 'Offer',
      itemOffered: {
        '@type': 'Service',
        name: service,
      },
    })),
  };

  return (
    <>
      <JsonLd
        data={[
          businessJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Companies', path: '/companies' },
            { name: company.name, path: `/companies/${company.slug}` },
          ]),
          faqJsonLd(company.faqs),
        ]}
      />
      <section className="relative bg-ink-900 pt-40 pb-20 px-5 sm:px-8 overflow-hidden">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.55 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 max-w-7xl mx-auto">
          <AnimatedSection delay={0}>
            <Link href="/companies" className="text-sm font-semibold text-gold-400 hover:text-gold-300">
              All companies
            </Link>
          </AnimatedSection>
          <AnimatedSection delay={0.08}>
            <p className="mt-8 text-gold-400 text-xs font-semibold uppercase tracking-widest mb-4">{company.eyebrow}</p>
            <h1
              className="font-tight font-black text-white leading-none tracking-tightest mb-6"
              style={{ fontSize: 'clamp(2.8rem, 6vw, 5.5rem)' }}
            >
              {company.name}
            </h1>
            <p className="text-slate-300 text-lg max-w-2xl leading-relaxed">{company.summary}</p>
          </AnimatedSection>
        </div>
      </section>

      <section className="bg-white px-5 py-24 sm:px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-12">
          <div className="lg:col-span-2">
            <AnimatedSection>
              <div className="relative h-72 sm:h-96 rounded-3xl overflow-hidden shadow-2xl mb-12 img-zoom">
                <BrandVisual variant={company.visual} label={`${company.name} operations`} className="absolute inset-0 img-inner" />
                <div className="absolute inset-0 bg-gradient-to-r from-ink-950/80 via-ink-950/20 to-transparent" />
              </div>
            </AnimatedSection>

            <AnimatedSection delay={0.08}>
              <div className="gold-line mb-6" />
              <h2 className="font-tight font-black text-ink-900 text-3xl sm:text-4xl leading-tight tracking-tighter mb-5">
                Services and Market Focus
              </h2>
              <p className="text-slate-600 text-lg leading-relaxed mb-5">{company.detail}</p>
            </AnimatedSection>

            <AnimatedSection delay={0.14}>
              <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {company.services.map((service) => (
                  <div key={service} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <div className="text-sm font-semibold text-ink-900">{service}</div>
                  </div>
                ))}
              </div>
            </AnimatedSection>

            <AnimatedSection delay={0.18}>
              <div className="mt-14">
                <div className="gold-line mb-6" />
                <h2 className="font-tight font-black text-ink-900 text-3xl sm:text-4xl leading-tight tracking-tighter mb-5">
                  Frequently Asked Questions
                </h2>
                <FaqList faqs={company.faqs} />
              </div>
            </AnimatedSection>
          </div>

          <aside className="space-y-6">
            <AnimatedSection direction="left" delay={0.08}>
              <div className={`border-l-2 ${company.accentBorder} pl-5 space-y-5`}>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Sector</div>
                  <div className={`font-semibold text-sm ${company.accentClass}`}>{company.sector}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Structure</div>
                  <div className="font-semibold text-sm text-ink-900">Subsidiary of Itemba Group</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Location</div>
                  <div className="font-semibold text-sm text-ink-900">Songwe Region, Tanzania</div>
                </div>
              </div>
            </AnimatedSection>

            <AnimatedSection direction="left" delay={0.14}>
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">Key strengths</p>
                <div className="space-y-3">
                  {company.highlights.map((highlight) => (
                    <div key={highlight} className="flex gap-3 text-sm text-slate-600">
                      <span className={`mt-1.5 h-2 w-2 rounded-full ${company.accentBg} flex-shrink-0`} />
                      <span>{highlight}</span>
                    </div>
                  ))}
                </div>
              </div>
            </AnimatedSection>

            <AnimatedSection direction="left" delay={0.2}>
              <EnquiryRouter
                compact
                defaultIntentId={company.id}
                title={company.enquiryLabel}
                description="Contact the group office with a prepared message that can be routed to the relevant operating team."
              />
            </AnimatedSection>
          </aside>
        </div>
      </section>
    </>
  );
}
