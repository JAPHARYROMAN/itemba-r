import type { Metadata } from 'next';
import AnimatedSection from '@/components/AnimatedSection';
import CinematicImage from '@/components/cine/CinematicImage';
import RichText from '@/components/legacy/RichText';
import { aboutPage } from '@/content/about';
import { legacyCopy } from '@/content/legacy';
import type { CompanyId } from '@/content/types';
import { absoluteUrl } from '@/lib/site';

const { meta, hero, whoWeAre, organisation, approach, headquarters } = aboutPage;

export const metadata: Metadata = {
  title: meta.title,
  description: meta.description,
  alternates: { canonical: absoluteUrl('/about') },
  openGraph: {
    title: meta.ogTitle,
    description: meta.ogDescription,
    url: absoluteUrl('/about'),
  },
};

// Legacy page: origin/main copy where the default flags would change it (src/content/legacy.ts).
const pillars = approach.pillars.map((pillar) =>
  pillar.title === 'Revenue diversification' ? { ...pillar, summary: legacyCopy.aboutRevenuePillar } : pillar,
);

const tierIcons: Record<string, string> = { Group: '🏛️', Companies: '🏢', Brands: '⚙️' };

const structureAccent: Record<CompanyId, string> = {
  mwanjalisi: 'text-amber-400',
  westsides: 'text-blue-400',
  enterprises: 'text-emerald-400',
};

export default function AboutPage() {
  const structure = organisation.structure;
  const lastCompany = structure.companies.length - 1;

  return (
    <div className="bg-ink-950">
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative flex min-h-[72vh] items-end overflow-hidden bg-ink-950">
        <CinematicImage src={hero.image.src} alt="" priority className="animate-kenburns" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/70 to-ink-950/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-ink-950/70" />
        <div className="grain-overlay" />
        <div className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-16 pt-40 sm:px-8">
          <AnimatedSection>
            <div className="mb-5 flex items-center gap-3">
              <span className="h-px w-10 bg-gold-400" />
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">{hero.eyebrow}</span>
            </div>
            <h1 className="cine-shadow font-tight text-5xl font-black leading-[0.92] tracking-tight text-white sm:text-6xl lg:text-7xl">
              {hero.headline.lead} <span className="gradient-text">{hero.headline.accent}</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-200/90">{hero.lede}</p>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Who we are ────────────────────────────────────────────── */}
      <section className="overflow-hidden bg-ink-950 px-5 py-28 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-16 lg:grid-cols-2">
          <div>
            <AnimatedSection>
              <div className="gold-line mb-6" />
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">{whoWeAre.eyebrow}</p>
              <h2 className="mb-6 font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
                {whoWeAre.title}
              </h2>
            </AnimatedSection>
            <AnimatedSection delay={0.12}>
              <p className="mb-4 text-lg leading-relaxed text-slate-300">{whoWeAre.lead}</p>
              <p className="mb-4 leading-relaxed text-slate-400">
                <RichText text={whoWeAre.model} strongClassName="text-white" />
              </p>
              <p className="leading-relaxed text-slate-400">{legacyCopy.aboutStructureParagraph}</p>
            </AnimatedSection>
          </div>
          <AnimatedSection direction="left">
            <div className="grid h-[440px] grid-cols-2 gap-3">
              {whoWeAre.mosaic.map((image) => (
                <div key={image.src} className="relative overflow-hidden rounded-2xl ring-1 ring-white/10">
                  <img src={image.src} alt={image.alt} loading="lazy" className="h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-ink-950/50 to-transparent" />
                </div>
              ))}
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Structure ─────────────────────────────────────────────── */}
      <section className="bg-ink-950 px-5 py-28 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <AnimatedSection className="mb-16 text-center">
            <div className="gold-line mx-auto mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">{organisation.eyebrow}</p>
            <h2 className="font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
              {organisation.title}
            </h2>
          </AnimatedSection>

          <div className="mb-12 grid grid-cols-1 gap-5 md:grid-cols-3">
            {organisation.tiers.map((item, i) => (
              <AnimatedSection key={item.level} delay={i * 0.1}>
                <div className="h-full rounded-2xl border border-white/10 bg-white/[0.04] p-8">
                  <div className="mb-4 text-4xl">{tierIcons[item.level]}</div>
                  <span className="mb-4 inline-block rounded-full border border-gold-500/30 bg-gold-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-gold-400">
                    {item.level}
                  </span>
                  <h3 className="mb-3 font-tight text-xl font-bold text-white">{item.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-400">{item.summary}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>

          <AnimatedSection>
            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-8 font-mono text-sm leading-loose text-slate-400">
              <p className="mb-2 text-base font-bold text-white">
                {structure.root.name} <span className="text-gold-400">{structure.root.note}</span>
              </p>
              {structure.companies.flatMap((company, index) => {
                const glyph = index === lastCompany ? '└──' : '├──';
                return [
                  <p key={company.companyId} className="ml-4 text-slate-300">
                    {`${glyph} ${company.name} → `}
                    <span className={structureAccent[company.companyId]}>{company.focus}</span>
                  </p>,
                  ...company.units.map((unit) =>
                    'flagship' in unit && unit.flagship ? (
                      <p key={unit.name} className="ml-8 text-gold-400">
                        {`${glyph} ${unit.name} → ${unit.focus} `}
                        <span className="text-gold-500">{`★ ${structure.flagshipLabel}`}</span>
                      </p>
                    ) : (
                      <p key={unit.name} className="ml-8 text-slate-400">
                        {`${glyph} ${unit.name} → ${unit.focus}`}
                      </p>
                    ),
                  ),
                ];
              })}
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Why diversification ───────────────────────────────────── */}
      <section className="overflow-hidden bg-ink-950 px-5 py-28 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-16 lg:grid-cols-2">
          <AnimatedSection direction="right">
            <div className="relative h-[400px] overflow-hidden rounded-3xl ring-1 ring-white/10">
              <img
                src={approach.image.src}
                alt={approach.image.alt}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-ink-950/60 via-transparent to-transparent" />
            </div>
          </AnimatedSection>
          <div>
            <AnimatedSection>
              <div className="gold-line mb-6" />
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">{approach.eyebrow}</p>
              <h2 className="mb-8 font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
                {approach.title}
              </h2>
            </AnimatedSection>
            <div className="space-y-6">
              {pillars.map((p, i) => (
                <AnimatedSection key={p.title} delay={i * 0.08}>
                  <div className="flex gap-4">
                    <div
                      className="mt-1 w-1.5 flex-shrink-0 rounded-full bg-gradient-to-b from-gold-400 to-gold-600"
                      style={{ minHeight: '2.5rem' }}
                    />
                    <div>
                      <h3 className="mb-1 font-tight font-bold text-white">{p.title}</h3>
                      <p className="text-sm leading-relaxed text-slate-400">{p.summary}</p>
                    </div>
                  </div>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── HQ feature ────────────────────────────────────────────── */}
      <section className="relative flex min-h-[70vh] items-center overflow-hidden bg-ink-950 py-24">
        <img
          src={headquarters.image.src}
          alt={headquarters.image.alt}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/75 to-ink-950/35" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-ink-950/60" />
        <div className="grain-overlay" />
        <div className="relative z-10 mx-auto w-full max-w-7xl px-5 sm:px-8">
          <AnimatedSection className="max-w-2xl">
            <div className="mb-5 flex items-center gap-3">
              <span className="h-px w-10 bg-gold-400" />
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">
                {headquarters.eyebrow}
              </span>
            </div>
            <h2 className="cine-shadow font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
              {headquarters.title}
            </h2>
            <p className="mt-6 max-w-xl leading-relaxed text-slate-200/90">
              <RichText text={headquarters.body} strongClassName="text-white" />
            </p>
            {/* Legacy page: origin/main renders the (unsourced) growth claim; the rebuilt page gates it. */}
            <p className="mt-4 max-w-xl leading-relaxed text-slate-400">{headquarters.growth.text}</p>
          </AnimatedSection>
        </div>
      </section>
    </div>
  );
}
