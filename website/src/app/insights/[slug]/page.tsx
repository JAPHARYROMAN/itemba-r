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
    <>
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

      <section className="relative overflow-hidden bg-ink-900 px-5 pb-20 pt-40 sm:px-8">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.5 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
          <AnimatedSection>
            <Link href="/insights" className="text-sm font-semibold text-gold-400 hover:text-gold-300">
              All insights
            </Link>
            <p className="mb-4 mt-8 text-xs font-semibold uppercase tracking-widest text-gold-400">
              {article.eyebrow} - {article.readingTime}
            </p>
            <h1
              className="mb-6 font-tight font-black leading-tight tracking-tightest text-white"
              style={{ fontSize: 'clamp(2.55rem, 5.4vw, 5.2rem)' }}
            >
              {article.title}
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-slate-300">{article.summary}</p>
          </AnimatedSection>
          <AnimatedSection direction="left">
            <div className="relative h-80 overflow-hidden rounded-3xl shadow-2xl">
              <BrandVisual variant="operations" label={article.title} className="absolute inset-0" />
              <div className="absolute inset-0 bg-gradient-to-br from-ink-950/35 to-transparent" />
            </div>
          </AnimatedSection>
        </div>
      </section>

      <section className="bg-white px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_360px]">
          <article>
            <AnimatedSection>
              <div className="mb-10 flex flex-wrap gap-2">
                {article.audience.map((audience) => (
                  <span key={audience} className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-600">
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
                    <h2 className="mb-5 font-tight text-3xl font-black leading-tight tracking-tighter text-ink-900 sm:text-4xl">
                      {section.heading}
                    </h2>
                    <p className="text-lg leading-relaxed text-slate-600">{section.body}</p>
                    {section.points && (
                      <div className="mt-7 grid grid-cols-1 gap-3">
                        {section.points.map((point) => (
                          <div key={point} className="flex gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-600">
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
            <AnimatedSection direction="left">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Related Services
                </p>
                <div className="space-y-3">
                  {relatedServices.map((service) => (
                    <Link
                      key={service.slug}
                      href={serviceUrl(service.slug)}
                      className="block rounded-xl bg-white p-4 text-sm font-semibold text-ink-900 transition hover:text-gold-600"
                    >
                      {service.title}
                    </Link>
                  ))}
                </div>
              </div>
            </AnimatedSection>

            <AnimatedSection direction="left" delay={0.08}>
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Related Companies
                </p>
                <div className="space-y-3">
                  {relatedCompanies.map((company) => (
                    <Link
                      key={company.slug}
                      href={companyUrl(company.slug)}
                      className="block rounded-xl bg-slate-50 p-4 transition hover:bg-slate-100"
                    >
                      <span className="block text-sm font-semibold text-ink-900">{company.name}</span>
                      <span className="mt-1 block text-xs text-slate-500">{company.sector}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </AnimatedSection>

            <AnimatedSection direction="left" delay={0.12}>
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Related Location
                </p>
                <div className="space-y-3">
                  {relatedLocations.map((location) => (
                    <Link
                      key={location.slug}
                      href={locationUrl(location.slug)}
                      className="block rounded-xl bg-slate-50 p-4 transition hover:bg-slate-100"
                    >
                      <span className="block text-sm font-semibold text-ink-900">{location.shortTitle}</span>
                      <span className="mt-1 block text-xs text-slate-500">{location.eyebrow}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </AnimatedSection>

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

      <section className="bg-ink-900 px-5 py-20 sm:px-8">
        <AnimatedSection className="mx-auto max-w-3xl text-center">
          <div className="gold-line mx-auto mb-8" />
          <h2 className="mb-5 font-tight text-4xl font-black leading-tight tracking-tighter text-white sm:text-5xl">
            Continue from This Guide
          </h2>
          <p className="mb-8 text-sm leading-relaxed text-slate-300">
            Use the next route that best matches the business need, or open the full
            insights hub for more practical guidance.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href={article.cta.href} className="btn-primary rounded-full bg-gold-500 px-6 py-3 text-sm font-semibold text-white hover:bg-gold-400">
              {article.cta.label}
            </Link>
            <Link href="/insights" className="btn-primary rounded-full border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-200 hover:border-gold-400 hover:text-gold-300">
              More insights
            </Link>
          </div>
        </AnimatedSection>
      </section>
    </>
  );
}
