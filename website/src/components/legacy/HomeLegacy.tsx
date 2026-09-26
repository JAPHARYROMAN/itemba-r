'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import AnimatedSection from '@/components/AnimatedSection';
import CountUp from '@/components/CountUp';
import SectorIcon from '@/components/SectorIcon';
import CompanyChapter, { type ChapterAccent } from '@/components/cine/CompanyChapter';
import CinematicImage from '@/components/cine/CinematicImage';
import CorridorMap from '@/components/cine/CorridorMap';
import type {
  HomeCompanyTile,
  HomeStat,
  homeClosing,
  homeCorridor,
  homeCorridorMap,
  homeHero,
  homeInsights,
  homeSectors,
  homeStatement,
} from '@/content/home';
import type { CompanySlug } from '@/content/types';
import { companyUrl, insightUrl, serviceUrl } from '@/content/site';

/* ── Motion ─────────────────────────────────────────────────────────── */
const ease = [0.22, 1, 0.36, 1] as const;
const stagger = { visible: { transition: { staggerChildren: 0.1 } } };
const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.85, ease } },
};

/* ── Presentation (legacy) ─────────────────────────────────────────── */
const amber: ChapterAccent = {
  text: 'text-amber-300',
  chip: 'bg-amber-500',
  wash: 'rgba(245,158,11,0.34)',
  border: 'border-amber-400/30',
};
const blue: ChapterAccent = {
  text: 'text-blue-300',
  chip: 'bg-blue-500',
  wash: 'rgba(59,130,246,0.34)',
  border: 'border-blue-400/30',
};
const emerald: ChapterAccent = {
  text: 'text-emerald-300',
  chip: 'bg-emerald-500',
  wash: 'rgba(16,185,129,0.34)',
  border: 'border-emerald-400/30',
};
const chapterAccent: Record<CompanySlug, ChapterAccent> = {
  'mwanjalisi-oil': amber,
  'westsides-company': blue,
  'itemba-enterprises': emerald,
};

export type HomeLegacyProps = {
  hero: typeof homeHero;
  heroStats: HomeStat[];
  statement: typeof homeStatement;
  companyTiles: HomeCompanyTile[];
  sectors: typeof homeSectors;
  corridor: typeof homeCorridor;
  corridorMap: typeof homeCorridorMap;
  insightsCopy: typeof homeInsights;
  insights: Array<{ slug: string; eyebrow: string; title: string; summary: string }>;
  closing: typeof homeClosing;
};

/* ── Page ───────────────────────────────────────────────────────────── */
/**
 * The origin/main home page, unchanged in output, fed from src/content/home
 * by the server page (src/app/page.tsx). Replaced by the rebuilt server home
 * in WP2.1.
 */
export default function HomeLegacy({
  hero,
  heroStats,
  statement,
  companyTiles,
  sectors,
  corridor,
  corridorMap,
  insightsCopy,
  insights,
  closing,
}: HomeLegacyProps) {
  const chapters = companyTiles.map((tile, i) => ({
    eyebrow: tile.eyebrow,
    name: tile.name,
    summary: tile.summary,
    brands: tile.brands,
    stat: tile.stat,
    image: { src: tile.image.src, alt: tile.image.alt },
    href: companyUrl(tile.companySlug),
    ctaLabel: tile.ctaLabel,
    accent: chapterAccent[tile.companySlug],
    align: i % 2 === 1 ? ('right' as const) : ('left' as const),
  }));
  const capabilities = sectors.items.map((item) => ({
    icon: item.icon,
    name: item.name,
    href: serviceUrl(item.serviceSlug),
    image: item.image.src,
  }));

  return (
    <div className="bg-ink-950">
      {/* ══ HERO — full-bleed corridor ════════════════════════════════ */}
      <section className="relative flex min-h-screen items-center overflow-hidden bg-ink-950">
        <CinematicImage
          src={hero.image.src}
          alt=""
          priority
          className="animate-kenburns"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/75 to-ink-950/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/10 to-ink-950/80" />
        <div className="grain-overlay" />

        <motion.div
          variants={stagger}
          initial="hidden"
          animate="visible"
          className="relative z-10 mx-auto w-full max-w-7xl px-5 py-24 sm:px-8"
        >
          <motion.div variants={fadeUp} className="mb-6 flex items-center gap-3">
            <span className="h-px w-10 bg-gold-400" />
            <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">
              {hero.eyebrow}
            </span>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            className="cine-shadow max-w-4xl font-tight text-3xl font-black leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl"
          >
            {hero.headline.lead}{' '}
            <span className="gradient-text">{hero.headline.accent}</span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-200/90 sm:text-xl"
          >
            {hero.lede}
          </motion.p>

          <motion.div variants={fadeUp} className="mt-8 flex flex-wrap gap-3">
            <Link
              href={hero.actions[0].href}
              className="btn-primary bg-gold-500 px-8 py-4 text-sm font-semibold text-white hover:bg-gold-400 hover:shadow-lg hover:shadow-gold-500/30"
            >
              {hero.actions[0].label}
            </Link>
            <Link
              href={hero.actions[1].href}
              className="btn-primary border border-white/25 bg-white/5 px-8 py-4 text-sm font-semibold text-white backdrop-blur hover:border-white/60 hover:bg-white/10"
            >
              {hero.actions[1].label}
            </Link>
          </motion.div>

          <motion.div
            variants={fadeUp}
            className="mt-12 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 lg:grid-cols-4"
          >
            {heroStats.map((s) => (
              <div key={s.label} className="bg-ink-950/70 p-5 backdrop-blur">
                <div className="font-tight text-3xl font-black text-gold-300 sm:text-4xl">
                  {/^\d+$/.test(s.value) ? <CountUp value={Number(s.value)} /> : s.value}
                </div>
                <div className="mt-1.5 text-[11px] uppercase tracking-widest text-slate-400">
                  {s.label}
                </div>
              </div>
            ))}
          </motion.div>
        </motion.div>

        <div className="cine-scroll-cue absolute bottom-7 left-1/2 z-10 -translate-x-1/2 text-white/70">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </section>

      {/* ══ STATEMENT — the breath ════════════════════════════════════ */}
      <section className="bg-ink-950 px-5 py-32 sm:px-8">
        <AnimatedSection className="mx-auto max-w-5xl text-center">
          <div className="gold-line mx-auto mb-10" />
          <h2 className="text-balance font-tight text-4xl font-black leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
            {statement.headline.lead}
            <span className="text-slate-400"> {statement.headline.accent}</span>
          </h2>
          <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-slate-400">
            {statement.body}
          </p>
        </AnimatedSection>
      </section>

      {/* ══ THREE COMPANY CHAPTERS ════════════════════════════════════ */}
      {chapters.map((c, i) => (
        <CompanyChapter key={c.name} index={i + 1} {...c} />
      ))}

      {/* ══ CAPABILITIES MONTAGE ══════════════════════════════════════ */}
      <section className="bg-ink-950 px-5 py-28 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <AnimatedSection className="mb-14 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="gold-line mb-6" />
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">
                {sectors.eyebrow}
              </p>
              <h2 className="font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
                {sectors.title}
              </h2>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-slate-400">
              {sectors.body}
            </p>
          </AnimatedSection>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.map((cap, i) => (
              <AnimatedSection key={cap.name} delay={i * 0.05}>
                <Link
                  href={cap.href}
                  className="group relative flex h-72 flex-col justify-end overflow-hidden rounded-2xl ring-1 ring-white/10 transition hover:ring-gold-400/50"
                >
                  <CinematicImage
                    src={cap.image}
                    alt=""
                    sizes="(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw"
                    className="transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/55 to-ink-950/10" />
                  <div className="relative p-6">
                    <SectorIcon
                      name={cap.icon}
                      className="mb-3 h-7 w-7 text-gold-300 transition-colors group-hover:text-gold-200"
                    />
                    <h3 className="font-tight text-xl font-bold text-white">{cap.name}</h3>
                    <span className="mt-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-300 transition-colors group-hover:text-gold-300">
                      {sectors.action}
                      <svg className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                    </span>
                  </div>
                </Link>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ══ THE CORRIDOR / LOCATION ═══════════════════════════════════ */}
      <section className="relative flex min-h-[80vh] items-center overflow-hidden bg-ink-950 py-24">
        <CinematicImage
          src={corridor.image.src}
          alt={corridor.image.alt}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/80 to-ink-950/40" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-ink-950/60" />
        <div className="grain-overlay" />

        <div className="relative z-10 mx-auto w-full max-w-7xl px-5 sm:px-8">
          <AnimatedSection className="max-w-2xl">
            <div className="mb-5 flex items-center gap-3">
              <span className="h-px w-10 bg-gold-400" />
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">
                {corridor.eyebrow}
              </span>
            </div>
            <h2 className="cine-shadow font-tight text-4xl font-black leading-[0.98] tracking-tight text-white sm:text-5xl lg:text-6xl">
              {corridor.title}
            </h2>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-200/90">
              {corridor.body}
            </p>

            <div className="mt-9 space-y-3">
              {corridor.facts.map((f) => (
                <div
                  key={f.label}
                  className="flex gap-4 border-b border-white/10 pb-3 text-sm last:border-0"
                >
                  <span className="w-28 flex-shrink-0 font-semibold text-gold-300">{f.label}</span>
                  <span className="text-slate-300">{f.value}</span>
                </div>
              ))}
            </div>

            <Link
              href={corridor.link.href}
              className="group mt-9 inline-flex items-center gap-2 text-sm font-semibold text-gold-300 transition hover:text-gold-200"
            >
              {corridor.link.label}
              <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </AnimatedSection>
        </div>
      </section>

      {/* ══ INTERACTIVE CORRIDOR MAP ══════════════════════════════════ */}
      <section className="relative overflow-hidden bg-ink-950 px-5 py-28 sm:px-8">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.25 }} />
        </div>
        <div className="relative z-10 mx-auto max-w-7xl">
          <AnimatedSection className="mb-12 max-w-2xl">
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">
              {corridorMap.eyebrow}
            </p>
            <h2 className="font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
              {corridorMap.title}
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-slate-300">
              {corridorMap.body}
            </p>
          </AnimatedSection>
          <AnimatedSection>
            <CorridorMap />
          </AnimatedSection>
        </div>
      </section>

      {/* ══ INSIGHTS ══════════════════════════════════════════════════ */}
      <section className="bg-ink-950 px-5 py-28 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <AnimatedSection className="mb-12">
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">
              {insightsCopy.eyebrow}
            </p>
            <h2 className="font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
              {insightsCopy.title}
            </h2>
          </AnimatedSection>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {insights.slice(0, insightsCopy.count).map((article, i) => (
              <AnimatedSection key={article.slug} delay={i * 0.06}>
                <Link
                  href={insightUrl(article.slug)}
                  className="group flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-7 transition hover:-translate-y-1 hover:border-gold-400/50 hover:bg-white/[0.06]"
                >
                  <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">
                    {article.eyebrow}
                  </p>
                  <h3 className="mb-4 font-tight text-2xl font-black leading-tight text-white">
                    {article.title}
                  </h3>
                  <p className="mb-6 flex-1 text-sm leading-relaxed text-slate-400">
                    {article.summary}
                  </p>
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-gold-300 transition group-hover:text-gold-200">
                    {insightsCopy.action}
                    <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </span>
                </Link>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ══ FINAL CTA ═════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden bg-ink-950 px-5 py-32 sm:px-8">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.5 }} />
        </div>
        <AnimatedSection className="relative z-10 mx-auto max-w-3xl text-center">
          <div className="gold-line mx-auto mb-8" />
          <h2 className="font-tight text-4xl font-black leading-[1.02] tracking-tight text-white sm:text-6xl">
            {closing.title}
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-slate-400">
            {closing.body}
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link
              href={closing.actions[0].href}
              className="btn-primary bg-gold-500 px-9 py-4 text-sm font-semibold text-white hover:bg-gold-400 hover:shadow-xl hover:shadow-gold-500/25"
            >
              {closing.actions[0].label}
            </Link>
            <Link
              href={closing.actions[1].href}
              className="btn-primary border border-white/25 bg-white/5 px-9 py-4 text-sm font-semibold text-white backdrop-blur hover:border-white/60 hover:bg-white/10"
            >
              {closing.actions[1].label}
            </Link>
          </div>
          <Link
            href={closing.link.href}
            className="mt-7 inline-flex text-sm font-semibold text-gold-300 transition hover:text-gold-200"
          >
            {closing.link.label}
          </Link>
        </AnimatedSection>
      </section>
    </div>
  );
}
