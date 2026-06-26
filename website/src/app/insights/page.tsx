import Link from 'next/link';
import type { Metadata } from 'next';
import AnimatedSection from '@/components/AnimatedSection';
import BrandVisual from '@/components/BrandVisual';
import JsonLd from '@/components/JsonLd';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  insightArticles,
  insightUrl,
  serviceAreas,
  serviceUrl,
  site,
} from '@/lib/site';

export const metadata: Metadata = {
  title: 'Insights',
  description:
    'Practical Itemba Group articles for business enquiries, supplier introductions, location context, service routing, and company selection in Songwe Region, Tanzania.',
  alternates: { canonical: absoluteUrl('/insights') },
  openGraph: {
    title: 'Itemba Group Insights',
    description:
      'Guides for customers, suppliers, contractors, transport operators, and partners working with Itemba Group companies.',
    url: absoluteUrl('/insights'),
  },
};

const insightsJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Blog',
  '@id': `${absoluteUrl('/insights')}#insights`,
  name: 'Itemba Group Insights',
  url: absoluteUrl('/insights'),
  publisher: {
    '@id': `${site.url}/#organization`,
  },
  blogPost: insightArticles.map((article) => ({
    '@type': 'BlogPosting',
    headline: article.title,
    url: absoluteUrl(insightUrl(article.slug)),
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
  })),
};

function relatedServices(article: (typeof insightArticles)[number]) {
  return serviceAreas.filter((service) => article.serviceSlugs.includes(service.slug));
}

export default function InsightsPage() {
  const featured = insightArticles[0];
  const remaining = insightArticles.slice(1);

  return (
    <div className="bg-ink-950">
      <JsonLd
        data={[
          insightsJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Insights', path: '/insights' },
          ]),
        ]}
      />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-ink-950 px-5 pb-24 pt-44 sm:px-8">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.5 }} />
          <div className="hero-orb hero-orb-blue" style={{ opacity: 0.3 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 mx-auto max-w-7xl">
          <AnimatedSection>
            <div className="mb-5 flex items-center gap-3">
              <span className="h-px w-10 bg-gold-400" />
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">
                Insights
              </span>
            </div>
            <h1 className="font-tight text-5xl font-black leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
              Practical guides for <span className="gradient-text">business enquiries.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-300">
              Focused articles for customers, suppliers, contractors, transport operators and
              partners who need to choose the right Itemba Group service route.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Featured ──────────────────────────────────────────────── */}
      <section className="bg-ink-950 px-5 py-20 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <AnimatedSection className="mb-10">
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">
              Featured guide
            </p>
          </AnimatedSection>

          <AnimatedSection>
            <Link
              href={insightUrl(featured.slug)}
              className="group grid overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] transition hover:border-gold-400/50 hover:bg-white/[0.06] lg:grid-cols-[0.92fr_1.08fr]"
            >
              <div className="relative min-h-72 overflow-hidden">
                <BrandVisual
                  variant="corridor"
                  label={featured.title}
                  className="absolute inset-0 transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-ink-950/65 to-transparent" />
              </div>
              <div className="p-8 sm:p-10">
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">
                  {featured.eyebrow} · {featured.readingTime}
                </p>
                <h2 className="mb-5 font-tight text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">
                  {featured.title}
                </h2>
                <p className="mb-6 text-sm leading-relaxed text-slate-400">{featured.summary}</p>
                <div className="mb-7 flex flex-wrap gap-2">
                  {featured.audience.map((audience) => (
                    <span key={audience} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-medium text-white/80">
                      {audience}
                    </span>
                  ))}
                </div>
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-gold-300 transition group-hover:text-gold-200">
                  Read guide
                  <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </span>
              </div>
            </Link>
          </AnimatedSection>
        </div>
      </section>

      {/* ── More articles ─────────────────────────────────────────── */}
      <section className="bg-ink-950 px-5 py-20 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <AnimatedSection className="mb-12">
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">
              More articles
            </p>
            <h2 className="font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
              Guides by need
            </h2>
          </AnimatedSection>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {remaining.map((article, index) => (
              <AnimatedSection key={article.slug} delay={index * 0.06}>
                <Link
                  href={insightUrl(article.slug)}
                  className="group flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:-translate-y-1 hover:border-gold-400/50 hover:bg-white/[0.06]"
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
                  <div className="mb-6 flex flex-wrap gap-2">
                    {relatedServices(article)
                      .slice(0, 2)
                      .map((service) => (
                        <span key={service.slug} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-medium text-white/80">
                          {service.shortTitle}
                        </span>
                      ))}
                  </div>
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-gold-300 transition group-hover:text-gold-200">
                    Read article
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

      {/* ── Direct route CTA ──────────────────────────────────────── */}
      <section className="bg-ink-950 px-5 py-20 sm:px-8">
        <AnimatedSection className="mx-auto max-w-3xl text-center">
          <div className="gold-line mx-auto mb-8" />
          <h2 className="mb-5 font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
            Need a direct route?
          </h2>
          <p className="mb-8 text-sm leading-relaxed text-slate-400">
            Use the capability map or partnerships page when your enquiry spans more than one
            company, service or operating division.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/capabilities" className="btn-primary rounded-full bg-gold-500 px-6 py-3 text-sm font-semibold text-white hover:bg-gold-400">
              Capability map
            </Link>
            <Link href="/partnerships" className="btn-primary rounded-full border border-white/25 px-6 py-3 text-sm font-semibold text-white hover:border-gold-400 hover:text-gold-300">
              Partnerships
            </Link>
            <Link href={serviceUrl('logistics-and-cross-border-transit')} className="btn-primary rounded-full border border-white/25 px-6 py-3 text-sm font-semibold text-white hover:border-gold-400 hover:text-gold-300">
              Logistics guide
            </Link>
          </div>
        </AnimatedSection>
      </section>
    </div>
  );
}
