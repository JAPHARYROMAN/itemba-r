import Link from 'next/link';
import type { Metadata } from 'next';
import AnimatedSection from '@/components/AnimatedSection';
import { absoluteUrl, companyUrl, mailtoWithSubject } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Our Companies',
  description:
    'Explore Itemba Group subsidiaries: Mwanjalisi Oil Co Ltd, Westsides Company Ltd, and Itemba Enterprises Co Ltd.',
  alternates: { canonical: absoluteUrl('/companies') },
  openGraph: {
    title: 'Itemba Group Companies',
    description:
      'Three independent companies operating across energy, trade, logistics, hospitality, real estate, and construction.',
    url: absoluteUrl('/companies'),
  },
};

const CHAPTER_WASH: Record<string, string> = {
  mwanjalisi: 'rgba(245,158,11,0.34)',
  westsides: 'rgba(59,130,246,0.34)',
  enterprises: 'rgba(16,185,129,0.34)',
};

const companies = [
  {
    id: 'mwanjalisi',
    name: 'Mwanjalisi Oil Co Ltd',
    sector: 'Energy, Fuel & Parking',
    accentChip: 'bg-amber-500',
    profileHref: companyUrl('mwanjalisi-oil'),
    summary:
      "Tanzania's petroleum retail and corridor parking arm — managing ITEMBA-branded filling stations and UZUNGUNI PARKING YARD for businesses, transport operators, and communities across Songwe Region.",
    products: ['ITEMBA-MPEMBA', 'ITEMBA-UZUNGUNI', 'UZUNGUNI PARKING YARD', 'Diesel', 'Petrol', 'Lubricants'],
    heroImage: {
      src: '/images/fuel-stations/itemba-filling-station-wide.webp',
      alt: 'ITEMBA-MPEMBA forecourt and canopy managed by Mwanjalisi Oil Company Ltd',
    },
  },
  {
    id: 'westsides',
    name: 'Westsides Company Ltd',
    sector: 'Trade & Distribution',
    accentChip: 'bg-blue-500',
    profileHref: companyUrl('westsides-company'),
    summary:
      'Wholesale beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN — serving 50+ stockists, bars, night clubs, cross-border bulk buyers, and construction customers across Songwe Region.',
    products: ['Wholesale beverages', '50+ stockists', 'ITEMBA-HARDWARE', 'UZUNGUNI INN', 'Cross-border bulk sales'],
    heroImage: {
      src: '/images/beverages/westsides-warehouse-stock-wide.webp',
      alt: 'Westsides Company Ltd beverage warehouse stock for wholesale distribution',
    },
  },
  {
    id: 'enterprises',
    name: 'Itemba Enterprises Co Ltd',
    sector: 'Logistics & Transit',
    accentChip: 'bg-emerald-500',
    profileHref: companyUrl('itemba-enterprises'),
    summary:
      "The group's logistics and emerging-business company — anchored by Dar es Salaam-to-Southern Highlands goods movement and cross-border transit through the Tunduma corridor.",
    products: ['Dar → Southern Highlands', 'Cross-border transit', 'Emerging businesses'],
    heroImage: {
      src: '/images/logistics/itemba-logistics-tanker-under-canopy.webp',
      alt: 'Itemba Logistics tanker truck supporting local and transit movement',
    },
  },
];

export default function CompaniesPage() {
  return (
    <div className="bg-ink-950">
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-ink-950 px-5 pb-24 pt-44 sm:px-8">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.5 }} />
          <div className="hero-orb hero-orb-blue" style={{ opacity: 0.35 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 mx-auto max-w-7xl">
          <AnimatedSection>
            <div className="mb-5 flex items-center gap-3">
              <span className="h-px w-10 bg-gold-400" />
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">
                Our subsidiaries
              </span>
            </div>
            <h1 className="font-tight text-5xl font-black leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
              Three companies. <span className="gradient-text">Six sectors.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-300">
              Each subsidiary is legally and operationally independent — with its own identity,
              focus and market — unified under the Itemba Group structure on the Tanzania-Zambia
              corridor.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Company bands ─────────────────────────────────────────── */}
      {companies.map((co) => {
        const wash = CHAPTER_WASH[co.id] ?? 'rgba(200,134,10,0.30)';
        return (
          <section
            key={co.id}
            id={co.id}
            className="relative flex min-h-[82vh] scroll-mt-20 items-center overflow-hidden bg-ink-950"
          >
            <img
              src={co.heroImage.src}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(90deg, ${wash} 0%, rgba(5,8,15,0.6) 45%, rgba(5,8,15,0.97) 100%)`,
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-ink-950/70" />
            <div className="grain-overlay" />

            <div className="relative z-10 mx-auto w-full max-w-7xl px-5 py-20 sm:px-8">
              <AnimatedSection className="max-w-2xl">
                <span
                  className={`${co.accentChip} mb-5 inline-block rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-white`}
                >
                  {co.sector}
                </span>
                <h2 className="cine-shadow font-tight text-4xl font-black leading-[0.98] tracking-tight text-white sm:text-5xl lg:text-6xl">
                  {co.name}
                </h2>
                <p className="mt-6 text-lg leading-relaxed text-slate-200/90">{co.summary}</p>

                <div className="mt-7 flex flex-wrap gap-2">
                  {co.products.map((p) => (
                    <span
                      key={p}
                      className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-medium text-white/85 backdrop-blur"
                    >
                      {p}
                    </span>
                  ))}
                </div>

                <div className="mt-9 flex flex-wrap gap-3">
                  <Link
                    href={co.profileHref}
                    className="btn-primary bg-gold-500 px-7 py-3.5 text-sm font-semibold text-white hover:bg-gold-400 hover:shadow-lg hover:shadow-gold-500/25"
                  >
                    Open company profile
                  </Link>
                  <a
                    href={mailtoWithSubject(`${co.name} business enquiry`)}
                    className="btn-primary border border-white/25 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur hover:border-white/60 hover:bg-white/10"
                  >
                    Send enquiry
                  </a>
                </div>
              </AnimatedSection>
            </div>
          </section>
        );
      })}
    </div>
  );
}
