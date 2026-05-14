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
  { name: 'Mwanjalisi Oil Co Ltd',    sector: 'Energy & Fuel Distribution',  dot: 'bg-amber-400' },
  { name: 'Westsides Company Ltd',    sector: 'Trade & Distribution',         dot: 'bg-blue-400' },
  { name: 'Itemba Enterprises Co Ltd', sector: 'Multi-Sector Operations',    dot: 'bg-emerald-400' },
];

const contextCards = [
  { icon: '🗺️', title: 'Strategic Location',  desc: "Mpemba-Tunduma sits on the Tanzania-Zambia border — one of East Africa's most active trade corridors." },
  { icon: '🤝', title: 'Regional Connections', desc: 'Direct access to cross-border trade flows and a wide network of regional business partners.' },
  { icon: '📈', title: 'Growing Economy',       desc: "Songwe Region is one of Tanzania's fastest-growing regions, driven by trade and infrastructure investment." },
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
    <>
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
      <section className="relative bg-ink-900 pt-40 pb-24 px-5 sm:px-8 overflow-hidden">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.6 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 max-w-7xl mx-auto">
          <AnimatedSection delay={0}>
            <p className="text-gold-400 text-xs font-semibold uppercase tracking-widest mb-4">Get In Touch</p>
          </AnimatedSection>
          <AnimatedSection delay={0.08}>
            <h1
              className="font-tight font-black text-white leading-none tracking-tightest mb-6"
              style={{ fontSize: 'clamp(2.8rem, 6vw, 5.5rem)' }}
            >
              Contact<br />
              <span className="gradient-text">Itemba Group</span>
            </h1>
          </AnimatedSection>
          <AnimatedSection delay={0.16}>
            <p className="text-slate-300 text-lg max-w-xl leading-relaxed">
              Reach out for business enquiries, partnerships, or general information about
              our companies and operations.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Contact details ───────────────────────────────────────── */}
      <section className="py-28 px-5 sm:px-8 bg-white">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">

          {/* Left — address */}
          <div>
            <AnimatedSection delay={0}>
              <div className="gold-line mb-6" />
              <p className="text-gold-600 text-xs font-semibold uppercase tracking-widest mb-3">Find Us</p>
              <h2 className="font-tight font-black text-ink-900 text-3xl sm:text-4xl leading-none tracking-tighter mb-10">
                Group Headquarters
              </h2>
            </AnimatedSection>

            <AnimatedSection delay={0.1}>
              <div className="space-y-7">
                {/* Head office */}
                <div className="flex gap-5">
                  <div className="w-12 h-12 rounded-2xl bg-ink-100 flex items-center justify-center flex-shrink-0 text-ink-700">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div>
                    <div className="font-tight font-bold text-ink-900 mb-1">Head Office</div>
                    <address className="text-slate-500 text-sm not-italic leading-relaxed">
                      Itemba Filling Station<br />
                      Along Tunduma–Ileje Highway<br />
                      Mpemba, Tunduma
                    </address>
                  </div>
                </div>

                {/* Postal address */}
                <div className="flex gap-5">
                  <div className="w-12 h-12 rounded-2xl bg-ink-100 flex items-center justify-center flex-shrink-0 text-ink-700">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <div className="font-tight font-bold text-ink-900 mb-1">Postal Address</div>
                    <address className="text-slate-500 text-sm not-italic leading-relaxed">
                      P.O. Box 132<br />
                      Tunduma–Songwe<br />
                      Tanzania
                    </address>
                  </div>
                </div>

                {/* Phone */}
                <div className="flex gap-5">
                  <div className="w-12 h-12 rounded-2xl bg-ink-100 flex items-center justify-center flex-shrink-0 text-ink-700">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </div>
                  <div>
                    <div className="font-tight font-bold text-ink-900 mb-1">Phone</div>
                    <div className="text-sm leading-relaxed space-y-0.5">
                      <a href="tel:+255758793511" className="block text-gold-600 hover:text-gold-500 hover:underline transition-colors">
                        +255 758 793 511
                      </a>
                      <a href="tel:+255745215047" className="block text-gold-600 hover:text-gold-500 hover:underline transition-colors">
                        +255 745 215 047
                      </a>
                    </div>
                  </div>
                </div>

                {/* Email */}
                <div className="flex gap-5">
                  <div className="w-12 h-12 rounded-2xl bg-ink-100 flex items-center justify-center flex-shrink-0 text-ink-700">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <div className="font-tight font-bold text-ink-900 mb-1">Email</div>
                    <a href="mailto:info@itembagrouptz.com" className="text-gold-600 text-sm hover:text-gold-500 hover:underline transition-colors break-all">
                      info@itembagrouptz.com
                    </a>
                  </div>
                </div>

                {/* Website */}
                <div className="flex gap-5">
                  <div className="w-12 h-12 rounded-2xl bg-ink-100 flex items-center justify-center flex-shrink-0 text-ink-700">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
                    </svg>
                  </div>
                  <div>
                    <div className="font-tight font-bold text-ink-900 mb-1">Website</div>
                    <a href="https://itembagrouptz.com" className="text-gold-600 text-sm hover:text-gold-500 hover:underline transition-colors">
                      itembagrouptz.com
                    </a>
                  </div>
                </div>
              </div>
            </AnimatedSection>

            <AnimatedSection delay={0.18}>
              <div className="mt-10 p-6 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-600 leading-relaxed">
                <strong className="font-tight font-bold text-ink-900 block mb-1">Business Enquiries</strong>
                For sector-specific enquiries, we recommend contacting the relevant subsidiary company directly. Each company operates with its own team and management structure.
                <div className="mt-3 flex flex-wrap gap-4">
                  <Link href="/partnerships" className="font-semibold text-gold-600 hover:text-gold-500">
                    Partnership enquiry routes
                  </Link>
                  <Link href="/faq" className="font-semibold text-gold-600 hover:text-gold-500">
                    Browse frequently asked questions
                  </Link>
                </div>
              </div>
            </AnimatedSection>

            <AnimatedSection delay={0.22}>
              <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <a
                  href={`tel:${contact.primaryPhone}`}
                  className="btn-primary rounded-2xl bg-ink-900 px-5 py-4 text-center text-sm font-semibold text-white hover:bg-ink-700"
                >
                  Call
                </a>
                <a
                  href={contact.whatsapp}
                  className="btn-primary rounded-2xl bg-emerald-600 px-5 py-4 text-center text-sm font-semibold text-white hover:bg-emerald-500"
                >
                  WhatsApp
                </a>
                <a
                  href={mailtoWithSubject('Business enquiry')}
                  className="btn-primary rounded-2xl bg-gold-500 px-5 py-4 text-center text-sm font-semibold text-white hover:bg-gold-400"
                >
                  Email
                </a>
              </div>
            </AnimatedSection>
          </div>

          {/* Right — map + subsidiaries */}
          <div className="space-y-8">
            <AnimatedSection direction="left" delay={0.06}>
              <EnquiryRouter />
            </AnimatedSection>

            <AnimatedSection direction="left" delay={0.1}>
              <div className="relative h-72 rounded-3xl overflow-hidden shadow-xl border border-slate-200">
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
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">Our Companies</p>
              <div className="space-y-3">
                {subsidiaries.map((co) => (
                  <div key={co.name} className="flex items-center gap-4 p-5 border border-slate-200 rounded-2xl hover:border-gold-400/50 hover:bg-slate-50 transition-all group">
                    <div className={`w-2.5 h-2.5 rounded-full ${co.dot} flex-shrink-0`} />
                    <div>
                      <div className="font-tight font-semibold text-ink-900 text-sm group-hover:text-ink-700">{co.name}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{co.sector}</div>
                    </div>
                  </div>
                ))}
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* ── Location context ──────────────────────────────────────── */}
      <section className="py-20 px-5 sm:px-8 bg-slate-50 border-t border-slate-100">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {contextCards.map((card, i) => (
              <AnimatedSection key={card.title} delay={i * 0.1}>
                <div className="bg-white rounded-2xl border border-slate-200 p-7 hover:shadow-md transition-shadow">
                  <div className="text-3xl mb-4">{card.icon}</div>
                  <h3 className="font-tight font-bold text-ink-900 mb-2">{card.title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{card.desc}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
