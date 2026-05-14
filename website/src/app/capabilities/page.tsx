import Link from 'next/link';
import type { Metadata } from 'next';
import AnimatedSection from '@/components/AnimatedSection';
import BrandVisual from '@/components/BrandVisual';
import EnquiryRouter from '@/components/EnquiryRouter';
import JsonLd from '@/components/JsonLd';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  companyProfiles,
  companyUrl,
  locationUrl,
  serviceAreas,
  serviceUrl,
  site,
} from '@/lib/site';

export const metadata: Metadata = {
  title: 'Capabilities and Operating Proof',
  description:
    'A practical view of Itemba Group operating capabilities, company responsibilities, service routes, and enquiry paths across Songwe Region and the Tunduma corridor.',
  alternates: { canonical: absoluteUrl('/capabilities') },
  openGraph: {
    title: 'Itemba Group Capabilities and Operating Proof',
    description:
      'See how Itemba Group maps services, companies, location presence, and enquiry routing for customers, suppliers, and partners.',
    url: absoluteUrl('/capabilities'),
  },
};

const verificationSignals = [
  {
    title: 'Group structure',
    summary:
      'Three named operating companies are presented with separate profiles, sectors, services, and contact routes.',
  },
  {
    title: 'Service ownership',
    summary:
      'Each service area maps back to the company most closely responsible for handling that enquiry.',
  },
  {
    title: 'Local operating base',
    summary:
      'The Mpemba-Tunduma head office and Songwe Region location profile are consistent across the site.',
  },
  {
    title: 'Contact accountability',
    summary:
      'Partnership, service, company, and contact pages route enquiries through the same group channels.',
  },
];

const partnerChecklist = [
  'The product, service, or operating area you need',
  'The closest Itemba Group company or division',
  'Delivery location, expected volume, or business context',
  'Preferred response method and urgency',
];

const capabilityJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  '@id': `${absoluteUrl('/capabilities')}#capabilities`,
  name: 'Itemba Group Capabilities and Operating Proof',
  url: absoluteUrl('/capabilities'),
  description: metadata.description,
  about: {
    '@id': `${site.url}/#organization`,
  },
  mainEntity: {
    '@type': 'ItemList',
    itemListElement: serviceAreas.map((service, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: service.title,
      description: service.summary,
      url: absoluteUrl(serviceUrl(service.slug)),
    })),
  },
};

function getCompany(slug: string) {
  return companyProfiles.find((company) => company.slug === slug);
}

export default function CapabilitiesPage() {
  return (
    <>
      <JsonLd
        data={[
          capabilityJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Capabilities', path: '/capabilities' },
          ]),
        ]}
      />

      <section className="relative overflow-hidden bg-ink-900 px-5 pb-24 pt-40 sm:px-8">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.5 }} />
          <div className="hero-orb hero-orb-blue" style={{ opacity: 0.3 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <AnimatedSection>
            <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">
              Capability Proof
            </p>
            <h1
              className="mb-6 font-tight font-black leading-none tracking-tightest text-white"
              style={{ fontSize: 'clamp(2.8rem, 6vw, 5.5rem)' }}
            >
              Verify the Fit.<br />
              <span className="gradient-text">Contact the Right Team.</span>
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-slate-300">
              A practical guide for customers, suppliers, contractors, transport operators,
              and partners who need to understand Itemba Group&apos;s operating coverage before
              sending a business enquiry.
            </p>
          </AnimatedSection>
          <AnimatedSection direction="left">
            <div className="relative h-80 overflow-hidden rounded-3xl shadow-2xl">
              <BrandVisual variant="operations" label="Itemba Group capability map" className="absolute inset-0" />
              <div className="absolute inset-0 bg-gradient-to-br from-ink-950/30 to-transparent" />
            </div>
          </AnimatedSection>
        </div>
      </section>

      <section className="bg-white px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[0.78fr_1.22fr]">
          <AnimatedSection>
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold-600">
              Verification Signals
            </p>
            <h2 className="font-tight text-4xl font-black leading-tight tracking-tighter text-ink-900 sm:text-5xl">
              What a Visitor Can Confirm Quickly
            </h2>
          </AnimatedSection>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {verificationSignals.map((signal, index) => (
              <AnimatedSection key={signal.title} delay={index * 0.06}>
                <div className="h-full rounded-2xl border border-slate-200 bg-slate-50 p-6">
                  <span className="mb-5 flex h-9 w-9 items-center justify-center rounded-full bg-ink-900 text-sm font-black text-white">
                    {index + 1}
                  </span>
                  <h3 className="mb-3 font-tight text-xl font-black leading-tight text-ink-900">
                    {signal.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-600">{signal.summary}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-50 px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <AnimatedSection className="mb-12">
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold-600">
              Capability Map
            </p>
            <h2 className="font-tight text-4xl font-black leading-tight tracking-tighter text-ink-900 sm:text-5xl">
              Services, Owners, and Best-Fit Enquiries
            </h2>
          </AnimatedSection>

          <div className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {serviceAreas.map((service, index) => {
              const company = getCompany(service.companySlug);

              return (
                <AnimatedSection key={service.slug} delay={index * 0.04}>
                  <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-[1fr_0.9fr_0.8fr] md:p-8">
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gold-600">
                        {service.eyebrow}
                      </p>
                      <h3 className="mb-3 font-tight text-2xl font-black leading-tight text-ink-900">
                        {service.title}
                      </h3>
                      <p className="text-sm leading-relaxed text-slate-600">{service.summary}</p>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
                        Operating Company
                      </p>
                      <Link
                        href={companyUrl(service.companySlug)}
                        className="font-semibold text-ink-900 transition hover:text-gold-600"
                      >
                        {company?.name ?? service.companyName}
                      </Link>
                      <p className="mt-3 text-sm leading-relaxed text-slate-500">
                        {company?.summary ?? service.detail}
                      </p>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
                        Common Enquiries
                      </p>
                      <div className="mb-5 flex flex-wrap gap-2">
                        {service.audience.slice(0, 3).map((audience) => (
                          <span
                            key={audience}
                            className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600"
                          >
                            {audience}
                          </span>
                        ))}
                      </div>
                      <Link
                        href={serviceUrl(service.slug)}
                        className="inline-flex items-center gap-2 text-sm font-semibold text-gold-600 transition hover:text-gold-500"
                      >
                        Open service page
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                      </Link>
                    </div>
                  </div>
                </AnimatedSection>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-ink-900 px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <AnimatedSection>
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold-400">
              Due Diligence Path
            </p>
            <h2 className="mb-5 font-tight text-4xl font-black leading-tight tracking-tighter text-white sm:text-5xl">
              Prepare a Stronger Business Enquiry
            </h2>
            <p className="text-sm leading-relaxed text-slate-300">
              Before contacting Itemba Group, a partner can use this site to confirm the
              correct operating area, location context, company profile, and contact route.
            </p>
          </AnimatedSection>

          <AnimatedSection direction="left">
            <div className="rounded-2xl border border-ink-600 bg-ink-800 p-6 sm:p-8">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {partnerChecklist.map((item, index) => (
                  <div key={item} className="flex gap-3 text-sm leading-relaxed text-slate-300">
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gold-500 text-xs font-black text-white">
                      {index + 1}
                    </span>
                    <span className="pt-1">{item}</span>
                  </div>
                ))}
              </div>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/company-profile"
                  className="btn-primary rounded-full bg-gold-500 px-5 py-3 text-sm font-semibold text-white hover:bg-gold-400"
                >
                  View company profile
                </Link>
                <Link
                  href={locationUrl('songwe-tunduma')}
                  className="btn-primary rounded-full border border-slate-600 px-5 py-3 text-sm font-semibold text-slate-200 hover:border-gold-400 hover:text-gold-300"
                >
                  View location profile
                </Link>
              </div>
            </div>
          </AnimatedSection>
        </div>
      </section>

      <section className="bg-white px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <AnimatedSection>
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold-600">
              Route an Enquiry
            </p>
            <h2 className="mb-5 font-tight text-4xl font-black leading-tight tracking-tighter text-ink-900 sm:text-5xl">
              Ready to Contact the Group?
            </h2>
            <p className="text-sm leading-relaxed text-slate-600">
              Use the enquiry router to send the request to the closest business area, or
              continue through the partnerships page for supplier and commercial routes.
            </p>
            <Link
              href="/partnerships"
              className="mt-7 inline-flex text-sm font-semibold text-gold-600 transition hover:text-gold-500"
            >
              View partnership routes
            </Link>
          </AnimatedSection>
          <AnimatedSection direction="left">
            <EnquiryRouter
              title="Route a capability enquiry"
              description="Choose the area that best matches the capability, service, or operating company you need."
            />
          </AnimatedSection>
        </div>
      </section>
    </>
  );
}
