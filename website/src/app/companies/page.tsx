import Link from 'next/link';
import type { Metadata } from 'next';
import AnimatedSection from '@/components/AnimatedSection';
import CinematicImage from '@/components/cine/CinematicImage';
import { companies, companiesPage, companyEnquirySubject } from '@/content/companies';
import type { CompanyId } from '@/content/types';
import { absoluteUrl, companyUrl, mailtoWithSubject } from '@/lib/site';

const { meta, hero, actions } = companiesPage;

export const metadata: Metadata = {
  title: meta.title,
  description: meta.description,
  alternates: { canonical: absoluteUrl('/companies') },
  openGraph: {
    title: meta.ogTitle,
    description: meta.ogDescription,
    url: absoluteUrl('/companies'),
  },
};

const CHAPTER_WASH: Record<string, string> = {
  mwanjalisi: 'rgba(245,158,11,0.34)',
  westsides: 'rgba(59,130,246,0.34)',
  enterprises: 'rgba(16,185,129,0.34)',
};

const ACCENT_CHIP: Record<CompanyId, string> = {
  mwanjalisi: 'bg-amber-500',
  westsides: 'bg-blue-500',
  enterprises: 'bg-emerald-500',
};

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
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">{hero.eyebrow}</span>
            </div>
            <h1 className="font-tight text-5xl font-black leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
              {hero.headline.lead} <span className="gradient-text">{hero.headline.accent}</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-300">{hero.lede}</p>
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
            <CinematicImage src={co.band.image.src} alt="" />
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
                  className={`${ACCENT_CHIP[co.id]} mb-5 inline-block rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-white`}
                >
                  {co.band.sector}
                </span>
                <h2 className="cine-shadow font-tight text-4xl font-black leading-[0.98] tracking-tight text-white sm:text-5xl lg:text-6xl">
                  {co.name}
                </h2>
                <p className="mt-6 text-lg leading-relaxed text-slate-200/90">{co.band.summary}</p>

                <div className="mt-7 flex flex-wrap gap-2">
                  {co.band.chips.map((p) => (
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
                    href={companyUrl(co.slug)}
                    className="btn-primary bg-gold-500 px-7 py-3.5 text-sm font-semibold text-white hover:bg-gold-400 hover:shadow-lg hover:shadow-gold-500/25"
                  >
                    {actions.profile}
                  </Link>
                  <a
                    href={mailtoWithSubject(companyEnquirySubject(co))}
                    className="btn-primary border border-white/25 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur hover:border-white/60 hover:bg-white/10"
                  >
                    {actions.enquire}
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
