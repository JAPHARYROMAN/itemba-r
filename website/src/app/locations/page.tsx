import Link from 'next/link';
import type { Metadata } from 'next';
import AnimatedSection from '@/components/AnimatedSection';
import BrandVisual from '@/components/BrandVisual';
import JsonLd from '@/components/JsonLd';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  locationProfiles,
  locationUrl,
  serviceAreas,
  serviceUrl,
  site,
} from '@/lib/site';

export const metadata: Metadata = {
  title: 'Locations',
  description:
    'Find Itemba Group in Mpemba-Tunduma, Songwe Region, Tanzania, and explore services connected to the Tunduma trade corridor.',
  alternates: { canonical: absoluteUrl('/locations') },
  openGraph: {
    title: 'Itemba Group Locations',
    description: 'Itemba Group headquarters and operating presence in Mpemba-Tunduma, Songwe Region, Tanzania.',
    url: absoluteUrl('/locations'),
  },
};

const locationsJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  '@id': `${absoluteUrl('/locations')}#locations`,
  name: 'Itemba Group Locations',
  url: absoluteUrl('/locations'),
  about: {
    '@id': `${site.url}/#organization`,
  },
  mainEntity: {
    '@type': 'ItemList',
    itemListElement: locationProfiles.map((location, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: location.title,
      url: absoluteUrl(locationUrl(location.slug)),
    })),
  },
};

export default function LocationsPage() {
  const primaryLocation = locationProfiles[0];
  const featuredServices = serviceAreas.filter((service) =>
    primaryLocation.serviceSlugs.includes(service.slug),
  );

  return (
    <div className="bg-ink-950">
      <JsonLd
        data={[
          locationsJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Locations', path: '/locations' },
          ]),
        ]}
      />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative flex min-h-[78vh] items-end overflow-hidden bg-ink-950">
        {primaryLocation.image ? (
          <img
            src={primaryLocation.image.src}
            alt=""
            aria-hidden="true"
            className="animate-kenburns absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <BrandVisual variant="corridor" label="Songwe and Tunduma corridor" className="absolute inset-0" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/70 to-ink-950/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-ink-950/70" />
        <div className="grain-overlay" />
        <div className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-16 pt-40 sm:px-8">
          <AnimatedSection>
            <div className="mb-5 flex items-center gap-3">
              <span className="h-px w-10 bg-gold-400" />
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">
                Local presence
              </span>
            </div>
            <h1 className="cine-shadow font-tight text-5xl font-black leading-[0.92] tracking-tight text-white sm:text-6xl lg:text-7xl">
              Based in Songwe. <span className="gradient-text">Connected through Tunduma.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-200/90">
              {primaryLocation.summary}
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Headquarters ──────────────────────────────────────────── */}
      <section className="overflow-hidden bg-ink-950 px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <AnimatedSection>
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">
              Headquarters
            </p>
            <h2 className="mb-5 font-tight text-4xl font-black leading-tight tracking-tight text-white">
              {primaryLocation.title}
            </h2>
            <p className="mb-8 text-lg leading-relaxed text-slate-300">{primaryLocation.detail}</p>
            <Link
              href={locationUrl(primaryLocation.slug)}
              className="btn-primary inline-flex rounded-full bg-gold-500 px-6 py-3 text-sm font-semibold text-white hover:bg-gold-400"
            >
              View location profile
            </Link>
          </AnimatedSection>

          <AnimatedSection direction="left">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {primaryLocation.advantages.map((advantage) => (
                <div key={advantage.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                  <h3 className="mb-3 font-tight text-lg font-bold text-white">{advantage.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-400">{advantage.summary}</p>
                </div>
              ))}
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Connected services ────────────────────────────────────── */}
      <section className="overflow-hidden bg-ink-950 px-5 py-20 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <AnimatedSection className="mb-10">
            <div className="gold-line mb-6" />
            <h2 className="font-tight text-3xl font-black leading-tight tracking-tight text-white">
              Services connected to this location
            </h2>
          </AnimatedSection>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {featuredServices.map((service, index) => (
              <AnimatedSection key={service.slug} delay={index * 0.05}>
                <Link
                  href={serviceUrl(service.slug)}
                  className="block h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-gold-400/50 hover:bg-white/[0.06]"
                >
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold-400">
                    {service.eyebrow}
                  </p>
                  <h3 className="mb-3 font-tight text-xl font-bold text-white">{service.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-400">{service.summary}</p>
                </Link>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
