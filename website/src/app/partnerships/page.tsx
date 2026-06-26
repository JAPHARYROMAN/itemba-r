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
  partnershipAreas,
  partnershipFaqs,
  serviceAreas,
  serviceUrl,
  site,
} from '@/lib/site';

export const metadata: Metadata = {
  title: 'Partnerships',
  description:
    'Partnership and business enquiry routes for suppliers, bulk buyers, contractors, logistics customers, fuel customers, property, hospitality, and regional partners working with Itemba Group.',
  alternates: { canonical: absoluteUrl('/partnerships') },
  openGraph: {
    title: 'Partner with Itemba Group',
    description:
      'Supplier introductions, bulk purchase enquiries, fuel, logistics, construction supply, hospitality, and property opportunities with Itemba Group.',
    url: absoluteUrl('/partnerships'),
  },
};

const partnershipsJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': `${absoluteUrl('/partnerships')}#partnerships`,
  name: 'Partner with Itemba Group',
  url: absoluteUrl('/partnerships'),
  description: metadata.description,
  about: {
    '@id': `${site.url}/#organization`,
  },
  mainEntity: {
    '@type': 'ItemList',
    itemListElement: partnershipAreas.map((area, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: area.title,
      description: area.summary,
    })),
  },
};

function getCompanyName(slug: string) {
  return companyProfiles.find((company) => company.slug === slug)?.name ?? slug;
}

function getServiceTitle(slug: string) {
  return serviceAreas.find((service) => service.slug === slug)?.shortTitle ?? slug;
}

export default function PartnershipsPage() {
  return (
    <div className="bg-ink-950">
      <JsonLd
        data={[
          partnershipsJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Partnerships', path: '/partnerships' },
          ]),
          faqJsonLd(partnershipFaqs),
        ]}
      />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-ink-950 px-5 pb-24 pt-44 sm:px-8">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.55 }} />
          <div className="hero-orb hero-orb-blue" style={{ opacity: 0.28 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 mx-auto max-w-7xl">
          <AnimatedSection>
            <div className="mb-5 flex items-center gap-3">
              <span className="h-px w-10 bg-gold-400" />
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">
                Business development
              </span>
            </div>
            <h1 className="font-tight text-5xl font-black leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
              Partner with <span className="gradient-text">Itemba Group.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-300">
              A clear route for suppliers, commercial buyers, contractors, transport operators,
              hospitality customers, property stakeholders and regional business partners.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Partnership routes ────────────────────────────────────── */}
      <section className="overflow-hidden bg-ink-950 px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <AnimatedSection className="mb-10">
              <div className="gold-line mb-6" />
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">
                Partnership routes
              </p>
              <h2 className="font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
                Start with the right operating team
              </h2>
            </AnimatedSection>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {partnershipAreas.map((area, index) => (
                <AnimatedSection key={area.id} delay={index * 0.05}>
                  <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-gold-400/50 hover:bg-white/[0.06]">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold-400">
                      Routed to {area.routeTo}
                    </p>
                    <h3 className="mb-3 font-tight text-2xl font-black leading-tight tracking-tight text-white">
                      {area.title}
                    </h3>
                    <p className="mb-5 text-sm leading-relaxed text-slate-400">{area.summary}</p>

                    <div className="mb-5">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
                        Good fit for
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {area.goodFit.map((fit) => (
                          <span key={fit} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-medium text-white/80">
                            {fit}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Companies</p>
                        <div className="space-y-1.5">
                          {area.companySlugs.map((slug) => (
                            <Link key={slug} href={companyUrl(slug)} className="block text-gold-300 hover:text-gold-200">
                              {getCompanyName(slug)}
                            </Link>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Services</p>
                        <div className="space-y-1.5">
                          {area.serviceSlugs.map((slug) => (
                            <Link key={slug} href={serviceUrl(slug)} className="block text-gold-300 hover:text-gold-200">
                              {getServiceTitle(slug)}
                            </Link>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </AnimatedSection>
              ))}
            </div>
          </div>

          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            <AnimatedSection direction="left">
              <EnquiryRouter
                title="Route a partnership enquiry"
                description="Choose the closest enquiry type and send a prepared message to the group office."
              />
            </AnimatedSection>

            <AnimatedSection direction="left" delay={0.08}>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">
                  How enquiries move
                </p>
                <div className="space-y-4">
                  {[
                    ['1', 'Select the closest route'],
                    ['2', 'Send details by WhatsApp, email, or phone'],
                    ['3', 'The group office routes the enquiry internally'],
                    ['4', 'The relevant company or division follows up'],
                  ].map(([step, label]) => (
                    <div key={step} className="flex gap-3 text-sm text-slate-300">
                      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gold-500 text-xs font-bold text-white">
                        {step}
                      </span>
                      <span className="pt-1">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </AnimatedSection>
          </aside>
        </div>
      </section>

      {/* ── Partnership questions ─────────────────────────────────── */}
      <section className="overflow-hidden bg-ink-950 px-5 py-20 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 lg:grid-cols-[0.75fr_1.25fr]">
          <AnimatedSection>
            <div className="gold-line mb-6" />
            <h2 className="mb-4 font-tight text-3xl font-black leading-tight tracking-tight text-white">
              Partnership questions
            </h2>
            <p className="text-sm leading-relaxed text-slate-400">
              Practical answers for suppliers, buyers, logistics customers and partners preparing to
              contact Itemba Group.
            </p>
          </AnimatedSection>
          <AnimatedSection direction="left">
            <FaqList faqs={partnershipFaqs} />
          </AnimatedSection>
        </div>
      </section>
    </div>
  );
}
