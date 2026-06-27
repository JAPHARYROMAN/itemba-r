import type { Metadata } from 'next';
import Link from 'next/link';
import AnimatedSection from '@/components/AnimatedSection';
import EnquiryRouter from '@/components/EnquiryRouter';
import JsonLd from '@/components/JsonLd';
import { absoluteUrl, breadcrumbJsonLd, contact, mailtoWithSubject, site } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Contact Itemba Group for business enquiries, partnerships, fuel, trade, logistics, hospitality, real estate, and group information.',
  alternates: { canonical: absoluteUrl('/contact') },
  openGraph: {
    title: 'Contact Itemba Group',
    description: 'Reach Itemba Group headquarters in Mpemba-Tunduma, Songwe Region, Tanzania.',
    url: absoluteUrl('/contact'),
  },
};

const subsidiaries = [
  { name: 'Mwanjalisi Oil Co Ltd', sector: 'Energy, Fuel & Parking', dot: 'bg-amber-400' },
  { name: 'Westsides Company Ltd', sector: 'Trade & Distribution', dot: 'bg-blue-400' },
  { name: 'Itemba Enterprises Co Ltd', sector: 'Logistics & Transit', dot: 'bg-emerald-400' },
];

const contextCards = [
  {
    icon: '🗺️',
    title: 'Strategic location',
    desc: "Mpemba-Tunduma sits on the Tanzania-Zambia border — one of East Africa's most active trade corridors.",
  },
  {
    icon: '🤝',
    title: 'Regional connections',
    desc: 'Direct access to cross-border trade flows and a wide network of regional business partners.',
  },
  {
    icon: '📈',
    title: 'Growing economy',
    desc: "Songwe Region is one of Tanzania's fastest-growing regions, driven by trade and infrastructure investment.",
  },
];

const contactRows = [
  {
    title: 'Head office',
    body: (
      <address className="text-sm not-italic leading-relaxed text-slate-400">
        Itemba Filling Station
        <br />
        Along Tunduma–Ileje Highway
        <br />
        Mpemba, Tunduma
      </address>
    ),
  },
  {
    title: 'Postal address',
    body: (
      <address className="text-sm not-italic leading-relaxed text-slate-400">
        P.O. Box 132
        <br />
        Tunduma–Songwe
        <br />
        Tanzania
      </address>
    ),
  },
];

const contactPageJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'ContactPage',
  '@id': `${absoluteUrl('/contact')}#contact`,
  name: 'Contact Itemba Group',
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
      areaServed: ['TZ', 'ZM'],
      availableLanguage: ['English', 'Swahili'],
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
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">
                Get in touch
              </span>
            </div>
            <h1 className="font-tight text-5xl font-black leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
              Contact <span className="gradient-text">Itemba Group</span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-slate-300">
              Reach out for business enquiries, partnerships, or general information about our
              companies and operations.
            </p>
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
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">
                Find us
              </p>
              <h2 className="mb-10 font-tight text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">
                Group headquarters
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
                    <div className="mb-1 font-tight font-bold text-white">Phone</div>
                    <div className="space-y-0.5 text-sm leading-relaxed">
                      <a href="tel:+255758793511" className="block text-gold-300 transition-colors hover:text-gold-200">
                        +255 758 793 511
                      </a>
                      <a href="tel:+255745215047" className="block text-gold-300 transition-colors hover:text-gold-200">
                        +255 745 215 047
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
                    <div className="mb-1 font-tight font-bold text-white">Email</div>
                    <a href="mailto:info@itembagrouptz.com" className="break-all text-sm text-gold-300 transition-colors hover:text-gold-200">
                      info@itembagrouptz.com
                    </a>
                  </div>
                </div>
              </div>
            </AnimatedSection>

            <AnimatedSection delay={0.18}>
              <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm leading-relaxed text-slate-400">
                <strong className="mb-1 block font-tight font-bold text-white">
                  Business enquiries
                </strong>
                For sector-specific enquiries, we recommend contacting the relevant subsidiary
                company directly. Each company operates with its own team and management structure.
                <div className="mt-3 flex flex-wrap gap-4">
                  <Link href="/partnerships" className="font-semibold text-gold-300 hover:text-gold-200">
                    Partnership enquiry routes
                  </Link>
                  <Link href="/faq" className="font-semibold text-gold-300 hover:text-gold-200">
                    Browse frequently asked questions
                  </Link>
                </div>
              </div>
            </AnimatedSection>

            <AnimatedSection delay={0.22}>
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <a href={`tel:${contact.primaryPhone}`} className="btn-primary rounded-2xl border border-white/20 bg-white/5 px-5 py-4 text-center text-sm font-semibold text-white hover:bg-white/10">
                  Call
                </a>
                <a href={contact.whatsapp} className="btn-primary rounded-2xl bg-emerald-600 px-5 py-4 text-center text-sm font-semibold text-white hover:bg-emerald-500">
                  WhatsApp
                </a>
                <a href={mailtoWithSubject('Business enquiry')} className="btn-primary rounded-2xl bg-gold-500 px-5 py-4 text-center text-sm font-semibold text-white hover:bg-gold-400">
                  Email
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
                  title="Itemba Group headquarters map"
                  src={`https://www.google.com/maps?q=${encodeURIComponent(contact.mapQuery)}&output=embed`}
                  className="h-full w-full"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            </AnimatedSection>

            <AnimatedSection direction="left" delay={0.18}>
              <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">
                Our companies
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
            {contextCards.map((card, i) => (
              <AnimatedSection key={card.title} delay={i * 0.1}>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 transition hover:bg-white/[0.06]">
                  <div className="mb-4 text-3xl">{card.icon}</div>
                  <h3 className="mb-2 font-tight font-bold text-white">{card.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-400">{card.desc}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
