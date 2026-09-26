import Link from 'next/link';
import type { Metadata } from 'next';
import AnimatedSection from '@/components/AnimatedSection';
import BrandVisual from '@/components/BrandVisual';
import CinematicImage from '@/components/cine/CinematicImage';
import SectorIcon from '@/components/SectorIcon';
import JsonLd from '@/components/JsonLd';
import { getCompanyAccent } from '@/lib/company-accent';
import { companies } from '@/content/companies';
import { serviceIcons, servicesPage } from '@/content/services';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  companyUrl,
  serviceAreas,
  serviceUrl,
  site,
} from '@/lib/site';

const { meta, hero, directory, delivery } = servicesPage;

export const metadata: Metadata = {
  title: meta.title,
  description: meta.description,
  alternates: { canonical: absoluteUrl('/services') },
  openGraph: {
    title: meta.ogTitle,
    description: meta.ogDescription,
    url: absoluteUrl('/services'),
  },
};

const servicesJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  '@id': `${absoluteUrl('/services')}#services`,
  name: meta.ogTitle,
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
                {hero.eyebrow}
              </span>
            </div>
            <h1 className="font-tight text-5xl font-black leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
              {hero.headline.lead} <span className="gradient-text">{hero.headline.accent}</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-300">
              {hero.lede}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
              {hero.facts.flatMap((fact, index) => [
                ...(index > 0
                  ? [
                      <span key={`dot-${fact}`} aria-hidden="true" className="text-gold-400">
                        ·
                      </span>,
                    ]
                  : []),
                <span key={fact}>{fact}</span>,
              ])}
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Capability directory ──────────────────────────────────── */}
      <section className="bg-ink-950 px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <AnimatedSection className="mb-12">
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">
              {directory.eyebrow}
            </p>
            <h2 className="font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
              {directory.title}
            </h2>
          </AnimatedSection>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {serviceAreas.map((service, index) => {
              const accent = getCompanyAccent(service.companySlug);
              const shortCompany =
                companies.find((company) => company.slug === service.companySlug)?.shortName ?? service.companyName;
              return (
                <AnimatedSection key={service.slug} delay={index * 0.05}>
                  <Link
                    href={serviceUrl(service.slug)}
                    className={`group relative flex h-96 flex-col justify-end overflow-hidden rounded-3xl ring-1 ring-white/10 transition ${accent.ring}`}
                  >
                    {service.image ? (
                      <CinematicImage
                        src={service.image.src}
                        alt=""
                        sizes="(min-width:1024px) 50vw, 100vw"
                        className="transition-transform duration-700 group-hover:scale-105"
                      />
                    ) : (
                      <BrandVisual
                        variant={service.visual}
                        label={`${service.title} service area`}
                        className="absolute inset-0 transition-transform duration-700 group-hover:scale-105"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/60 to-ink-950/10" />
                    <div className="relative p-7 sm:p-8">
                      <div className="mb-5 flex items-center justify-between gap-3">
                        <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border ${accent.chip}`}>
                          <SectorIcon name={serviceIcons[service.visual]} className="h-6 w-6" />
                        </span>
                        <span className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-widest ${accent.chip}`}>
                          {shortCompany}
                        </span>
                      </div>
                      <h3 className="font-tight text-2xl font-black leading-tight tracking-tight text-white sm:text-3xl">
                        {service.title}
                      </h3>
                      <p className="mt-3 line-clamp-2 max-w-xl text-base leading-relaxed text-slate-200">
                        {service.summary}
                      </p>
                      <div className="mt-5 flex flex-wrap gap-2">
                        {service.offerings.slice(0, 3).map((offering) => (
                          <span
                            key={offering}
                            className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-medium text-white/85 backdrop-blur"
                          >
                            {offering}
                          </span>
                        ))}
                      </div>
                      <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-white">
                        {directory.cardAction}
                        <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                      </span>
                    </div>
                  </Link>
                </AnimatedSection>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Company-led delivery ──────────────────────────────────── */}
      <section className="bg-ink-950 px-5 py-20 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <AnimatedSection>
            <div className="gold-line mb-6" />
            <h2 className="mb-4 font-tight text-3xl font-black leading-tight tracking-tight text-white">
              {delivery.title}
            </h2>
            <p className="text-sm leading-relaxed text-slate-400">
              {delivery.body}
            </p>
          </AnimatedSection>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {companies.map(({ slug }) => {
              const relatedServices = serviceAreas.filter((service) => service.companySlug === slug);
              const companyName = relatedServices[0]?.companyName;
              const accent = getCompanyAccent(slug);

              return (
                <AnimatedSection key={slug}>
                  <Link
                    href={companyUrl(slug)}
                    className={`block h-full rounded-2xl border ${accent.border} bg-white/[0.03] p-6 transition hover:bg-white/[0.06]`}
                  >
                    <h3 className="mb-3 font-tight text-lg font-bold text-white">{companyName}</h3>
                    <p className={`mb-5 text-xs font-semibold uppercase tracking-widest ${accent.text}`}>
                      {relatedServices.length} service area{relatedServices.length === 1 ? '' : 's'}
                    </p>
                    <div className="space-y-2">
                      {relatedServices.map((service) => (
                        <div key={service.slug} className="flex items-center gap-2 text-sm text-slate-300">
                          <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${accent.dot}`} />
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
