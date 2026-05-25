import Link from 'next/link';
import type { Metadata } from 'next';
import AnimatedSection from '@/components/AnimatedSection';
import BrandVisual from '@/components/BrandVisual';
import JsonLd from '@/components/JsonLd';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  companyUrl,
  serviceAreas,
  serviceUrl,
  site,
} from '@/lib/site';

export const metadata: Metadata = {
  title: 'Services',
  description:
    'Explore Itemba Group services across fuel, trade distribution, logistics, construction supplies, hospitality, and real estate in Tanzania.',
  alternates: { canonical: absoluteUrl('/services') },
  openGraph: {
    title: 'Itemba Group Services',
    description:
      'Fuel, trade distribution, logistics, construction supplies, hospitality, and property services from Itemba Group companies.',
    url: absoluteUrl('/services'),
  },
};

const servicesJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  '@id': `${absoluteUrl('/services')}#services`,
  name: 'Itemba Group Services',
  url: absoluteUrl('/services'),
  about: {
    '@id': `${site.url}/#organization`,
  },
  mainEntity: {
    '@type': 'ItemList',
    itemListElement: serviceAreas.map((service, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: service.title,
      url: absoluteUrl(serviceUrl(service.slug)),
    })),
  },
};

const serviceHeroImages = [
  {
    src: '/images/fuel-stations/itemba-filling-station-wide.webp',
    alt: 'ITEMBA filling station forecourt',
  },
  {
    src: '/images/beverages/westsides-warehouse-stock-wide.webp',
    alt: 'Westsides wholesale beverage warehouse stock',
  },
  {
    src: '/images/logistics/itemba-logistics-tanker-under-canopy.webp',
    alt: 'Itemba Logistics tanker truck',
  },
  {
    src: '/images/hardware/itemba-hardware-storefront.webp',
    alt: 'ITEMBA-HARDWARE storefront and construction supply stock',
  },
] as const;

export default function ServicesPage() {
  return (
    <>
      <JsonLd
        data={[
          servicesJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Services', path: '/services' },
          ]),
        ]}
      />

      <section className="relative overflow-hidden bg-ink-900 px-5 pb-24 pt-40 sm:px-8">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.55 }} />
          <div className="hero-orb hero-orb-blue" style={{ opacity: 0.35 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <AnimatedSection>
            <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">
              Services and Capabilities
            </p>
            <h1
              className="mb-6 font-tight font-black leading-none tracking-tightest text-white"
              style={{ fontSize: 'clamp(2.8rem, 6vw, 5.5rem)' }}
            >
              Search by Need.<br />
              <span className="gradient-text">Find the Right Team.</span>
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-slate-300">
              Itemba Group operates through specialised companies and divisions. These
              service pages help customers, suppliers, and partners find the right route
              into the group.
            </p>
          </AnimatedSection>
          <AnimatedSection direction="fade">
            <div className="grid h-80 grid-cols-2 gap-3 overflow-hidden rounded-3xl bg-ink-950 p-3 shadow-2xl ring-1 ring-white/10">
              {serviceHeroImages.map((image) => (
                <div key={image.src} className="relative overflow-hidden rounded-2xl bg-ink-900">
                  <img
                    src={image.src}
                    alt={image.alt}
                    className="h-full w-full object-contain"
                    loading="eager"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-ink-950/45 via-transparent to-transparent" />
                </div>
              ))}
            </div>
          </AnimatedSection>
        </div>
      </section>

      <section className="bg-white px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <AnimatedSection className="mb-12">
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold-600">
              Capability Directory
            </p>
            <h2 className="font-tight text-4xl font-black leading-none tracking-tighter text-ink-900 sm:text-5xl">
              Services People Search For
            </h2>
          </AnimatedSection>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {serviceAreas.map((service, index) => (
              <AnimatedSection key={service.slug} delay={index * 0.06}>
                <Link
                  href={serviceUrl(service.slug)}
                  className="group block h-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:border-gold-400 hover:shadow-xl"
                >
                  <div className="relative h-44 overflow-hidden">
                    {service.image ? (
                      <div className="absolute inset-0 bg-ink-950">
                        <img
                          src={service.image.src}
                          alt={service.image.alt}
                          className="h-full w-full object-contain p-2 transition-transform duration-700 group-hover:scale-[1.02]"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <BrandVisual
                        variant={service.visual}
                        label={`${service.title} service area`}
                        className="absolute inset-0 transition-transform duration-700 group-hover:scale-105"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-ink-950/75 via-ink-950/20 to-transparent" />
                    <div className="absolute bottom-4 left-4 right-4">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gold-300">
                        {service.eyebrow}
                      </p>
                      <h3 className="font-tight text-xl font-black leading-tight text-white">{service.title}</h3>
                    </div>
                  </div>
                  <div className="p-6">
                    <p className="mb-5 text-sm leading-relaxed text-slate-600">{service.summary}</p>
                    <div className="mb-5 flex flex-wrap gap-2">
                      {service.offerings.slice(0, 3).map((offering) => (
                        <span
                          key={offering}
                          className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600"
                        >
                          {offering}
                        </span>
                      ))}
                    </div>
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-gold-600 transition group-hover:text-gold-500">
                      View service
                      <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                    </span>
                  </div>
                </Link>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-50 px-5 py-20 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <AnimatedSection>
            <div className="gold-line mb-6" />
            <h2 className="mb-4 font-tight text-3xl font-black leading-tight tracking-tighter text-ink-900">
              Company-Led Delivery
            </h2>
            <p className="text-sm leading-relaxed text-slate-600">
              Every service area maps back to one of the group operating companies, keeping
              enquiries clear and accountable from the first contact.
            </p>
          </AnimatedSection>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {['mwanjalisi-oil', 'westsides-company', 'itemba-enterprises'].map((slug) => {
              const relatedServices = serviceAreas.filter((service) => service.companySlug === slug);
              const companyName = relatedServices[0]?.companyName;

              return (
                <AnimatedSection key={slug}>
                  <Link
                    href={companyUrl(slug)}
                    className="block h-full rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-gold-400 hover:shadow-md"
                  >
                    <h3 className="mb-3 font-tight text-lg font-bold text-ink-900">{companyName}</h3>
                    <p className="mb-5 text-xs font-semibold uppercase tracking-widest text-slate-400">
                      {relatedServices.length} service area{relatedServices.length === 1 ? '' : 's'}
                    </p>
                    <div className="space-y-2">
                      {relatedServices.map((service) => (
                        <div key={service.slug} className="text-sm text-slate-600">
                          {service.shortTitle}
                        </div>
                      ))}
                    </div>
                  </Link>
                </AnimatedSection>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
