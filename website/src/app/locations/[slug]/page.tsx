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
  companyUrl,
  contact,
  faqJsonLd,
  locationProfiles,
  locationUrl,
  serviceAreas,
  serviceUrl,
  site,
} from '@/lib/site';

type PageProps = {
  params: Promise<{ slug: string }>;
};

function getLocation(slug: string) {
  return locationProfiles.find((location) => location.slug === slug);
}

export function generateStaticParams() {
  return locationProfiles.map((location) => ({ slug: location.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const location = getLocation(slug);

  if (!location) {
    return {};
  }

  const url = absoluteUrl(locationUrl(location.slug));

  return {
    title: location.shortTitle,
    description: location.metaDescription,
    keywords: location.searchTerms,
    alternates: { canonical: url },
    openGraph: {
      title: `${location.title} | ${site.name}`,
      description: location.metaDescription,
      url,
      type: 'website',
    },
  };
}

export default async function LocationPage({ params }: PageProps) {
  const { slug } = await params;
  const location = getLocation(slug);

  if (!location) {
    notFound();
  }

  const relatedServices = serviceAreas.filter((service) => location.serviceSlugs.includes(service.slug));
  const relatedCompanies = companyProfiles.filter((company) => location.companySlugs.includes(company.slug));
  const pageUrl = absoluteUrl(locationUrl(location.slug));
  const locationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    '@id': `${pageUrl}#place`,
    name: location.title,
    url: pageUrl,
    description: location.metaDescription,
    address: {
      '@type': 'PostalAddress',
      streetAddress: contact.headOffice,
      addressLocality: 'Tunduma',
      addressRegion: 'Songwe',
      addressCountry: 'TZ',
      postOfficeBoxNumber: contact.postal,
    },
    containedInPlace: {
      '@type': 'AdministrativeArea',
      name: 'Songwe Region',
    },
  };
  const localBusinessJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${pageUrl}#business`,
    name: site.name,
    url: site.url,
    image: absoluteUrl('/opengraph-image'),
    telephone: contact.primaryPhoneDisplay,
    email: contact.email,
    address: locationJsonLd.address,
    parentOrganization: {
      '@id': `${site.url}/#organization`,
    },
    areaServed: ['Songwe Region', 'Tunduma', 'Mpemba', 'Tanzania-Zambia corridor'],
    makesOffer: relatedServices.map((service) => ({
      '@type': 'Offer',
      itemOffered: {
        '@type': 'Service',
        name: service.title,
        url: absoluteUrl(serviceUrl(service.slug)),
      },
    })),
  };

  return (
    <>
      <JsonLd
        data={[
          locationJsonLd,
          localBusinessJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Locations', path: '/locations' },
            { name: location.shortTitle, path: locationUrl(location.slug) },
          ]),
          faqJsonLd(location.faqs),
        ]}
      />

      <section className="relative overflow-hidden bg-ink-900 px-5 pb-20 pt-40 sm:px-8">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.55 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <AnimatedSection>
            <Link href="/locations" className="text-sm font-semibold text-gold-400 hover:text-gold-300">
              All locations
            </Link>
            <p className="mb-4 mt-8 text-xs font-semibold uppercase tracking-widest text-gold-400">
              {location.eyebrow}
            </p>
            <h1
              className="mb-6 font-tight font-black leading-none tracking-tightest text-white"
              style={{ fontSize: 'clamp(2.8rem, 6vw, 5.5rem)' }}
            >
              {location.title}
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-slate-300">{location.summary}</p>
          </AnimatedSection>
          <AnimatedSection direction="left">
            <div className="relative h-80 overflow-hidden rounded-3xl shadow-2xl">
              <BrandVisual variant={location.visual} label={`${location.title} operations`} className="absolute inset-0" />
              <div className="absolute inset-0 bg-gradient-to-br from-ink-950/30 to-transparent" />
            </div>
          </AnimatedSection>
        </div>
      </section>

      <section className="bg-white px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <AnimatedSection>
              <div className="gold-line mb-6" />
              <h2 className="mb-5 font-tight text-3xl font-black leading-tight tracking-tighter text-ink-900 sm:text-4xl">
                Why This Location Matters
              </h2>
              <p className="mb-8 text-lg leading-relaxed text-slate-600">{location.detail}</p>
            </AnimatedSection>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {location.advantages.map((advantage, index) => (
                <AnimatedSection key={advantage.title} delay={index * 0.06}>
                  <div className="h-full rounded-2xl border border-slate-200 bg-slate-50 p-6">
                    <h3 className="mb-3 font-tight text-lg font-bold text-ink-900">{advantage.title}</h3>
                    <p className="text-sm leading-relaxed text-slate-600">{advantage.summary}</p>
                  </div>
                </AnimatedSection>
              ))}
            </div>

            <AnimatedSection className="mt-14">
              <div className="gold-line mb-6" />
              <h2 className="mb-5 font-tight text-3xl font-black leading-tight tracking-tighter text-ink-900 sm:text-4xl">
                Services Available Through This Location
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {relatedServices.map((service) => (
                  <Link
                    key={service.slug}
                    href={serviceUrl(service.slug)}
                    className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-gold-400 hover:shadow-md"
                  >
                    <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">{service.eyebrow}</p>
                    <h3 className="mb-2 font-tight text-lg font-bold text-ink-900">{service.title}</h3>
                    <p className="text-sm leading-relaxed text-slate-600">{service.summary}</p>
                  </Link>
                ))}
              </div>
            </AnimatedSection>

            <AnimatedSection className="mt-14">
              <div className="gold-line mb-6" />
              <h2 className="mb-5 font-tight text-3xl font-black leading-tight tracking-tighter text-ink-900 sm:text-4xl">
                Location Questions
              </h2>
              <FaqList faqs={location.faqs} />
            </AnimatedSection>
          </div>

          <aside className="space-y-6">
            <AnimatedSection direction="left" delay={0.08}>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <iframe
                  title="Itemba Group Songwe-Tunduma location map"
                  src={`https://www.google.com/maps?q=${encodeURIComponent(contact.mapQuery)}&output=embed`}
                  className="h-72 w-full"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
                <div className="p-6">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">Address</p>
                  <address className="not-italic text-sm leading-relaxed text-slate-600">
                    {location.addressLines.map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
                  </address>
                </div>
              </div>
            </AnimatedSection>

            <AnimatedSection direction="left" delay={0.14}>
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Operating Companies
                </p>
                <div className="space-y-3">
                  {relatedCompanies.map((company) => (
                    <Link
                      key={company.slug}
                      href={companyUrl(company.slug)}
                      className="block rounded-xl bg-slate-50 p-4 transition hover:bg-slate-100"
                    >
                      <div className="font-tight text-sm font-bold text-ink-900">{company.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{company.sector}</div>
                    </Link>
                  ))}
                </div>
              </div>
            </AnimatedSection>

            <AnimatedSection direction="left" delay={0.2}>
              <EnquiryRouter
                compact
                title="Ask about this location"
                description="Contact the group office for enquiries connected to the Songwe-Tunduma operating base."
              />
            </AnimatedSection>
          </aside>
        </div>
      </section>
    </>
  );
}
