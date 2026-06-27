import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import AnimatedSection from '@/components/AnimatedSection';
import BrandVisual from '@/components/BrandVisual';
import CinematicImage from '@/components/cine/CinematicImage';
import SectorIcon from '@/components/SectorIcon';
import EnquiryRouter from '@/components/EnquiryRouter';
import FaqList from '@/components/FaqList';
import JsonLd from '@/components/JsonLd';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  companyUrl,
  faqJsonLd,
  serviceAreas,
  serviceUrl,
  site,
} from '@/lib/site';
import { getCompanyAccent, getServiceIcon } from '@/lib/company-accent';

type PageProps = {
  params: Promise<{ slug: string }>;
};

function getService(slug: string) {
  return serviceAreas.find((service) => service.slug === slug);
}

const fuelShowcaseImages = [
  {
    src: '/images/fuel-stations/itemba-filling-station-wide.webp',
    alt: 'ITEMBA-MPEMBA filling station forecourt near Tunduma Bus Station',
    caption: 'ITEMBA-MPEMBA: a public ITEMBA station brand managed by Mwanjalisi Oil Company Ltd.',
  },
  {
    src: '/images/fuel-stations/itemba-mpemba-truck-canopy.webp',
    alt: 'Trucks refuelling at an ITEMBA station canopy',
    caption: 'Forecourt access supports buses, trucks, private motorists, and corridor logistics operators.',
  },
  {
    src: '/images/fuel-stations/itemba-uzunguni-forecourt-wide.webp',
    alt: 'ITEMBA-UZUNGUNI fuel station canopy and forecourt',
    caption: 'Forecourt visibility supports daily motorists, fleets, and cross-border transport demand.',
  },
] as const;

const fuelPositioning = [
  {
    label: 'Route Advantage',
    value: 'Stations positioned along major routes, including the TANZAM Highway and the Tunduma-Ileje Highway.',
  },
  {
    label: 'Transit Demand',
    value: 'Fuel access for motorists, buses, trucks, and logistics operators moving through the Tunduma corridor.',
  },
  {
    label: 'Expansion Pipeline',
    value: 'Two operating ITEMBA-branded stations with three upcoming locations under Mwanjalisi Oil management.',
  },
] as const;

function FuelBusinessShowcase() {
  return (
    <section className="bg-ink-950 px-5 py-20 text-white sm:px-8">
      <div className="mx-auto max-w-7xl">
        <AnimatedSection>
          <div className="max-w-3xl">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">
              Fuel business presence
            </p>
            <h2 className="font-tight text-3xl font-black leading-tight tracking-tight sm:text-4xl">
              ITEMBA stations built for corridor movement
            </h2>
            <p className="mt-5 text-base leading-relaxed text-slate-300">
              ITEMBA-MPEMBA and ITEMBA-UZUNGUNI trade publicly under the ITEMBA location brand while
              remaining managed by Mwanjalisi Oil Company Ltd — visible station brands, practical
              access, and high-traffic route positioning.
            </p>
          </div>
        </AnimatedSection>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {fuelShowcaseImages.map((image, index) => (
            <AnimatedSection key={image.src} direction="fade" delay={0.08 + index * 0.04}>
              <figure className="group relative h-64 overflow-hidden rounded-2xl ring-1 ring-white/10">
                <img
                  src={image.src}
                  alt={image.alt}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/30 to-transparent" />
                <figcaption className="absolute inset-x-0 bottom-0 p-4 text-xs font-medium leading-relaxed text-white/90">
                  {image.caption}
                </figcaption>
              </figure>
            </AnimatedSection>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {fuelPositioning.map((item, index) => (
            <AnimatedSection key={item.label} delay={0.12 + index * 0.04}>
              <div className="h-full rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-gold-400">{item.label}</p>
                <p className="mt-3 text-sm leading-relaxed text-slate-200">{item.value}</p>
              </div>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </section>
  );
}

export function generateStaticParams() {
  return serviceAreas.map((service) => ({ slug: service.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const service = getService(slug);

  if (!service) {
    return {};
  }

  const url = absoluteUrl(serviceUrl(service.slug));

  return {
    title: service.title,
    description: service.metaDescription,
    keywords: service.keywords,
    alternates: { canonical: url },
    openGraph: {
      title: `${service.title} | ${site.name}`,
      description: service.metaDescription,
      url,
      type: 'website',
    },
  };
}

export default async function ServicePage({ params }: PageProps) {
  const { slug } = await params;
  const service = getService(slug);

  if (!service) {
    notFound();
  }

  const pageUrl = absoluteUrl(serviceUrl(service.slug));
  const serviceGallery = service.gallery ?? [];
  const accent = getCompanyAccent(service.companySlug);
  const serviceJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${pageUrl}#service`,
    name: service.title,
    serviceType: service.eyebrow,
    description: service.metaDescription,
    url: pageUrl,
    image: service.image ? absoluteUrl(service.image.src) : undefined,
    provider: {
      '@type': 'Organization',
      name: service.companyName,
      url: absoluteUrl(companyUrl(service.companySlug)),
      parentOrganization: {
        '@id': `${site.url}/#organization`,
      },
    },
    areaServed: ['Songwe Region', 'Tunduma', 'Tanzania'],
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: `${service.title} offerings`,
      itemListElement: service.offerings.map((offering) => ({
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          name: offering,
        },
      })),
    },
  };

  return (
    <div className="bg-ink-950">
      <JsonLd
        data={[
          serviceJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Services', path: '/services' },
            { name: service.title, path: serviceUrl(service.slug) },
          ]),
          faqJsonLd(service.faqs),
        ]}
      />

      {/* ══ CINEMATIC HERO ════════════════════════════════════════════ */}
      <section className="relative flex min-h-[78vh] items-end overflow-hidden bg-ink-950">
        {service.image ? (
          <CinematicImage src={service.image.src} alt="" priority className="animate-kenburns" />
        ) : (
          <BrandVisual variant={service.visual} label={service.title} className="absolute inset-0" />
        )}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(90deg, ${accent.wash} 0%, rgba(5,8,15,0.62) 48%, rgba(5,8,15,0.97) 100%)`,
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-ink-950/65" />
        <div className="grain-overlay" />

        <div className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-16 pt-40 sm:px-8">
          <AnimatedSection>
            <Link
              href="/services"
              className="inline-flex items-center gap-2 text-sm font-semibold text-gold-300 transition hover:text-gold-200"
            >
              <span aria-hidden="true">←</span> All services
            </Link>
            <div className="mt-8 flex items-center gap-2.5">
              <SectorIcon name={getServiceIcon(service.visual)} className={`h-5 w-5 ${accent.text}`} />
              <p className={`text-xs font-semibold uppercase tracking-[0.25em] ${accent.text}`}>
                {service.eyebrow}
              </p>
            </div>
            <h1
              className="cine-shadow mt-4 font-tight font-black leading-[0.92] tracking-tight text-white"
              style={{ fontSize: 'clamp(2.6rem, 6.5vw, 5.5rem)' }}
            >
              {service.title}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-200/90 sm:text-xl">
              {service.summary}
            </p>
          </AnimatedSection>
        </div>
      </section>

      {service.slug === 'fuel-and-lubricants' ? <FuelBusinessShowcase /> : null}

      {/* ══ BODY ══════════════════════════════════════════════════════ */}
      <section className="bg-ink-950 px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-3">
          <div className="space-y-16 lg:col-span-2">
            <AnimatedSection>
              <div className="gold-line mb-6" />
              <h2 className="font-tight text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">
                What this covers
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">{service.detail}</p>
              <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {service.offerings.map((offering) => (
                  <div
                    key={offering}
                    className={`rounded-xl border ${accent.border} bg-white/[0.04] px-5 py-4 text-sm font-semibold text-white`}
                  >
                    {offering}
                  </div>
                ))}
              </div>
            </AnimatedSection>

            {serviceGallery.length > 0 ? (
              <AnimatedSection delay={0.06}>
                <div className="gold-line mb-6" />
                <h2 className="mb-6 font-tight text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">
                  Operations gallery
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {serviceGallery.map((image) => (
                    <figure
                      key={image.src}
                      className="group relative h-60 overflow-hidden rounded-2xl ring-1 ring-white/10"
                    >
                      <CinematicImage
                        src={image.src}
                        alt={image.alt}
                        sizes="(min-width:640px) 50vw, 100vw"
                        className="transition-transform duration-700 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/30 to-transparent" />
                      <figcaption className="absolute inset-x-0 bottom-0 p-4 text-xs font-medium leading-relaxed text-white/90">
                        {image.caption}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </AnimatedSection>
            ) : null}

            <AnimatedSection delay={0.08}>
              <div className="gold-line mb-6" />
              <h2 className="mb-6 font-tight text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">
                Who it serves
              </h2>
              <div className="flex flex-wrap gap-2">
                {service.audience.map((audience) => (
                  <span
                    key={audience}
                    className="rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-medium text-white/85 backdrop-blur"
                  >
                    {audience}
                  </span>
                ))}
              </div>
            </AnimatedSection>

            <AnimatedSection delay={0.1}>
              <div className="gold-line mb-6" />
              <h2 className="mb-6 font-tight text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">
                Frequently asked questions
              </h2>
              <FaqList faqs={service.faqs} />
            </AnimatedSection>
          </div>

          <aside className="space-y-6">
            <AnimatedSection direction="fade" delay={0.08}>
              <div className={`rounded-2xl border ${accent.border} bg-white/[0.03] p-6`}>
                <p className={`mb-4 text-xs font-semibold uppercase tracking-widest ${accent.text}`}>
                  Operating company
                </p>
                <h2 className="mb-3 font-tight text-xl font-bold text-white">{service.companyName}</h2>
                <p className="mb-5 text-sm leading-relaxed text-slate-400">
                  This service area is handled through the relevant operating team under{' '}
                  {service.companyName}.
                </p>
                <Link
                  href={companyUrl(service.companySlug)}
                  className={`inline-flex items-center gap-2 text-sm font-semibold ${accent.text} transition hover:opacity-80`}
                >
                  View company profile
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </Link>
              </div>
            </AnimatedSection>

            <AnimatedSection direction="fade" delay={0.14}>
              <EnquiryRouter
                compact
                defaultIntentId={service.intentId}
                title="Start a service enquiry"
                description="Choose a contact route and send a prepared message to the group office."
              />
            </AnimatedSection>
          </aside>
        </div>
      </section>
    </div>
  );
}
