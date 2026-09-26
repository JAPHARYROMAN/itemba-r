import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';
import AnimatedSection from '@/components/AnimatedSection';
import EnquiryRouter from '@/components/EnquiryRouter';
import JsonLd from '@/components/JsonLd';
import { companies } from '@/content/companies';
import { mailtoHref, mapsEmbedUrl, telHref } from '@/content/contact';
import { contactPage } from '@/content/contactPage';
import { businessEnquirySubject } from '@/content/enquiry';
import type { CompanyId } from '@/content/types';
import { absoluteUrl, breadcrumbJsonLd, contact, mailtoWithSubject, site } from '@/lib/site';

const { meta, hero, findUs, businessNote, quickActions } = contactPage;

export const metadata: Metadata = {
  title: meta.title,
  description: meta.description,
  alternates: { canonical: absoluteUrl('/contact') },
  openGraph: {
    title: meta.ogTitle,
    description: meta.ogDescription,
    url: absoluteUrl('/contact'),
  },
};

const companyDot: Record<CompanyId, string> = {
  mwanjalisi: 'bg-amber-400',
  westsides: 'bg-blue-400',
  enterprises: 'bg-emerald-400',
};

const subsidiaries = companies.map((company) => ({
  name: company.name,
  sector: company.band.sector,
  dot: companyDot[company.id],
}));

const contextIcons: Record<(typeof contactPage.contextCards)[number]['id'], string> = {
  location: '🗺️',
  connections: '🤝',
  growth: '📈',
};

function AddressLines({ lines }: { lines: readonly string[] }) {
  return (
    <address className="text-sm not-italic leading-relaxed text-slate-400">
      {lines.map((line, index) => (
        <Fragment key={line}>
          {index > 0 ? <br /> : null}
          {line}
        </Fragment>
      ))}
    </address>
  );
}

const contactRows = [
  { title: findUs.headOfficeLabel, body: <AddressLines lines={contact.headOfficeLines} /> },
  { title: findUs.postalLabel, body: <AddressLines lines={contact.postalLines} /> },
];

const contactPageJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'ContactPage',
  '@id': `${absoluteUrl('/contact')}#contact`,
  name: meta.ogTitle,
  url: absoluteUrl('/contact'),
  about: {
    '@id': `${site.url}/#organization`,
  },
  contactPoint: [
    {
      '@type': 'ContactPoint',
      telephone: contact.primaryPhoneDisplay,
      email: contact.email,
      contactType: 'business enquiries',
      areaServed: contact.areaServed,
      availableLanguage: contact.availableLanguages,
    },
  ],
};

export default function ContactPage() {
  return (
    <div className="bg-ink-950">
      <JsonLd
        data={[
          contactPageJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Contact', path: '/contact' },
          ]),
        ]}
      />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-ink-950 px-5 pb-24 pt-44 sm:px-8">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.55 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 mx-auto max-w-7xl">
          <AnimatedSection>
            <div className="mb-5 flex items-center gap-3">
              <span className="h-px w-10 bg-gold-400" />
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">{hero.eyebrow}</span>
            </div>
            <h1 className="font-tight text-5xl font-black leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
              {hero.headline.lead} <span className="gradient-text">{hero.headline.accent}</span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-slate-300">{hero.lede}</p>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Contact details ───────────────────────────────────────── */}
      <section className="bg-ink-950 px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-start gap-16 lg:grid-cols-2">
          {/* Left — address */}
          <div>
            <AnimatedSection>
              <div className="gold-line mb-6" />
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">{findUs.eyebrow}</p>
              <h2 className="mb-10 font-tight text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">
                {findUs.title}
              </h2>
            </AnimatedSection>

            <AnimatedSection delay={0.1}>
              <div className="space-y-7">
                {contactRows.map((row) => (
                  <div key={row.title} className="flex gap-5">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] text-gold-300">
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <div>
                      <div className="mb-1 font-tight font-bold text-white">{row.title}</div>
                      {row.body}
                    </div>
                  </div>
                ))}

                <div className="flex gap-5">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] text-gold-300">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </div>
                  <div>
                    <div className="mb-1 font-tight font-bold text-white">{findUs.phoneLabel}</div>
                    <div className="space-y-0.5 text-sm leading-relaxed">
                      <a href={telHref(contact.primaryPhone)} className="block text-gold-300 transition-colors hover:text-gold-200">
                        {contact.primaryPhoneDisplay}
                      </a>
                      <a href={telHref(contact.secondaryPhone)} className="block text-gold-300 transition-colors hover:text-gold-200">
                        {contact.secondaryPhoneDisplay}
                      </a>
                    </div>
                  </div>
                </div>

                <div className="flex gap-5">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] text-gold-300">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <div className="mb-1 font-tight font-bold text-white">{findUs.emailLabel}</div>
                    <a href={mailtoHref()} className="break-all text-sm text-gold-300 transition-colors hover:text-gold-200">
                      {contact.email}
                    </a>
                  </div>
                </div>
              </div>
            </AnimatedSection>

            <AnimatedSection delay={0.18}>
              <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm leading-relaxed text-slate-400">
                <strong className="mb-1 block font-tight font-bold text-white">{businessNote.title}</strong>
                {businessNote.body}
                <div className="mt-3 flex flex-wrap gap-4">
                  {businessNote.links.map((link) => (
                    <Link key={link.href} href={link.href} className="font-semibold text-gold-300 hover:text-gold-200">
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            </AnimatedSection>

            <AnimatedSection delay={0.22}>
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <a href={telHref(contact.primaryPhone)} className="btn-primary rounded-2xl border border-white/20 bg-white/5 px-5 py-4 text-center text-sm font-semibold text-white hover:bg-white/10">
                  {quickActions.call}
                </a>
                <a href={contact.whatsapp} className="btn-primary rounded-2xl bg-emerald-600 px-5 py-4 text-center text-sm font-semibold text-white hover:bg-emerald-500">
                  {quickActions.whatsapp}
                </a>
                <a href={mailtoWithSubject(businessEnquirySubject)} className="btn-primary rounded-2xl bg-gold-500 px-5 py-4 text-center text-sm font-semibold text-white hover:bg-gold-400">
                  {quickActions.email}
                </a>
              </div>
            </AnimatedSection>
          </div>

          {/* Right — form + map + subsidiaries */}
          <div className="space-y-8">
            <AnimatedSection direction="left" delay={0.06}>
              <EnquiryRouter />
            </AnimatedSection>

            <AnimatedSection direction="left" delay={0.1}>
              <div className="relative h-72 overflow-hidden rounded-3xl border border-white/10 shadow-xl">
                <iframe
                  title={contactPage.mapTitle}
                  src={mapsEmbedUrl()}
                  className="h-full w-full"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            </AnimatedSection>

            <AnimatedSection direction="left" delay={0.18}>
              <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">
                {contactPage.companiesHeading}
              </p>
              <div className="space-y-3">
                {subsidiaries.map((co) => (
                  <div
                    key={co.name}
                    className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-all hover:border-gold-400/50 hover:bg-white/[0.06]"
                  >
                    <div className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${co.dot}`} />
                    <div>
                      <div className="font-tight text-sm font-semibold text-white">{co.name}</div>
                      <div className="mt-0.5 text-xs text-slate-400">{co.sector}</div>
                    </div>
                  </div>
                ))}
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* ── Location context ──────────────────────────────────────── */}
      <section className="border-t border-white/5 bg-ink-950 px-5 py-20 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {/* Legacy page renders all three cards (origin/main); the rebuilt page applies `requires`. */}
            {contactPage.contextCards.map((card, i) => (
              <AnimatedSection key={card.title} delay={i * 0.1}>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 transition hover:bg-white/[0.06]">
                  <div className="mb-4 text-3xl">{contextIcons[card.id]}</div>
                  <h3 className="mb-2 font-tight font-bold text-white">{card.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-400">{card.summary}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
