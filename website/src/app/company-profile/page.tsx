import Link from 'next/link';
import type { Metadata } from 'next';
import AnimatedSection from '@/components/AnimatedSection';
import BrandVisual from '@/components/BrandVisual';
import EnquiryRouter from '@/components/EnquiryRouter';
import FaqList from '@/components/FaqList';
import JsonLd from '@/components/JsonLd';
import PrintProfileButton from '@/components/PrintProfileButton';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  capabilityAreas,
  companyProfiles,
  contact,
  faqJsonLd,
  groupFaqs,
  site,
} from '@/lib/site';

export const metadata: Metadata = {
  title: 'Company Profile',
  description:
    'A concise Itemba Group company profile covering subsidiaries, sectors, location, capabilities, and business enquiry channels.',
  alternates: { canonical: absoluteUrl('/company-profile') },
  openGraph: {
    title: 'Itemba Group Company Profile',
    description: 'Company profile and capability statement for Itemba Group in Songwe Region, Tanzania.',
    url: absoluteUrl('/company-profile'),
  },
};

const profileJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  '@id': `${absoluteUrl('/company-profile')}#profile`,
  name: 'Itemba Group Company Profile',
  url: absoluteUrl('/company-profile'),
  about: {
    '@id': `${site.url}/#organization`,
  },
};

export default function CompanyProfilePage() {
  return (
    <>
      <JsonLd
        data={[
          profileJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Company Profile', path: '/company-profile' },
          ]),
          faqJsonLd(groupFaqs),
        ]}
      />

      <section className="relative bg-ink-900 px-5 pb-20 pt-40 sm:px-8 print:bg-white print:pt-8">
        <div className="hero-ambient print:hidden">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.55 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <AnimatedSection>
            <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400 print:text-ink-900">
              Capability Statement
            </p>
            <h1
              className="mb-6 font-tight font-black leading-none tracking-tightest text-white print:text-ink-900"
              style={{ fontSize: 'clamp(2.8rem, 6vw, 5.5rem)' }}
            >
              Itemba Group<br />
              <span className="gradient-text print:text-ink-900">Company Profile</span>
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-slate-300 print:text-slate-700">
              A Tanzanian holding group headquartered in Mpemba-Tunduma, Songwe Region,
              operating through three independent companies across energy, trade, logistics,
              construction supply, hospitality, real estate, and related services.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <PrintProfileButton />
              <Link
                href="/contact"
                className="print-hidden btn-primary inline-flex rounded-full border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-200 hover:border-slate-300 hover:text-white"
              >
                Send enquiry
              </Link>
            </div>
          </AnimatedSection>
          <AnimatedSection direction="left" className="print:hidden">
            <div className="relative h-80 overflow-hidden rounded-3xl shadow-2xl">
              <BrandVisual variant="operations" label="Itemba Group capability overview" className="absolute inset-0" />
            </div>
          </AnimatedSection>
        </div>
      </section>

      <section className="bg-white px-5 py-20 sm:px-8 print:px-0 print:py-8">
        <div className="print-sheet mx-auto max-w-7xl">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
            <AnimatedSection className="lg:col-span-2">
              <div className="gold-line mb-6" />
              <h2 className="mb-5 font-tight text-3xl font-black leading-tight tracking-tighter text-ink-900">
                Operating Structure
              </h2>
              <p className="mb-8 text-lg leading-relaxed text-slate-600">
                Itemba Group provides central strategic oversight while each subsidiary
                operates with its own identity, market focus, and operating structure.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {companyProfiles.map((company) => (
                  <Link
                    key={company.slug}
                    href={`/companies/${company.slug}`}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:border-gold-400 hover:bg-white print:bg-white"
                  >
                    <div className={`mb-3 h-2 w-10 rounded-full ${company.accentBg}`} />
                    <h3 className="font-tight text-base font-bold text-ink-900">{company.name}</h3>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-slate-400">{company.sector}</p>
                    <p className="mt-3 text-sm leading-relaxed text-slate-600">{company.summary}</p>
                  </Link>
                ))}
              </div>
            </AnimatedSection>

            <AnimatedSection direction="left">
              <div className="rounded-2xl bg-ink-900 p-6 text-white print:border print:border-slate-200 print:bg-white print:text-ink-900">
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">Contact</p>
                <div className="space-y-4 text-sm leading-relaxed">
                  <div>
                    <div className="font-semibold">Head Office</div>
                    <p className="text-slate-300 print:text-slate-600">{contact.headOffice}</p>
                  </div>
                  <div>
                    <div className="font-semibold">Postal</div>
                    <p className="text-slate-300 print:text-slate-600">{contact.postal}</p>
                  </div>
                  <div>
                    <div className="font-semibold">Phone</div>
                    <p className="text-slate-300 print:text-slate-600">{contact.primaryPhoneDisplay}</p>
                    <p className="text-slate-300 print:text-slate-600">{contact.secondaryPhoneDisplay}</p>
                  </div>
                  <div>
                    <div className="font-semibold">Email</div>
                    <p className="break-all text-gold-400 print:text-slate-600">{contact.email}</p>
                  </div>
                </div>
              </div>
              <EnquiryRouter
                compact
                title="Send a routed enquiry"
                description="Select the relevant operating area and contact the group office with a prepared message."
                className="print-hidden mt-5"
              />
            </AnimatedSection>
          </div>

          <div className="mt-20">
            <AnimatedSection>
              <div className="gold-line mb-6" />
              <h2 className="mb-8 font-tight text-3xl font-black leading-tight tracking-tighter text-ink-900">
                Capability Areas
              </h2>
            </AnimatedSection>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              {capabilityAreas.map((area, index) => (
                <AnimatedSection key={area.title} delay={index * 0.08}>
                  <div className="h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:shadow-none">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">{area.company}</p>
                    <h3 className="mb-3 font-tight text-xl font-bold text-ink-900">{area.title}</h3>
                    <p className="mb-5 text-sm leading-relaxed text-slate-600">{area.summary}</p>
                    <div className="space-y-3">
                      {area.points.map((point) => (
                        <div key={point} className="flex gap-3 text-sm text-slate-600">
                          <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-gold-500" />
                          <span>{point}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </AnimatedSection>
              ))}
            </div>
          </div>

          <AnimatedSection className="mt-20">
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <div className="gold-line mb-6" />
                <h2 className="mb-4 font-tight text-3xl font-black leading-tight tracking-tighter text-ink-900">
                  Common Questions
                </h2>
                <p className="text-sm leading-relaxed text-slate-600">
                  Quick answers for customers, suppliers, and partners reviewing the group profile.
                </p>
              </div>
              <FaqList faqs={groupFaqs} />
            </div>
          </AnimatedSection>
        </div>
      </section>
    </>
  );
}
