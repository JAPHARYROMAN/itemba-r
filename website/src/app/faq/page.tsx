import Link from 'next/link';
import type { Metadata } from 'next';
import AnimatedSection from '@/components/AnimatedSection';
import EnquiryRouter from '@/components/EnquiryRouter';
import FaqList from '@/components/FaqList';
import JsonLd from '@/components/JsonLd';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  companyProfiles,
  companyUrl,
  faqJsonLd,
  groupFaqs,
  locationProfiles,
  locationUrl,
  partnershipFaqs,
  serviceAreas,
  serviceUrl,
  site,
  type Faq,
} from '@/lib/site';

type FaqSection = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  linkLabel: string;
  faqs: readonly Faq[];
};

export const metadata: Metadata = {
  title: 'Frequently Asked Questions',
  description:
    'Answers to common questions about Itemba Group, its companies, services, location, and business enquiry channels in Tanzania.',
  alternates: { canonical: absoluteUrl('/faq') },
  openGraph: {
    title: 'Itemba Group Frequently Asked Questions',
    description:
      'Answers about Itemba Group companies, fuel, trade, logistics, construction supplies, hospitality, real estate, and Songwe-Tunduma operations.',
    url: absoluteUrl('/faq'),
  },
};

const faqSections: FaqSection[] = [
  {
    id: 'partnerships',
    eyebrow: 'Partnerships',
    title: 'Partnerships and Supplier Enquiries',
    description: 'Questions for suppliers, bulk buyers, logistics customers, contractors, and regional business partners.',
    href: '/partnerships',
    linkLabel: 'View partnerships',
    faqs: partnershipFaqs,
  },
  {
    id: 'group',
    eyebrow: 'Group',
    title: 'Itemba Group',
    description: 'Core questions about the group structure, sectors, and enquiry channels.',
    href: '/company-profile',
    linkLabel: 'View company profile',
    faqs: groupFaqs,
  },
  ...companyProfiles.map((company) => ({
    id: `company-${company.slug}`,
    eyebrow: 'Company',
    title: company.name,
    description: company.summary,
    href: companyUrl(company.slug),
    linkLabel: 'View company',
    faqs: company.faqs,
  })),
  ...serviceAreas.map((service) => ({
    id: `service-${service.slug}`,
    eyebrow: 'Service',
    title: service.title,
    description: service.summary,
    href: serviceUrl(service.slug),
    linkLabel: 'View service',
    faqs: service.faqs,
  })),
  ...locationProfiles.map((location) => ({
    id: `location-${location.slug}`,
    eyebrow: 'Location',
    title: location.title,
    description: location.summary,
    href: locationUrl(location.slug),
    linkLabel: 'View location',
    faqs: location.faqs,
  })),
];

const allFaqs = faqSections.flatMap((section) => section.faqs);

const faqCollectionJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  '@id': `${absoluteUrl('/faq')}#faq`,
  name: 'Itemba Group Frequently Asked Questions',
  url: absoluteUrl('/faq'),
  about: {
    '@id': `${site.url}/#organization`,
  },
  mainEntity: {
    '@type': 'ItemList',
    itemListElement: faqSections.map((section, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: section.title,
      url: `${absoluteUrl('/faq')}#${section.id}`,
    })),
  },
};

export default function FaqPage() {
  return (
    <div className="bg-ink-950">
      <JsonLd
        data={[
          faqCollectionJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Frequently Asked Questions', path: '/faq' },
          ]),
          faqJsonLd(allFaqs),
        ]}
      />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-ink-950 px-5 pb-24 pt-44 sm:px-8">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.55 }} />
          <div className="hero-orb hero-orb-blue" style={{ opacity: 0.3 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 mx-auto max-w-7xl">
          <AnimatedSection>
            <div className="mb-5 flex items-center gap-3">
              <span className="h-px w-10 bg-gold-400" />
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">
                Frequently asked questions
              </span>
            </div>
            <h1 className="font-tight text-5xl font-black leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
              Answers for <span className="gradient-text">customers and partners.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-300">
              Quick answers about Itemba Group companies, services, location, and how to route
              business enquiries to the right operating team.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* ── FAQ sections ──────────────────────────────────────────── */}
      <section className="bg-ink-950 px-5 py-20 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[0.74fr_1.26fr]">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <AnimatedSection>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">
                  Browse topics
                </p>
                <div className="space-y-2">
                  {faqSections.map((section) => (
                    <a
                      key={section.id}
                      href={`#${section.id}`}
                      className="block rounded-xl bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white transition hover:text-gold-300"
                    >
                      {section.title}
                    </a>
                  ))}
                </div>
              </div>
            </AnimatedSection>
            <AnimatedSection delay={0.08} className="mt-5">
              <EnquiryRouter
                compact
                title="Still need help?"
                description="Choose the relevant enquiry type and send a prepared message to the group office."
              />
            </AnimatedSection>
          </aside>

          <div className="space-y-10">
            {faqSections.map((section, index) => (
              <AnimatedSection key={section.id} delay={index < 3 ? index * 0.04 : 0}>
                <div
                  id={section.id}
                  className="scroll-mt-28 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-7"
                >
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold-400">
                    {section.eyebrow}
                  </p>
                  <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="font-tight text-2xl font-black leading-tight tracking-tight text-white sm:text-3xl">
                        {section.title}
                      </h2>
                      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
                        {section.description}
                      </p>
                    </div>
                    <Link
                      href={section.href}
                      className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-gold-300 hover:text-gold-200"
                    >
                      {section.linkLabel}
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                    </Link>
                  </div>
                  <FaqList faqs={section.faqs} />
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
