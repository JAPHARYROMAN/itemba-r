'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import AnimatedSection from '@/components/AnimatedSection';
import BrandVisual from '@/components/BrandVisual';
import CountUp from '@/components/CountUp';
import SectorIcon from '@/components/SectorIcon';
import SpotlightCard from '@/components/SpotlightCard';
import { companyUrl, insightArticles, insightUrl } from '@/lib/site';

/* ── Framer Motion variants ─────────────────────────────────────────── */
const stagger = { visible: { transition: { staggerChildren: 0.12 } } };
const fadeUp = {
  hidden:  { opacity: 0, y: 32 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] } },
};

/* ── Data ──────────────────────────────────────────────────────────── */
const companies = [
  {
    id: 'mwanjalisi',
    name: 'Mwanjalisi Oil Co Ltd',
    tagline: 'Energy & Fuel Distribution',
    desc: 'Petroleum retail operations covering diesel, petrol, kerosene, and lubricants — powering businesses and communities across the Songwe region.',
    visual: 'fuel' as const,
    accentBg: 'from-amber-900/85 via-amber-900/40 to-ink-900/95',
    accentTag: 'bg-amber-500',
    accentSpotlight: 'rgba(245, 158, 11, 0.18)',
    sectors: ['Petroleum Retail', 'Fuel Distribution', 'Lubricants'],
    href: companyUrl('mwanjalisi-oil'),
  },
  {
    id: 'westsides',
    name: 'Westsides Company Ltd',
    tagline: 'Trade & Distribution',
    desc: 'Wholesale and retail of beverages and construction goods — serving a wide consumer and business market across the region.',
    visual: 'trade' as const,
    accentBg: 'from-blue-900/85 via-blue-900/40 to-ink-900/95',
    accentTag: 'bg-blue-500',
    accentSpotlight: 'rgba(59, 130, 246, 0.18)',
    sectors: ['Beverages', 'Hardware & Tools', 'Building Materials'],
    href: companyUrl('westsides-company'),
  },
  {
    id: 'enterprises',
    name: 'Itemba Enterprises Co Ltd',
    tagline: 'Multi-Sector Operations',
    desc: 'Logistics, manufacturing, hardware, real estate, and hospitality under one roof — the most diversified entity within the Itemba Group ecosystem.',
    visual: 'logistics' as const,
    accentBg: 'from-emerald-900/85 via-emerald-900/40 to-ink-900/95',
    accentTag: 'bg-emerald-500',
    accentSpotlight: 'rgba(16, 185, 129, 0.18)',
    sectors: ['Logistics & Transit', 'Manufacturing', 'Real Estate', 'Hospitality', 'Hardware'],
    href: companyUrl('itemba-enterprises'),
  },
];

const sectors = [
  { icon: 'logistics' as const,     name: 'Logistics & Transit',  desc: 'Local distribution and cross-border transit logistics through the Tunduma corridor.' },
  { icon: 'energy' as const,        name: 'Energy & Fuel',         desc: 'Petroleum products and fuel supply chains.' },
  { icon: 'trade' as const,         name: 'Trade & Distribution', desc: 'Beverages, building goods, consumer distribution.' },
  { icon: 'manufacturing' as const, name: 'Manufacturing',         desc: 'Industrial and consumer goods production.' },
  { icon: 'construction' as const,  name: 'Construction',          desc: 'Hardware, materials, and construction supplies.' },
  { icon: 'hospitality' as const,   name: 'Hospitality',           desc: 'Hotel, restaurant, and lodging through Uzunguni Inn.' },
  { icon: 'realestate' as const,    name: 'Real Estate',           desc: 'Property development through Itemba Estate.' },
];

const divisions = [
  { name: 'Itemba Logistics',      desc: 'Local distribution & cross-border transit', visual: 'logistics' as const, flagship: true },
  { name: 'Itemba Hardware',       desc: 'Building materials, tools & electrical',     visual: 'hardware' as const },
  { name: 'Itemba Estate',         desc: 'Property development & real estate',         visual: 'estate' as const },
  { name: 'Uzunguni Inn',          desc: 'Hotel, restaurant & lodging',                visual: 'hospitality' as const },
  { name: 'Uzunguni Parking Yard', desc: 'Parking yard services',                      visual: 'parking' as const },
];

const proofPoints = [
  {
    title: 'Named operating companies',
    desc: 'Visitors can move from group overview to the specific company responsible for each enquiry route.',
  },
  {
    title: 'Service-to-company mapping',
    desc: 'Fuel, trade, logistics, hardware, hospitality, and property pages each point back to an operating team.',
  },
  {
    title: 'Songwe-Tunduma location context',
    desc: 'The site makes the Mpemba-Tunduma base and Tanzania-Zambia corridor relevance clear for local search.',
  },
  {
    title: 'Direct enquiry routing',
    desc: 'Forms, WhatsApp, email, and phone options guide each enquiry to the closest business area.',
  },
];

/* ── Page ──────────────────────────────────────────────────────────── */
export default function HomePage() {
  return (
    <>
      {/* ══ HERO ════════════════════════════════════════════════════ */}
      <section className="relative min-h-screen flex items-center justify-center bg-ink-900 overflow-hidden">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" />
          <div className="hero-orb hero-orb-blue" />
          <div className="hero-orb hero-orb-violet" />
          <div className="grid-overlay" />
        </div>

        <motion.div
          variants={stagger}
          initial="hidden"
          animate="visible"
          className="relative z-10 max-w-7xl mx-auto px-5 sm:px-8 text-center pt-24 pb-16"
        >
          <motion.div variants={fadeUp} className="mb-6 inline-flex">
            <span className="text-xs font-semibold uppercase tracking-widest text-gold-400 border border-gold-500/30 bg-gold-500/10 px-4 py-2 rounded-full">
              Mpemba-Tunduma · Songwe Region · Tanzania
            </span>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            className="font-tight font-black text-white mb-6 leading-[0.95] tracking-tightest"
            style={{ fontSize: 'clamp(2.75rem, 8vw, 7rem)' }}
          >
            Diversified.<br />
            <span className="gradient-text">Resilient.</span><br />
            Tanzanian.
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="text-slate-300 text-base sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed px-2"
          >
            Itemba Group is Tanzania&apos;s multi-industry holding group — three independent
            companies, six business sectors, one unified vision.
          </motion.p>

          <motion.div variants={fadeUp} className="flex flex-wrap gap-3 sm:gap-4 justify-center">
            <Link
              href="/companies"
              className="btn-primary bg-gold-500 hover:bg-gold-400 text-white font-semibold px-7 sm:px-8 py-3.5 rounded-full text-sm hover:shadow-lg hover:shadow-gold-500/30"
            >
              Explore Our Companies
            </Link>
            <Link
              href="/about"
              className="btn-primary border border-slate-600 hover:border-slate-300 text-slate-300 hover:text-white font-semibold px-7 sm:px-8 py-3.5 rounded-full text-sm"
            >
              Our Story
            </Link>
          </motion.div>

          <motion.div
            variants={fadeUp}
            className="mt-16 sm:mt-20 flex flex-col items-center gap-2 text-slate-500"
          >
            <span className="text-[10px] sm:text-xs uppercase tracking-widest">Scroll</span>
            <motion.div
              animate={{ y: [0, 8, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              className="w-0.5 h-8 bg-gradient-to-b from-slate-500 to-transparent rounded-full"
            />
          </motion.div>
        </motion.div>
      </section>

      {/* ══ STATS RIBBON — animated counters ═══════════════════════ */}
      <section className="bg-ink-800 border-y border-ink-600 py-10 px-5 sm:px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {[
            { value: 3,   suffix: '',  sub: 'Subsidiary Companies' },
            { value: 6,   suffix: '+', sub: 'Business Sectors' },
            { value: 5,   suffix: '',  sub: 'Specialised Divisions' },
            { value: 'Songwe', sub: 'Region, Tanzania', isText: true },
          ].map((s, i) => (
            <AnimatedSection key={s.sub} direction="fade" delay={i * 0.08}>
              <div className="stat-number text-4xl font-tight font-black text-gold-400">
                {s.isText ? (
                  s.value as string
                ) : (
                  <CountUp value={s.value as number} suffix={s.suffix} />
                )}
              </div>
              <div className="text-xs text-slate-400 mt-2 tracking-wide">{s.sub}</div>
            </AnimatedSection>
          ))}
        </div>
      </section>

      {/* ══ OPERATING PROOF ══════════════════════════════════════ */}
      <section className="bg-slate-50 px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
          <AnimatedSection>
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold-600">
              Operating Proof
            </p>
            <h2 className="mb-5 font-tight text-4xl font-black leading-none tracking-tighter text-ink-900 sm:text-5xl">
              Clear Signals for Customers and Partners
            </h2>
            <p className="text-sm leading-relaxed text-slate-600">
              The site now gives visitors a practical way to verify what Itemba Group operates,
              where the group is based, and which team should receive each business enquiry.
            </p>
            <Link
              href="/capabilities"
              className="btn-primary mt-7 inline-flex rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-ink-700"
            >
              View capability proof
            </Link>
          </AnimatedSection>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {proofPoints.map((point, index) => (
              <AnimatedSection key={point.title} delay={index * 0.06}>
                <div className="h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <span className="mb-5 flex h-9 w-9 items-center justify-center rounded-full bg-gold-500 text-sm font-black text-white">
                    {index + 1}
                  </span>
                  <h3 className="mb-3 font-tight text-xl font-black leading-tight text-ink-900">
                    {point.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-600">{point.desc}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ══ GROUP STORY ═══════════════════════════════════════════ */}
      <section className="py-28 px-5 sm:px-8 bg-white">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <AnimatedSection delay={0}>
              <div className="gold-line mb-6" />
              <p className="text-gold-600 text-xs font-semibold uppercase tracking-widest mb-3">
                Who We Are
              </p>
            </AnimatedSection>
            <AnimatedSection delay={0.08}>
              <h2 className="font-tight font-black text-ink-900 text-4xl sm:text-5xl leading-none tracking-tighter mb-6">
                A Conglomerate Built for Tanzania
              </h2>
            </AnimatedSection>
            <AnimatedSection delay={0.16}>
              <p className="text-slate-600 text-lg leading-relaxed mb-5">
                Itemba Group is a holding group made up of three independently operated
                subsidiary companies, unified under one parent corporate structure
                headquartered in Mpemba-Tunduma, Songwe Region.
              </p>
              <p className="text-slate-500 leading-relaxed mb-8">
                Our conglomerate model allows each company to operate with full legal and
                operational independence — while benefiting from central strategic oversight,
                shared governance, and the strength of the Itemba brand.
              </p>
              <Link
                href="/about"
                className="inline-flex items-center gap-2 text-sm font-semibold text-gold-600 hover:text-gold-500 transition-colors group"
              >
                Learn more about the group
                <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
            </AnimatedSection>
          </div>
          <AnimatedSection direction="left">
            <div className="relative h-96 rounded-3xl overflow-hidden shadow-2xl img-zoom">
              <BrandVisual variant="group" label="Itemba Group operations" className="absolute inset-0 img-inner" />
              <div className="absolute inset-0 bg-gradient-to-tl from-ink-900/40 to-transparent" />
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ══ COMPANY SHOWCASE — spotlight cards ═══════════════════ */}
      <section className="py-28 px-5 sm:px-8 bg-ink-950 relative overflow-hidden">
        <div className="absolute inset-0 grid-overlay opacity-40" />
        <div className="relative max-w-7xl mx-auto">
          <AnimatedSection className="text-center mb-16">
            <div className="gold-line mx-auto mb-6" />
            <p className="text-gold-400 text-xs font-semibold uppercase tracking-widest mb-3">
              Our Subsidiaries
            </p>
            <h2 className="font-tight font-black text-white text-4xl sm:text-5xl leading-none tracking-tighter">
              Three Companies.<br />One Group.
            </h2>
          </AnimatedSection>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {companies.map((co, i) => (
              <AnimatedSection key={co.id} delay={i * 0.1} direction="up">
                <Link href={co.href} className="block group">
                  <SpotlightCard
                    spotlightColor={co.accentSpotlight}
                    className="company-card relative h-[520px] rounded-3xl overflow-hidden cursor-pointer"
                  >
                    <div className="absolute inset-0">
                      <BrandVisual
                        variant={co.visual}
                        label={`${co.name} visual`}
                        className="h-full w-full transition-transform duration-700 group-hover:scale-105"
                      />
                    </div>
                    <div className={`absolute inset-0 bg-gradient-to-t ${co.accentBg}`} />

                    <div className="absolute inset-0 flex flex-col justify-end p-8">
                      <span className={`${co.accentTag} text-white text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full inline-block w-fit mb-3`}>
                        {co.tagline}
                      </span>
                      <h3 className="font-tight font-black text-white text-xl leading-tight mb-3">
                        {co.name}
                      </h3>
                      <p className="text-slate-300 text-sm leading-relaxed mb-4 max-h-0 group-hover:max-h-32 opacity-0 group-hover:opacity-100 transition-all duration-500 overflow-hidden">
                        {co.desc}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {co.sectors.map((s) => (
                          <span key={s} className="text-xs text-white/70 border border-white/20 px-2 py-0.5 rounded-full backdrop-blur-sm">
                            {s}
                          </span>
                        ))}
                      </div>
                      <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-white group-hover:text-gold-400 transition-colors">
                        View profile
                        <svg className="w-4 h-4 transition-transform group-hover:translate-x-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                      </div>
                    </div>
                  </SpotlightCard>
                </Link>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ══ SECTORS GRID ═════════════════════════════════════════ */}
      <section className="py-28 px-5 sm:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <AnimatedSection className="mb-16">
            <div className="gold-line mb-6" />
            <p className="text-gold-600 text-xs font-semibold uppercase tracking-widest mb-3">
              What We Do
            </p>
            <h2 className="font-tight font-black text-ink-900 text-4xl sm:text-5xl leading-none tracking-tighter max-w-xl">
              Six Business Sectors
            </h2>
          </AnimatedSection>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sectors.map((s, i) => (
              <AnimatedSection key={s.name} delay={i * 0.06}>
                <div className="sector-card bg-slate-50 hover:bg-ink-900 border border-slate-200 hover:border-ink-700 rounded-2xl p-7 group transition-colors duration-400">
                  <SectorIcon
                    name={s.icon}
                    className="w-7 h-7 text-ink-700 group-hover:text-gold-400 mb-5 transition-colors duration-400"
                  />
                  <h3 className="font-tight font-bold text-ink-900 group-hover:text-white text-lg mb-2 transition-colors">
                    {s.name}
                  </h3>
                  <p className="text-sm text-slate-500 group-hover:text-slate-400 leading-relaxed transition-colors">
                    {s.desc}
                  </p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ══ DIVISIONS ════════════════════════════════════════════ */}
      <section className="py-28 px-5 sm:px-8 bg-slate-50">
        <div className="max-w-7xl mx-auto">
          <AnimatedSection className="mb-4">
            <div className="gold-line mb-6" />
            <p className="text-gold-600 text-xs font-semibold uppercase tracking-widest mb-3">
              Itemba Enterprises Co Ltd
            </p>
          </AnimatedSection>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
            <AnimatedSection>
              <h2 className="font-tight font-black text-ink-900 text-4xl sm:text-5xl leading-none tracking-tighter">
                Five Specialised<br />Divisions
              </h2>
            </AnimatedSection>
            <AnimatedSection direction="left">
              <Link href="/companies#enterprises" className="text-sm font-semibold text-gold-600 hover:text-gold-500 transition-colors inline-flex items-center gap-2 group">
                View Itemba Enterprises
                <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
            </AnimatedSection>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {divisions.map((d, i) => (
              <AnimatedSection key={d.name} delay={i * 0.08}>
                <div className={`group rounded-2xl overflow-hidden border bg-white hover:shadow-xl transition-shadow duration-500 ${d.flagship ? 'border-gold-400 shadow-lg shadow-gold-500/10' : 'border-slate-200'}`}>
                  <div className="relative h-48 overflow-hidden img-zoom">
                    <BrandVisual variant={d.visual} label={d.name} className="absolute inset-0 img-inner" />
                    <div className="absolute inset-0 bg-ink-900/40 group-hover:bg-ink-900/20 transition-colors duration-500" />
                    {d.flagship && (
                      <span className="absolute top-3 left-3 bg-gold-500 text-white text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full">
                        Flagship
                      </span>
                    )}
                  </div>
                  <div className="p-5">
                    <h3 className="font-tight font-bold text-ink-900 text-base mb-1">{d.name}</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">{d.desc}</p>
                  </div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ══ LOCATION FEATURE ═════════════════════════════════════ */}
      <section className="relative py-28 px-5 sm:px-8 bg-ink-900 overflow-hidden">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.6 }} />
        </div>
        <div className="relative z-10 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <AnimatedSection direction="right">
            <div className="relative h-96 rounded-3xl overflow-hidden shadow-2xl img-zoom">
              <BrandVisual variant="corridor" label="Tunduma and Songwe Region trade corridor" className="absolute inset-0 img-inner" />
              <div className="absolute inset-0 bg-gradient-to-br from-ink-900/30 to-transparent" />
            </div>
          </AnimatedSection>
          <div>
            <AnimatedSection delay={0}>
              <div className="gold-line mb-6" />
              <p className="text-gold-400 text-xs font-semibold uppercase tracking-widest mb-3">
                Our Location
              </p>
            </AnimatedSection>
            <AnimatedSection delay={0.08}>
              <h2 className="font-tight font-black text-white text-4xl sm:text-5xl leading-none tracking-tighter mb-6">
                Strategically Located in Songwe Region
              </h2>
            </AnimatedSection>
            <AnimatedSection delay={0.16}>
              <p className="text-slate-300 leading-relaxed mb-4">
                Our headquarters in Mpemba-Tunduma sits at the Tanzania-Zambia border —
                one of East and Southern Africa&apos;s most active trade corridors.
                This position gives every company in the group direct access to
                cross-border trade flows and regional supply chains.
              </p>
            </AnimatedSection>
            <AnimatedSection delay={0.24}>
              <div className="space-y-3 mt-8">
                {[
                  { label: 'Headquarters',  value: 'Mpemba-Tunduma, Songwe Region' },
                  { label: 'Border Access', value: 'Tanzania-Zambia TAZARA Corridor' },
                  { label: 'Active Sectors', value: 'Energy · Trade · Construction · Hospitality · Real Estate · Manufacturing' },
                ].map((item) => (
                  <div key={item.label} className="flex gap-4 text-sm border-b border-ink-600 pb-3 last:border-0">
                    <span className="text-gold-400 font-semibold w-32 flex-shrink-0">{item.label}</span>
                    <span className="text-slate-400">{item.value}</span>
                  </div>
                ))}
              </div>
              <Link
                href="/locations/songwe-tunduma"
                className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-gold-400 transition-colors hover:text-gold-300 group"
              >
                View Songwe-Tunduma location profile
                <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* ══ INSIGHTS HUB ═════════════════════════════════════════ */}
      <section className="bg-slate-50 px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <AnimatedSection className="mb-12">
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold-600">
              Business Guides
            </p>
            <h2 className="font-tight text-4xl font-black leading-tight tracking-tighter text-ink-900 sm:text-5xl">
              Practical Insights for Search and Enquiries
            </h2>
          </AnimatedSection>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {insightArticles.slice(0, 3).map((article, index) => (
              <AnimatedSection key={article.slug} delay={index * 0.06}>
                <Link
                  href={insightUrl(article.slug)}
                  className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-gold-400 hover:shadow-lg"
                >
                  <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-600">
                    {article.eyebrow}
                  </p>
                  <h3 className="mb-4 font-tight text-2xl font-black leading-tight text-ink-900">
                    {article.title}
                  </h3>
                  <p className="mb-6 flex-1 text-sm leading-relaxed text-slate-600">{article.summary}</p>
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-gold-600 transition group-hover:text-gold-500">
                    Read insight
                    <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </span>
                </Link>
              </AnimatedSection>
            ))}
          </div>

          <AnimatedSection className="mt-10 text-center">
            <Link
              href="/insights"
              className="inline-flex text-sm font-semibold text-gold-600 transition hover:text-gold-500"
            >
              View all insights
            </Link>
          </AnimatedSection>
        </div>
      </section>

      {/* ══ FINAL CTA ════════════════════════════════════════════ */}
      <section className="py-24 px-5 sm:px-8 bg-white border-t border-slate-100">
        <AnimatedSection className="max-w-3xl mx-auto text-center">
          <div className="gold-line mx-auto mb-8" />
          <h2 className="font-tight font-black text-ink-900 text-4xl sm:text-5xl leading-none tracking-tighter mb-6">
            Let&apos;s Build Something Together
          </h2>
          <p className="text-slate-500 text-lg leading-relaxed mb-10">
            Interested in doing business with Itemba Group or one of our subsidiaries?
            Reach out — we&apos;d love to hear from you.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/contact"
              className="btn-primary inline-block bg-ink-900 hover:bg-ink-700 text-white font-semibold px-10 py-4 rounded-full text-sm hover:shadow-xl hover:shadow-ink-900/20"
            >
              Contact Us
            </Link>
            <Link
              href="/services"
              className="btn-primary inline-block border border-slate-300 hover:border-gold-400 text-ink-900 hover:text-gold-600 font-semibold px-10 py-4 rounded-full text-sm"
            >
              Services
            </Link>
            <Link
              href="/partnerships"
              className="btn-primary inline-block border border-slate-300 hover:border-gold-400 text-ink-900 hover:text-gold-600 font-semibold px-10 py-4 rounded-full text-sm"
            >
              Partnerships
            </Link>
            <Link
              href="/company-profile"
              className="btn-primary inline-block border border-slate-300 hover:border-gold-400 text-ink-900 hover:text-gold-600 font-semibold px-10 py-4 rounded-full text-sm"
            >
              Company Profile
            </Link>
          </div>
          <Link href="/faq" className="mt-6 inline-flex text-sm font-semibold text-gold-600 hover:text-gold-500">
            Browse frequently asked questions
          </Link>
        </AnimatedSection>
      </section>
    </>
  );
}
