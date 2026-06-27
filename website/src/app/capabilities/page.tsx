import Link from 'next/link';
import type { Metadata } from 'next';
import AnimatedSection from '@/components/AnimatedSection';
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
    <div className="bg-ink-950">
      <JsonLd
        data={[
          capabilityJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Capabilities', path: '/capabilities' },
          ]),
        ]}
      />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-ink-950 px-5 pb-24 pt-44 sm:px-8">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.5 }} />
          <div className="hero-orb hero-orb-blue" style={{ opacity: 0.3 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 mx-auto max-w-7xl">
          <AnimatedSection>
            <div className="mb-5 flex items-center gap-3">
              <span className="h-px w-10 bg-gold-400" />
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">
                Capability proof
              </span>
            </div>
            <h1 className="font-tight text-5xl font-black leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
              Verify the fit. <span className="gradient-text">Contact the right team.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-300">
              A practical guide for customers, suppliers, contractors, transport operators and
              partners who need to understand Itemba Group&apos;s operating coverage before sending a
              business enquiry.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Verification signals ──────────────────────────────────── */}
      <section className="bg-ink-950 px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[0.78fr_1.22fr]">
          <AnimatedSection>
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">
              Verification signals
            </p>
            <h2 className="font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
              What a visitor can confirm quickly
            </h2>
          </AnimatedSection>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {verificationSignals.map((signal, index) => (
              <AnimatedSection key={signal.title} delay={index * 0.06}>
                <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  <span className="mb-5 flex h-9 w-9 items-center justify-center rounded-full bg-gold-500 text-sm font-black text-white">
                    {index + 1}
                  </span>
                  <h3 className="mb-3 font-tight text-xl font-black leading-tight text-white">
                    {signal.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-400">{signal.summary}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── Capability map ────────────────────────────────────────── */}
      <section className="bg-ink-950 px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <AnimatedSection className="mb-12">
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">
              Capability map
            </p>
            <h2 className="font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
              Services, owners, and best-fit enquiries
            </h2>
          </AnimatedSection>

          <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
            {serviceAreas.map((service, index) => {
              const company = getCompany(service.companySlug);

              return (
                <AnimatedSection key={service.slug} delay={index * 0.04}>
                  <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-[1fr_0.9fr_0.8fr] md:p-8">
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gold-400">
                        {service.eyebrow}
                      </p>
                      <h3 className="mb-3 font-tight text-2xl font-black leading-tight text-white">
                        {service.title}
                      </h3>
                      <p className="text-sm leading-relaxed text-slate-400">{service.summary}</p>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
                        Operating company
                      </p>
                      <Link
                        href={companyUrl(service.companySlug)}
                        className="font-semibold text-white transition hover:text-gold-300"
                      >
                        {company?.name ?? service.companyName}
                      </Link>
                      <p className="mt-3 text-sm leading-relaxed text-slate-400">
                        {company?.summary ?? service.detail}
                      </p>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
                        Common enquiries
                      </p>
                      <div className="mb-5 flex flex-wrap gap-2">
                        {service.audience.slice(0, 3).map((audience) => (
                          <span
                            key={audience}
                            className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-medium text-white/80"
                          >
                            {audience}
                          </span>
                        ))}
                      </div>
                      <Link
                        href={serviceUrl(service.slug)}
                        className="inline-flex items-center gap-2 text-sm font-semibold text-gold-300 transition hover:text-gold-200"
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

      {/* ── Due-diligence path ────────────────────────────────────── */}
      <section className="bg-ink-950 px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <AnimatedSection>
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">
              Due-diligence path
            </p>
            <h2 className="mb-5 font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
              Prepare a stronger business enquiry
            </h2>
            <p className="text-sm leading-relaxed text-slate-400">
              Before contacting Itemba Group, a partner can use this site to confirm the correct
              operating area, location context, company profile and contact route.
            </p>
          </AnimatedSection>

          <AnimatedSection direction="left">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 sm:p-8">
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
                  className="btn-primary rounded-full border border-white/25 px-5 py-3 text-sm font-semibold text-slate-200 hover:border-gold-400 hover:text-gold-300"
                >
                  View location profile
                </Link>
              </div>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Route an enquiry ──────────────────────────────────────── */}
      <section className="bg-ink-950 px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <AnimatedSection>
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">
              Route an enquiry
            </p>
            <h2 className="mb-5 font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
              Ready to contact the group?
            </h2>
            <p className="text-sm leading-relaxed text-slate-400">
              Use the enquiry router to send the request to the closest business area, or continue
              through the partnerships page for supplier and commercial routes.
            </p>
            <Link
              href="/partnerships"
              className="mt-7 inline-flex text-sm font-semibold text-gold-300 transition hover:text-gold-200"
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
    </div>
  );
}
