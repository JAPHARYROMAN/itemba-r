'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import AnimatedSection from '@/components/AnimatedSection';
import BrandVisual from '@/components/BrandVisual';
import SectorIcon from '@/components/SectorIcon';
import SpotlightCard from '@/components/SpotlightCard';
import { companyUrl, insightArticles, insightUrl, locationUrl, serviceUrl } from '@/lib/site';

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
  {
    icon: 'energy' as const,
    name: 'Energy & Fuel',
    desc: 'Petroleum retail, diesel, petrol, kerosene, lubricants, and fleet fuel enquiries.',
    proof: 'Mwanjalisi Oil Co Ltd',
    href: serviceUrl('fuel-and-lubricants'),
  },
  {
    icon: 'trade' as const,
    name: 'Trade & Distribution',
    desc: 'Beverages, building goods, consumer supply, wholesale, and retail distribution.',
    proof: 'Westsides Company Ltd',
    href: serviceUrl('trade-and-distribution'),
  },
  {
    icon: 'logistics' as const,
    name: 'Logistics & Transit',
    desc: 'Local distribution and cross-border transit support through the Tunduma corridor.',
    proof: 'Itemba Enterprises Co Ltd',
    href: serviceUrl('logistics-and-cross-border-transit'),
  },
  {
    icon: 'construction' as const,
    name: 'Construction & Hardware',
    desc: 'Building materials, tools, electrical goods, and contractor supply enquiries.',
    proof: 'Westsides and Itemba Hardware',
    href: serviceUrl('construction-supplies-and-hardware'),
  },
  {
    icon: 'hospitality' as const,
    name: 'Hospitality & Lodging',
    desc: 'Hotel, restaurant, lodging, and business guest support through Uzunguni Inn.',
    proof: 'Uzunguni Inn',
    href: serviceUrl('hospitality-and-lodging'),
  },
  {
    icon: 'realestate' as const,
    name: 'Real Estate & Manufacturing',
    desc: 'Property development, estate services, and manufacturing-related activity.',
    proof: 'Itemba Estate',
    href: serviceUrl('real-estate-and-property'),
  },
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
    desc: 'Each major operating area is anchored by a company or division with clear responsibility.',
  },
  {
    title: 'Corridor-based operations',
    desc: 'The Mpemba-Tunduma base connects the group to local customers and Tanzania-Zambia trade movement.',
  },
  {
    title: 'Multi-sector coverage',
    desc: 'Fuel, trade, logistics, construction supply, hospitality, property, and manufacturing interests sit under one group.',
  },
  {
    title: 'Clear enquiry routes',
    desc: 'Partners, customers, suppliers, and contractors can start from the business need and reach the right team faster.',
  },
];

const heroProof = [
  { value: '3', label: 'Operating companies' },
  { value: '6', label: 'Business sectors' },
  { value: '5', label: 'Specialised divisions' },
  { value: 'Songwe', label: 'Regional base' },
];

/* ── Page ──────────────────────────────────────────────────────────── */
export default function HomePage() {
  return (
    <>
      {/* ══ HERO ════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden bg-ink-950 px-5 pt-24 sm:px-8 lg:pt-20">
        <BrandVisual
          variant="corridor"
          label="Tanzania and Tunduma corridor business operations"
          className="absolute inset-0 h-full w-full opacity-70"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/88 to-ink-950/58" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-ink-950/70" />

        <motion.div
          variants={stagger}
          initial="hidden"
          animate="visible"
          className="relative z-10 mx-auto flex max-w-7xl flex-col justify-center pb-8 pt-6 sm:pt-8 lg:min-h-[610px] lg:pb-10"
        >
          <motion.div variants={fadeUp} className="mb-5 flex flex-wrap gap-2">
            {['Mpemba-Tunduma', 'Songwe Region', 'Tanzania'].map((item) => (
              <span
                key={item}
                className="border border-gold-500/30 bg-ink-900/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-gold-300 backdrop-blur"
              >
                {item}
              </span>
            ))}
          </motion.div>

          <motion.p
            variants={fadeUp}
            className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400"
          >
            Diversified. Resilient. Tanzanian.
          </motion.p>

          <motion.h1
            variants={fadeUp}
            className="mb-6 max-w-4xl font-tight text-6xl font-black leading-[0.95] tracking-normal text-white sm:text-7xl lg:text-8xl xl:text-9xl"
          >
            Itemba Group
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="max-w-3xl text-base leading-relaxed text-slate-200 sm:text-xl"
          >
            A Tanzania-based multi-sector group operating across fuel, trade,
            logistics, construction supply, hospitality, real estate, and
            manufacturing-related activity.
          </motion.p>

          <motion.div variants={fadeUp} className="mt-9 flex flex-wrap gap-3">
            <Link
              href="/companies"
              className="btn-primary bg-gold-500 px-7 py-3.5 text-sm font-semibold text-white hover:bg-gold-400 hover:shadow-lg hover:shadow-gold-500/30"
            >
              Explore Companies
            </Link>
            <Link
              href="/capabilities"
              className="btn-primary border border-white/25 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur hover:border-white/50 hover:bg-white/10"
            >
              View Capabilities
            </Link>
            <Link
              href="/partnerships"
              className="btn-primary border border-gold-500/40 px-7 py-3.5 text-sm font-semibold text-gold-300 hover:border-gold-300 hover:text-gold-200"
            >
              Start a Business Enquiry
            </Link>
          </motion.div>

          <motion.div
            variants={fadeUp}
            className="mt-8 grid grid-cols-2 gap-2 text-sm text-slate-300 lg:max-w-4xl lg:grid-cols-4"
          >
            {heroProof.map((item) => (
              <div key={item.label} className="border border-white/10 bg-white/[0.04] p-3 backdrop-blur sm:p-4">
                <div className="stat-number mb-1 font-tight text-2xl font-black text-gold-300 sm:text-3xl">
                  {item.value}
                </div>
                <div className="text-xs uppercase tracking-widest text-slate-400">{item.label}</div>
              </div>
            ))}
          </motion.div>
        </motion.div>
      </section>

      {/* ══ GROUP AT A GLANCE ═════════════════════════════════════ */}
      <section className="bg-white px-5 py-20 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <AnimatedSection>
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold-600">
              Group at a Glance
            </p>
            <h2 className="mb-5 font-tight text-4xl font-black leading-tight tracking-tighter text-ink-900 sm:text-5xl">
              One group structure, multiple routes to market.
            </h2>
            <p className="text-base leading-relaxed text-slate-600">
              Itemba Group brings together independent operating companies serving customers,
              partners, suppliers, contractors, and regional businesses from a strategic base
              in Mpemba-Tunduma, Songwe Region.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/about"
                className="btn-primary bg-ink-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-ink-700"
              >
                Our Story
              </Link>
              <Link
                href={locationUrl('songwe-tunduma')}
                className="btn-primary border border-slate-300 px-6 py-3 text-sm font-semibold text-ink-900 hover:border-gold-400 hover:text-gold-600"
              >
                Location Advantage
              </Link>
            </div>
          </AnimatedSection>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {proofPoints.map((point, index) => (
              <AnimatedSection key={point.title} delay={index * 0.06}>
                <div className="h-full border border-slate-200 bg-slate-50 p-6">
                  <span className="mb-5 flex h-9 w-9 items-center justify-center bg-gold-500 text-sm font-black text-white">
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

      {/* ══ SECTOR PATHWAYS ═══════════════════════════════════════ */}
      <section className="bg-slate-50 px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <AnimatedSection className="mb-14">
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold-600">
              What We Do
            </p>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.78fr_1.22fr] lg:items-end">
              <h2 className="font-tight text-4xl font-black leading-tight tracking-tighter text-ink-900 sm:text-5xl">
                Start from the sector that matches your need.
              </h2>
              <p className="max-w-2xl text-sm leading-relaxed text-slate-600 lg:justify-self-end">
                Each pathway leads to a focused service page, connected company, likely audience,
                and the right enquiry context before a visitor contacts the group.
              </p>
            </div>
          </AnimatedSection>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sectors.map((s, i) => (
              <AnimatedSection key={s.name} delay={i * 0.06}>
                <Link
                  href={s.href}
                  className="sector-card group flex h-full flex-col border border-slate-200 bg-white p-7 shadow-sm transition hover:border-gold-400 hover:bg-ink-900 hover:shadow-lg"
                >
                  <SectorIcon
                    name={s.icon}
                    className="mb-5 h-7 w-7 text-ink-700 transition-colors duration-400 group-hover:text-gold-400"
                  />
                  <h3 className="mb-2 font-tight text-xl font-bold text-ink-900 transition-colors group-hover:text-white">
                    {s.name}
                  </h3>
                  <p className="mb-5 flex-1 text-sm leading-relaxed text-slate-500 transition-colors group-hover:text-slate-300">
                    {s.desc}
                  </p>
                  <div className="border-t border-slate-200 pt-4 text-xs font-semibold uppercase tracking-widest text-slate-400 transition-colors group-hover:border-white/15 group-hover:text-gold-300">
                    {s.proof}
                  </div>
                </Link>
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
