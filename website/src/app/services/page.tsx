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

export default function ServicesPage() {
  return (
    <div className="bg-ink-950">
      <JsonLd
        data={[
          servicesJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Services', path: '/services' },
          ]),
        ]}
      />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-ink-950 px-5 pb-24 pt-44 sm:px-8">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.5 }} />
          <div className="hero-orb hero-orb-blue" style={{ opacity: 0.35 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 mx-auto max-w-7xl">
          <AnimatedSection>
            <div className="mb-5 flex items-center gap-3">
              <span className="h-px w-10 bg-gold-400" />
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">
                Services &amp; capabilities
              </span>
            </div>
            <h1 className="font-tight text-5xl font-black leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
              Search by need. <span className="gradient-text">Find the right team.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-300">
              Itemba Group operates through specialised companies and divisions. These service pages
              help customers, suppliers and partners find the right route into the group.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Capability directory ──────────────────────────────────── */}
      <section className="bg-ink-950 px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <AnimatedSection className="mb-12">
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">
              Capability directory
            </p>
            <h2 className="font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
              Services people search for
            </h2>
          </AnimatedSection>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {serviceAreas.map((service, index) => (
              <AnimatedSection key={service.slug} delay={index * 0.05}>
                <Link
                  href={serviceUrl(service.slug)}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition hover:-translate-y-1 hover:border-gold-400/50 hover:bg-white/[0.06]"
                >
                  <div className="relative h-48 overflow-hidden">
                    {service.image ? (
                      <img
                        src={service.image.src}
                        alt={service.image.alt}
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                    ) : (
                      <BrandVisual
                        variant={service.visual}
                        label={`${service.title} service area`}
                        className="absolute inset-0 transition-transform duration-700 group-hover:scale-105"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/40 to-transparent" />
                    <div className="absolute inset-x-4 bottom-4">
                      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-gold-300">
                        {service.eyebrow}
                      </p>
                      <h3 className="font-tight text-xl font-black leading-tight text-white">
                        {service.title}
                      </h3>
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col p-6">
                    <p className="mb-5 flex-1 text-sm leading-relaxed text-slate-400">
                      {service.summary}
                    </p>
                    <div className="mb-5 flex flex-wrap gap-2">
                      {service.offerings.slice(0, 3).map((offering) => (
                        <span
                          key={offering}
                          className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-medium text-white/80"
                        >
                          {offering}
                        </span>
                      ))}
                    </div>
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-gold-300 transition group-hover:text-gold-200">
                      View service
                      <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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

      {/* ── Company-led delivery ──────────────────────────────────── */}
      <section className="bg-ink-950 px-5 py-20 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <AnimatedSection>
            <div className="gold-line mb-6" />
            <h2 className="mb-4 font-tight text-3xl font-black leading-tight tracking-tight text-white">
              Company-led delivery
            </h2>
            <p className="text-sm leading-relaxed text-slate-400">
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
                    className="block h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-gold-400/50 hover:bg-white/[0.06]"
                  >
                    <h3 className="mb-3 font-tight text-lg font-bold text-white">{companyName}</h3>
                    <p className="mb-5 text-xs font-semibold uppercase tracking-widest text-gold-400">
                      {relatedServices.length} service area{relatedServices.length === 1 ? '' : 's'}
                    </p>
                    <div className="space-y-2">
                      {relatedServices.map((service) => (
                        <div key={service.slug} className="text-sm text-slate-400">
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
    </div>
  );
}
