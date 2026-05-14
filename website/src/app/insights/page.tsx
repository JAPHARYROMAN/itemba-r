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
    <>
      <JsonLd
        data={[
          insightsJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Insights', path: '/insights' },
          ]),
        ]}
      />

      <section className="relative overflow-hidden bg-ink-900 px-5 pb-24 pt-40 sm:px-8">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.5 }} />
          <div className="hero-orb hero-orb-blue" style={{ opacity: 0.3 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <AnimatedSection>
            <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">
              Insights
            </p>
            <h1
              className="mb-6 font-tight font-black leading-none tracking-tightest text-white"
              style={{ fontSize: 'clamp(2.8rem, 6vw, 5.5rem)' }}
            >
              Practical Guides for<br />
              <span className="gradient-text">Business Enquiries.</span>
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-slate-300">
              Focused articles for customers, suppliers, contractors, transport operators,
              and partners who need to choose the right Itemba Group service route.
            </p>
          </AnimatedSection>
          <AnimatedSection direction="left">
            <div className="relative h-80 overflow-hidden rounded-3xl shadow-2xl">
              <BrandVisual variant="operations" label="Itemba Group insight guides" className="absolute inset-0" />
              <div className="absolute inset-0 bg-gradient-to-br from-ink-950/35 to-transparent" />
            </div>
          </AnimatedSection>
        </div>
      </section>

      <section className="bg-white px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <AnimatedSection className="mb-10">
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold-600">
              Featured Guide
            </p>
          </AnimatedSection>

          <AnimatedSection>
            <Link
              href={insightUrl(featured.slug)}
              className="group grid overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 shadow-sm transition hover:border-gold-400 hover:shadow-xl lg:grid-cols-[0.92fr_1.08fr]"
            >
              <div className="relative min-h-72 overflow-hidden">
                <BrandVisual variant="corridor" label={featured.title} className="absolute inset-0 transition-transform duration-700 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-r from-ink-950/65 to-transparent" />
              </div>
              <div className="p-8 sm:p-10">
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-600">
                  {featured.eyebrow} - {featured.readingTime}
                </p>
                <h2 className="mb-5 font-tight text-3xl font-black leading-tight tracking-tighter text-ink-900 sm:text-4xl">
                  {featured.title}
                </h2>
                <p className="mb-6 text-sm leading-relaxed text-slate-600">{featured.summary}</p>
                <div className="mb-7 flex flex-wrap gap-2">
                  {featured.audience.map((audience) => (
                    <span key={audience} className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                      {audience}
                    </span>
                  ))}
                </div>
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-gold-600 transition group-hover:text-gold-500">
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

      <section className="bg-slate-50 px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <AnimatedSection className="mb-12">
            <div className="gold-line mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold-600">
              More Articles
            </p>
            <h2 className="font-tight text-4xl font-black leading-tight tracking-tighter text-ink-900 sm:text-5xl">
              Guides by Need
            </h2>
          </AnimatedSection>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {remaining.map((article, index) => (
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
                  <div className="mb-6 flex flex-wrap gap-2">
                    {relatedServices(article)
                      .slice(0, 2)
                      .map((service) => (
                        <span key={service.slug} className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600">
                          {service.shortTitle}
                        </span>
                      ))}
                  </div>
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-gold-600 transition group-hover:text-gold-500">
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

      <section className="bg-white px-5 py-20 sm:px-8">
        <AnimatedSection className="mx-auto max-w-3xl text-center">
          <div className="gold-line mx-auto mb-8" />
          <h2 className="mb-5 font-tight text-4xl font-black leading-tight tracking-tighter text-ink-900 sm:text-5xl">
            Need a Direct Route?
          </h2>
          <p className="mb-8 text-sm leading-relaxed text-slate-600">
            Use the capability map or partnerships page when your enquiry spans more than
            one company, service, or operating division.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/capabilities" className="btn-primary rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-white hover:bg-ink-700">
              Capability map
            </Link>
            <Link href="/partnerships" className="btn-primary rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-ink-900 hover:border-gold-400 hover:text-gold-600">
              Partnerships
            </Link>
            <Link href={serviceUrl('logistics-and-cross-border-transit')} className="btn-primary rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-ink-900 hover:border-gold-400 hover:text-gold-600">
              Logistics guide
            </Link>
          </div>
        </AnimatedSection>
      </section>
    </>
  );
}
