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
  companyUrl,
  faqJsonLd,
  serviceAreas,
  serviceUrl,
  site,
} from '@/lib/site';

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

function PhotoFrame({
  src,
  alt,
  caption,
  className = '',
}: {
  src: string;
  alt: string;
  caption?: string;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-2xl bg-ink-950 shadow-2xl ring-1 ring-white/10 ${className}`}>
      <div className="flex aspect-[4/3] items-center justify-center bg-ink-950 p-2 sm:p-3">
        <img
          src={src}
          alt={alt}
          className="h-full w-full rounded-xl object-contain shadow-2xl ring-1 ring-white/15"
        />
      </div>
      {caption ? (
        <div className="border-t border-white/10 bg-ink-950/95 px-5 py-4 text-sm font-semibold leading-relaxed text-white">
          {caption}
        </div>
      ) : null}
    </div>
  );
}

function FuelBusinessShowcase() {
  return (
    <section className="bg-ink-950 px-5 py-20 text-white sm:px-8">
      <div className="mx-auto max-w-7xl">
        <AnimatedSection>
          <div className="max-w-3xl">
            <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">
              Fuel Business Presence
            </p>
            <h2 className="font-tight text-3xl font-black leading-tight tracking-tighter sm:text-4xl">
              ITEMBA stations built for corridor movement
            </h2>
            <p className="mt-5 text-base leading-relaxed text-slate-300">
              The fuel business is presented around visible station brands, practical access, and
              high-traffic route positioning. ITEMBA-MPEMBA and ITEMBA-UZUNGUNI trade publicly under
              the ITEMBA location brand while remaining managed by Mwanjalisi Oil Company Ltd.
            </p>
          </div>
        </AnimatedSection>

        <div className="mt-10 grid grid-cols-1 items-start gap-5 md:grid-cols-3">
          {fuelShowcaseImages.map((image, index) => (
            <AnimatedSection key={image.src} direction="fade" delay={0.08 + index * 0.04}>
              <PhotoFrame src={image.src} alt={image.alt} caption={image.caption} />
            </AnimatedSection>
          ))}
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
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
    <>
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

      <section className="relative overflow-hidden bg-ink-900 px-5 pb-20 pt-40 sm:px-8">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.5 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <AnimatedSection>
            <Link href="/services" className="text-sm font-semibold text-gold-400 hover:text-gold-300">
              All services
            </Link>
            <p className="mb-4 mt-8 text-xs font-semibold uppercase tracking-widest text-gold-400">
              {service.eyebrow}
            </p>
            <h1
              className="mb-6 font-tight font-black leading-none tracking-tightest text-white"
              style={{ fontSize: 'clamp(2.8rem, 6vw, 5.5rem)' }}
            >
              {service.title}
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-slate-300">{service.summary}</p>
          </AnimatedSection>
          <AnimatedSection direction="fade">
            <div className="relative overflow-hidden rounded-2xl bg-ink-950 shadow-2xl ring-1 ring-white/10">
              {service.image ? (
                <>
                  <img
                    src={service.image.src}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-2xl"
                  />
                  <div className="relative flex min-h-[20rem] items-center justify-center p-3 sm:min-h-[24rem] sm:p-4">
                    <img
                      src={service.image.src}
                      alt={service.image.alt}
                      className="max-h-[28rem] w-full rounded-xl object-contain shadow-2xl ring-1 ring-white/15"
                    />
                  </div>
                </>
              ) : (
                <div className="relative h-80">
                  <BrandVisual variant={service.visual} label={`${service.title} operations`} className="absolute inset-0" />
                </div>
              )}
              {service.image?.caption ? (
                <div className="relative border-t border-white/10 bg-ink-950/95 p-4 text-sm font-semibold leading-relaxed text-white">
                  {service.image.caption}
                </div>
              ) : null}
            </div>
          </AnimatedSection>
        </div>
      </section>

      {service.slug === 'fuel-and-lubricants' ? <FuelBusinessShowcase /> : null}

      <section className="bg-white px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <AnimatedSection>
              <div className="gold-line mb-6" />
              <h2 className="mb-5 font-tight text-3xl font-black leading-tight tracking-tighter text-ink-900 sm:text-4xl">
                What This Covers
              </h2>
              <p className="mb-8 text-lg leading-relaxed text-slate-600">{service.detail}</p>
            </AnimatedSection>

            <AnimatedSection delay={0.08}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {service.offerings.map((offering) => (
                  <div key={offering} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <div className="text-sm font-semibold text-ink-900">{offering}</div>
                  </div>
                ))}
              </div>
            </AnimatedSection>

            {serviceGallery.length > 0 ? (
              <AnimatedSection delay={0.12} className="mt-14">
                <div className="gold-line mb-6" />
                <h2 className="mb-5 font-tight text-3xl font-black leading-tight tracking-tighter text-ink-900 sm:text-4xl">
                  Operations Gallery
                </h2>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  {serviceGallery.map((image) => (
                    <PhotoFrame key={image.src} src={image.src} alt={image.alt} caption={image.caption} />
                  ))}
                </div>
              </AnimatedSection>
            ) : null}

            <AnimatedSection delay={0.14} className="mt-14">
              <div className="gold-line mb-6" />
              <h2 className="mb-5 font-tight text-3xl font-black leading-tight tracking-tighter text-ink-900 sm:text-4xl">
                Who It Serves
              </h2>
              <div className="flex flex-wrap gap-2">
                {service.audience.map((audience) => (
                  <span
                    key={audience}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600"
                  >
                    {audience}
                  </span>
                ))}
              </div>
            </AnimatedSection>

            <AnimatedSection delay={0.18} className="mt-14">
              <div className="gold-line mb-6" />
              <h2 className="mb-5 font-tight text-3xl font-black leading-tight tracking-tighter text-ink-900 sm:text-4xl">
                Frequently Asked Questions
              </h2>
              <FaqList faqs={service.faqs} />
            </AnimatedSection>
          </div>

          <aside className="space-y-6">
            <AnimatedSection direction="fade" delay={0.08}>
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Operating Company
                </p>
                <h2 className="mb-3 font-tight text-xl font-bold text-ink-900">{service.companyName}</h2>
                <p className="mb-5 text-sm leading-relaxed text-slate-600">
                  This service area is handled through the relevant operating team under {service.companyName}.
                </p>
                <Link
                  href={companyUrl(service.companySlug)}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-gold-600 hover:text-gold-500"
                >
                  View company profile
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
    </>
  );
}
