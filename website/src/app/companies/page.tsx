import Link from 'next/link';
import type { Metadata } from 'next';
import AnimatedSection from '@/components/AnimatedSection';
import BrandVisual from '@/components/BrandVisual';
import { absoluteUrl, companyUrl, mailtoWithSubject } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Our Companies',
  description:
    'Explore Itemba Group subsidiaries: Mwanjalisi Oil Co Ltd, Westsides Company Ltd, and Itemba Enterprises Co Ltd.',
  alternates: { canonical: absoluteUrl('/companies') },
  openGraph: {
    title: 'Itemba Group Companies',
    description: 'Three independent companies operating across energy, trade, logistics, hospitality, real estate, and construction.',
    url: absoluteUrl('/companies'),
  },
};

const companies = [
  {
    id: 'mwanjalisi',
    name: 'Mwanjalisi Oil Co Ltd',
    sector: 'Energy & Fuel Distribution',
    accentColor: '#f59e0b',
    accentClass: 'text-amber-400',
    accentBg: 'bg-amber-500',
    accentBorder: 'border-amber-500/30',
    accentGlow: 'shadow-amber-500/20',
    visual: 'fuel' as const,
    profileHref: companyUrl('mwanjalisi-oil'),
    summary: "Tanzania's petroleum retail arm within Itemba Group — delivering reliable fuel supply to businesses, transport operators, and communities across the Songwe region and beyond.",
    detail: "Positioned in a high-traffic corridor near the Tanzania-Zambia border, Mwanjalisi Oil serves a diverse customer base from individual motorists to commercial fleet operators. The company's fuel stations are designed for reliability, safety, and operational efficiency.",
    products: ['Diesel', 'Petrol', 'Kerosene', 'Lubricants'],
    gallery: [
      { visual: 'fuel' as const, cap: 'Fuel pumps' },
      { visual: 'corridor' as const, cap: 'Forecourt' },
      { visual: 'hardware' as const, cap: 'Lubricants' },
    ],
    divisions: [],
  },
  {
    id: 'westsides',
    name: 'Westsides Company Ltd',
    sector: 'Trade & Distribution',
    accentColor: '#3b82f6',
    accentClass: 'text-blue-400',
    accentBg: 'bg-blue-500',
    accentBorder: 'border-blue-500/30',
    accentGlow: 'shadow-blue-500/20',
    visual: 'trade' as const,
    profileHref: companyUrl('westsides-company'),
    summary: 'Wholesale and retail distribution covering beverages and construction goods — serving both consumer markets and business customers across the Songwe region.',
    detail: "Westsides bridges two high-demand markets: beverage distribution and construction supply. Its network reaches retailers, contractors, and hospitality businesses, making it a central distribution hub in the region's trade ecosystem.",
    products: ['Alcoholic Beverages', 'Non-Alcoholic Beverages', 'Building Materials', 'Hand & Power Tools', 'Electrical Supplies'],
    gallery: [
      { visual: 'trade' as const, cap: 'Beverages' },
      { visual: 'hardware' as const, cap: 'Hardware' },
      { visual: 'logistics' as const, cap: 'Warehouse' },
    ],
    divisions: [],
  },
  {
    id: 'enterprises',
    name: 'Itemba Enterprises Co Ltd',
    sector: 'Multi-Sector Operations',
    accentColor: '#10b981',
    accentClass: 'text-emerald-400',
    accentBg: 'bg-emerald-500',
    accentBorder: 'border-emerald-500/30',
    accentGlow: 'shadow-emerald-500/20',
    visual: 'logistics' as const,
    profileHref: companyUrl('itemba-enterprises'),
    summary: "The group's multi-sector flagship — anchored by logistics for local distribution and cross-border transit, alongside manufacturing, hardware, real estate, and hospitality — operating through five specialised business divisions.",
    detail: "Itemba Enterprises acts as the group's growth engine across multiple consumer and service markets. Logistics is its largest line of business, leveraging the strategic Tunduma corridor for local distribution and cross-border transit between Tanzania, Zambia, and the wider region. The remaining four divisions create a self-reinforcing ecosystem of products and services — from building materials to hospitality — all under one parent entity.",
    products: ['Local Logistics', 'Cross-Border Transit', 'Industrial Goods', 'Consumer Goods', 'Building Materials', 'Property Services', 'Hotel & Lodging', 'Parking Yard'],
    gallery: [
      { visual: 'logistics' as const, cap: 'Itemba Logistics' },
      { visual: 'hardware' as const, cap: 'Itemba Hardware' },
      { visual: 'hospitality' as const, cap: 'Uzunguni Inn' },
    ],
    divisions: [
      { name: 'Itemba Logistics',    desc: 'Local distribution and cross-border transit logistics through the Tunduma corridor — the flagship business of Itemba Enterprises.', visual: 'logistics' as const, flagship: true },
      { name: 'Itemba Hardware',     desc: 'Building materials, hand tools, power tools, and electrical supplies to contractors and retail customers.',                          visual: 'hardware' as const },
      { name: 'Itemba Estate',       desc: 'Property development, real estate management, and property-related services in the Songwe region.',                                  visual: 'estate' as const },
      { name: 'Uzunguni Inn',        desc: 'Hotel accommodation, restaurant dining, and lodging services for travellers and business guests.',                                    visual: 'hospitality' as const },
      { name: 'Uzunguni Parking Yard', desc: 'Secure parking yard services supporting the movement of goods and vehicles in the region.',                                         visual: 'parking' as const },
    ],
  },
];

export default function CompaniesPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative bg-ink-900 pt-40 pb-24 px-5 sm:px-8 overflow-hidden">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.6 }} />
          <div className="hero-orb hero-orb-blue" style={{ opacity: 0.4 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 max-w-7xl mx-auto">
          <AnimatedSection delay={0}>
            <p className="text-gold-400 text-xs font-semibold uppercase tracking-widest mb-4">Our Subsidiaries</p>
          </AnimatedSection>
          <AnimatedSection delay={0.08}>
            <h1
              className="font-tight font-black text-white leading-none tracking-tightest mb-6"
              style={{ fontSize: 'clamp(2.8rem, 6vw, 5.5rem)' }}
            >
              Three Companies.<br />
              <span className="gradient-text">Six Sectors.</span>
            </h1>
          </AnimatedSection>
          <AnimatedSection delay={0.16}>
            <p className="text-slate-300 text-lg max-w-2xl leading-relaxed">
              Each subsidiary is legally and operationally independent — with its own
              identity, focus, and market — all unified under the Itemba Group umbrella.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Company profiles ──────────────────────────────────────── */}
      <div className="bg-white">
        {companies.map((co, idx) => (
          <section key={co.id} id={co.id} className="scroll-mt-16 py-24 px-5 sm:px-8 border-t border-slate-100">
            <div className="max-w-7xl mx-auto">

              {/* Company hero banner */}
              <AnimatedSection>
                <div className="relative h-72 sm:h-96 rounded-3xl overflow-hidden shadow-2xl mb-14 img-zoom">
                  <BrandVisual variant={co.visual} label={`${co.name} operations`} className="absolute inset-0 img-inner" />
                  <div className="absolute inset-0 bg-gradient-to-r from-ink-950/90 via-ink-950/60 to-transparent" />
                  <div className="absolute inset-0 flex items-end p-10">
                    <div>
                      <span className={`${co.accentBg} text-white text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full inline-block mb-3`}>
                        {co.sector}
                      </span>
                      <h2 className="font-tight font-black text-white text-3xl sm:text-4xl leading-none">{co.name}</h2>
                    </div>
                  </div>
                </div>
              </AnimatedSection>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                {/* Main content */}
                <div className="lg:col-span-2">
                  <AnimatedSection delay={0.05}>
                    <p className="text-slate-700 text-lg leading-relaxed mb-4">{co.summary}</p>
                    <p className="text-slate-500 leading-relaxed mb-8">{co.detail}</p>
                  </AnimatedSection>

                  {/* Products */}
                  <AnimatedSection delay={0.1}>
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
                      Products &amp; Services
                    </p>
                    <div className="flex flex-wrap gap-2 mb-10">
                      {co.products.map((p) => (
                        <span key={p} className="text-xs font-medium text-ink-800 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-full">
                          {p}
                        </span>
                      ))}
                    </div>
                    <div className="mb-10 flex flex-wrap gap-3">
                      <Link
                        href={co.profileHref}
                        className="btn-primary inline-flex items-center rounded-full bg-ink-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink-700"
                      >
                        Open company profile
                      </Link>
                      <a
                        href={mailtoWithSubject(`${co.name} business enquiry`)}
                        className="btn-primary inline-flex items-center rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-ink-900 transition hover:border-gold-400 hover:text-gold-600"
                      >
                        Send enquiry
                      </a>
                    </div>
                  </AnimatedSection>

                  {/* Gallery */}
                  <AnimatedSection delay={0.15}>
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">Gallery</p>
                    <div className="grid grid-cols-3 gap-3">
                      {co.gallery.map((img) => (
                        <div key={img.cap} className="relative h-32 rounded-xl overflow-hidden group img-zoom">
                          <BrandVisual variant={img.visual} label={img.cap} className="absolute inset-0 img-inner" />
                          <div className="absolute inset-0 bg-ink-900/30 group-hover:bg-ink-900/10 transition-colors" />
                        </div>
                      ))}
                    </div>
                  </AnimatedSection>
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                  <AnimatedSection delay={0.1} direction="left">
                    <div className={`border-l-2 ${co.accentBorder} pl-5 space-y-5`}>
                      <div>
                        <div className="text-xs text-slate-400 mb-1">Sector</div>
                        <div className={`font-semibold text-sm ${co.accentClass}`}>{co.sector}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 mb-1">Structure</div>
                        <div className="font-semibold text-sm text-ink-900">Subsidiary of Itemba Group</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 mb-1">Location</div>
                        <div className="font-semibold text-sm text-ink-900">Songwe Region, Tanzania</div>
                      </div>
                    </div>
                  </AnimatedSection>

                  {/* Divisions (Itemba Enterprises only) */}
                  {co.divisions.length > 0 && (
                    <AnimatedSection delay={0.2} direction="left">
                      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">Business Divisions</p>
                      <div className="space-y-4">
                        {co.divisions.map((div) => {
                          const isFlagship = 'flagship' in div && div.flagship;
                          return (
                            <div
                              key={div.name}
                              className={`rounded-2xl overflow-hidden border group hover:shadow-md transition-shadow ${
                                isFlagship ? 'border-gold-400 shadow-md shadow-gold-500/10' : 'border-slate-200'
                              }`}
                            >
                              <div className="relative h-28 img-zoom">
                                <BrandVisual variant={div.visual} label={`${div.name} operations`} className="absolute inset-0 img-inner" />
                                <div className="absolute inset-0 bg-ink-900/50 group-hover:bg-ink-900/30 transition-colors flex items-end p-4">
                                  <span className="font-tight font-bold text-white text-sm">{div.name}</span>
                                </div>
                                {isFlagship && (
                                  <span className="absolute top-2 right-2 bg-gold-500 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full">
                                    Flagship
                                  </span>
                                )}
                              </div>
                              <div className="p-4 bg-white">
                                <p className="text-xs text-slate-500 leading-relaxed">{div.desc}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </AnimatedSection>
                  )}
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
