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
  const featuredServices = serviceAreas.filter((service) => primaryLocation.serviceSlugs.includes(service.slug));

  return (
    <>
      <JsonLd
        data={[
          locationsJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Locations', path: '/locations' },
          ]),
        ]}
      />

      <section className="relative overflow-hidden bg-ink-900 px-5 pb-24 pt-40 sm:px-8">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.55 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <AnimatedSection>
            <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">
              Local Presence
            </p>
            <h1
              className="mb-6 font-tight font-black leading-none tracking-tightest text-white"
              style={{ fontSize: 'clamp(2.8rem, 6vw, 5.5rem)' }}
            >
              Based in Songwe.<br />
              <span className="gradient-text">Connected Through Tunduma.</span>
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-slate-300">{primaryLocation.summary}</p>
          </AnimatedSection>
          <AnimatedSection direction="left">
            <figure className="relative h-80 overflow-hidden rounded-3xl bg-ink-950 shadow-2xl ring-1 ring-white/10">
              {primaryLocation.image ? (
                <img
                  src={primaryLocation.image.src}
                  alt={primaryLocation.image.alt}
                  className="h-full w-full object-cover"
                  loading="eager"
                />
              ) : (
                <BrandVisual variant="corridor" label="Songwe and Tunduma corridor" className="absolute inset-0" />
              )}
              <div className="absolute inset-0 bg-gradient-to-br from-ink-950/55 via-ink-950/10 to-transparent" />
              {primaryLocation.image?.caption ? (
                <figcaption className="absolute bottom-3 right-3 max-w-[80%] rounded bg-ink-950/75 px-3 py-1.5 text-[10px] font-medium leading-relaxed text-slate-200 backdrop-blur">
                  {primaryLocation.image.caption}
                </figcaption>
              ) : null}
            </figure>
          </AnimatedSection>
        </div>
      </section>

      <section className="overflow-hidden bg-white px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <AnimatedSection>
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold-600">
              Headquarters
            </p>
            <h2 className="mb-5 font-tight text-4xl font-black leading-tight tracking-tighter text-ink-900">
              {primaryLocation.title}
            </h2>
            <p className="mb-8 text-lg leading-relaxed text-slate-600">{primaryLocation.detail}</p>
            <Link
              href={locationUrl(primaryLocation.slug)}
              className="btn-primary inline-flex rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-white hover:bg-ink-700"
            >
              View location profile
            </Link>
          </AnimatedSection>

          <AnimatedSection direction="left">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {primaryLocation.advantages.map((advantage) => (
                <div key={advantage.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
                  <h3 className="mb-3 font-tight text-lg font-bold text-ink-900">{advantage.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-600">{advantage.summary}</p>
                </div>
              ))}
            </div>
          </AnimatedSection>
        </div>
      </section>

      <section className="overflow-hidden bg-slate-50 px-5 py-20 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <AnimatedSection className="mb-10">
            <div className="gold-line mb-6" />
            <h2 className="font-tight text-3xl font-black leading-tight tracking-tighter text-ink-900">
              Services Connected to This Location
            </h2>
          </AnimatedSection>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {featuredServices.map((service, index) => (
              <AnimatedSection key={service.slug} delay={index * 0.05}>
                <Link
                  href={serviceUrl(service.slug)}
                  className="block h-full rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-gold-400 hover:shadow-md"
                >
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">{service.eyebrow}</p>
                  <h3 className="mb-3 font-tight text-xl font-bold text-ink-900">{service.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-600">{service.summary}</p>
                </Link>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
