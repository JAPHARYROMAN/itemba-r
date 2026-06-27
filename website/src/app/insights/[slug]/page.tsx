import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import AnimatedSection from '@/components/AnimatedSection';
import BrandVisual from '@/components/BrandVisual';
import EnquiryRouter from '@/components/EnquiryRouter';
import JsonLd from '@/components/JsonLd';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  companyProfiles,
  companyUrl,
  insightArticles,
  insightUrl,
  locationProfiles,
  locationUrl,
  serviceAreas,
  serviceUrl,
  site,
} from '@/lib/site';

type PageProps = {
  params: Promise<{ slug: string }>;
};

function getArticle(slug: string) {
  return insightArticles.find((article) => article.slug === slug);
}

function getRelatedServices(article: (typeof insightArticles)[number]) {
  return serviceAreas.filter((service) => article.serviceSlugs.includes(service.slug));
}

function getRelatedCompanies(article: (typeof insightArticles)[number]) {
  return companyProfiles.filter((company) => article.companySlugs.includes(company.slug));
}

function getRelatedLocations(article: (typeof insightArticles)[number]) {
  return locationProfiles.filter((location) => article.locationSlugs.includes(location.slug));
}

export function generateStaticParams() {
  return insightArticles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);

  if (!article) {
    return {};
  }

  const url = absoluteUrl(insightUrl(article.slug));

  return {
    title: article.title,
    description: article.metaDescription,
    keywords: article.keywords,
    alternates: { canonical: url },
    openGraph: {
      title: `${article.title} | ${site.name}`,
      description: article.metaDescription,
      url,
      type: 'article',
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
    },
  };
}

export default async function InsightArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const article = getArticle(slug);

  if (!article) {
    notFound();
  }

  const pageUrl = absoluteUrl(insightUrl(article.slug));
  const relatedServices = getRelatedServices(article);
  const relatedCompanies = getRelatedCompanies(article);
  const relatedLocations = getRelatedLocations(article);
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${pageUrl}#article`,
    headline: article.title,
    description: article.metaDescription,
    url: pageUrl,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    author: {
      '@id': `${site.url}/#organization`,
    },
    publisher: {
      '@id': `${site.url}/#organization`,
    },
    mainEntityOfPage: pageUrl,
    about: relatedServices.map((service) => ({
      '@type': 'Service',
      name: service.title,
      url: absoluteUrl(serviceUrl(service.slug)),
    })),
  };

  return (
    <div className="bg-ink-950">
      <JsonLd
        data={[
          articleJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Insights', path: '/insights' },
            { name: article.title, path: insightUrl(article.slug) },
          ]),
        ]}
      />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-ink-950 px-5 pb-20 pt-44 sm:px-8">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.5 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 mx-auto max-w-4xl">
          <AnimatedSection>
            <Link
              href="/insights"
              className="inline-flex items-center gap-2 text-sm font-semibold text-gold-300 transition hover:text-gold-200"
            >
              <span aria-hidden="true">←</span> All insights
            </Link>
            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">
              {article.eyebrow} · {article.readingTime}
            </p>
            <h1
              className="mt-4 font-tight font-black leading-[1.02] tracking-tight text-white"
              style={{ fontSize: 'clamp(2.4rem, 5vw, 4.5rem)' }}
            >
              {article.title}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">{article.summary}</p>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Body ──────────────────────────────────────────────────── */}
      <section className="bg-ink-950 px-5 py-20 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_360px]">
          <article>
            <AnimatedSection>
              <div className="mb-10 flex flex-wrap gap-2">
                {article.audience.map((audience) => (
                  <span key={audience} className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-medium text-white/80">
                    {audience}
                  </span>
                ))}
              </div>
            </AnimatedSection>

            <div className="space-y-14">
              {article.sections.map((section, index) => (
                <AnimatedSection key={section.heading} delay={index * 0.04}>
                  <section>
                    <div className="gold-line mb-6" />
                    <h2 className="mb-5 font-tight text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">
                      {section.heading}
                    </h2>
                    <p className="text-lg leading-relaxed text-slate-300">{section.body}</p>
                    {section.points && (
                      <div className="mt-7 grid grid-cols-1 gap-3">
                        {section.points.map((point) => (
                          <div key={point} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-relaxed text-slate-300">
                            <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-gold-500" />
                            <span>{point}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </AnimatedSection>
              ))}
            </div>
          </article>

          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            {relatedServices.length > 0 && (
              <AnimatedSection direction="left">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">
                    Related services
                  </p>
                  <div className="space-y-3">
                    {relatedServices.map((service) => (
                      <Link
                        key={service.slug}
                        href={serviceUrl(service.slug)}
                        className="block rounded-xl bg-white/[0.04] p-4 text-sm font-semibold text-white transition hover:text-gold-300"
                      >
                        {service.title}
                      </Link>
                    ))}
                  </div>
                </div>
              </AnimatedSection>
            )}

            {relatedCompanies.length > 0 && (
              <AnimatedSection direction="left" delay={0.08}>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">
                    Related companies
                  </p>
                  <div className="space-y-3">
                    {relatedCompanies.map((company) => (
                      <Link
                        key={company.slug}
                        href={companyUrl(company.slug)}
                        className="block rounded-xl bg-white/[0.04] p-4 transition hover:bg-white/[0.08]"
                      >
                        <span className="block text-sm font-semibold text-white">{company.name}</span>
                        <span className="mt-1 block text-xs text-slate-400">{company.sector}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              </AnimatedSection>
            )}

            {relatedLocations.length > 0 && (
              <AnimatedSection direction="left" delay={0.12}>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">
                    Related location
                  </p>
                  <div className="space-y-3">
                    {relatedLocations.map((location) => (
                      <Link
                        key={location.slug}
                        href={locationUrl(location.slug)}
                        className="block rounded-xl bg-white/[0.04] p-4 transition hover:bg-white/[0.08]"
                      >
                        <span className="block text-sm font-semibold text-white">{location.shortTitle}</span>
                        <span className="mt-1 block text-xs text-slate-400">{location.eyebrow}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              </AnimatedSection>
            )}

            <AnimatedSection direction="left" delay={0.16}>
              <EnquiryRouter
                compact
                title="Ask about this topic"
                description="Route a focused enquiry to the closest Itemba Group operating area."
              />
            </AnimatedSection>
          </aside>
        </div>
      </section>

      {/* ── Continue CTA ──────────────────────────────────────────── */}
      <section className="bg-ink-950 px-5 py-20 sm:px-8">
        <AnimatedSection className="mx-auto max-w-3xl text-center">
          <div className="gold-line mx-auto mb-8" />
          <h2 className="mb-5 font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
            Continue from this guide
          </h2>
          <p className="mb-8 text-sm leading-relaxed text-slate-400">
            Use the next route that best matches the business need, or open the full insights hub for
            more practical guidance.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href={article.cta.href} className="btn-primary rounded-full bg-gold-500 px-6 py-3 text-sm font-semibold text-white hover:bg-gold-400">
              {article.cta.label}
            </Link>
            <Link href="/insights" className="btn-primary rounded-full border border-white/25 px-6 py-3 text-sm font-semibold text-slate-200 hover:border-gold-400 hover:text-gold-300">
              More insights
            </Link>
          </div>
        </AnimatedSection>
      </section>
    </div>
  );
}
