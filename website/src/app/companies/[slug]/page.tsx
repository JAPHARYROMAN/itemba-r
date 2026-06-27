import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import AnimatedSection from '@/components/AnimatedSection';
import BrandVisual from '@/components/BrandVisual';
import CinematicImage from '@/components/cine/CinematicImage';
import EnquiryRouter from '@/components/EnquiryRouter';
import FaqList from '@/components/FaqList';
import JsonLd from '@/components/JsonLd';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  companyProfiles,
  contact,
  faqJsonLd,
  site,
} from '@/lib/site';

type PageProps = {
  params: Promise<{ slug: string }>;
};

/* Per-company accent wash for the cinematic hero grade. */
const CHAPTER_WASH: Record<string, string> = {
  mwanjalisi: 'rgba(245,158,11,0.34)',
  westsides: 'rgba(59,130,246,0.34)',
  enterprises: 'rgba(16,185,129,0.34)',
};

function getCompany(slug: string) {
  return companyProfiles.find((company) => company.slug === slug);
}

export function generateStaticParams() {
  return companyProfiles.map((company) => ({ slug: company.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const company = getCompany(slug);

  if (!company) {
    return {};
  }

  const url = absoluteUrl(`/companies/${company.slug}`);

  return {
    title: company.name,
    description: company.metaDescription,
    alternates: { canonical: url },
    openGraph: {
      title: `${company.name} | ${site.name}`,
      description: company.metaDescription,
      url,
      type: 'website',
    },
  };
}

export default async function CompanyProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const company = getCompany(slug);

  if (!company) {
    notFound();
  }

  const pageUrl = absoluteUrl(`/companies/${company.slug}`);
  const companyImage = 'image' in company ? company.image : undefined;
  const wash = CHAPTER_WASH[company.id] ?? 'rgba(200,134,10,0.30)';
  const businessJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${pageUrl}#business`,
    name: company.name,
    url: pageUrl,
    image: companyImage ? absoluteUrl(companyImage.src) : absoluteUrl('/opengraph-image'),
    description: company.metaDescription,
    parentOrganization: {
      '@type': 'Organization',
      name: site.name,
      url: site.url,
    },
    address: {
      '@type': 'PostalAddress',
      streetAddress: contact.headOffice,
      addressLocality: 'Tunduma',
      addressRegion: 'Songwe',
      addressCountry: 'TZ',
    },
    telephone: contact.primaryPhoneDisplay,
    email: contact.email,
    areaServed: ['Songwe Region', 'Tunduma', 'Tanzania-Zambia corridor'],
    makesOffer: company.services.map((service) => ({
      '@type': 'Offer',
      itemOffered: {
        '@type': 'Service',
        name: service,
      },
    })),
  };

  return (
    <div className="bg-ink-950">
      <JsonLd
        data={[
          businessJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Companies', path: '/companies' },
            { name: company.name, path: `/companies/${company.slug}` },
          ]),
          faqJsonLd(company.faqs),
        ]}
      />

      {/* ══ CINEMATIC HERO ════════════════════════════════════════════ */}
      <section className="relative flex min-h-[80vh] items-end overflow-hidden bg-ink-950">
        {companyImage ? (
          <CinematicImage src={companyImage.src} alt="" priority className="animate-kenburns" />
        ) : (
          <BrandVisual variant={company.visual} label={company.name} className="absolute inset-0" />
        )}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(90deg, ${wash} 0%, rgba(5,8,15,0.6) 45%, rgba(5,8,15,0.97) 100%)`,
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-ink-950/70" />
        <div className="grain-overlay" />

        <div className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-16 pt-40 sm:px-8">
          <AnimatedSection>
            <Link
              href="/companies"
              className="inline-flex items-center gap-2 text-sm font-semibold text-gold-300 transition hover:text-gold-200"
            >
              <span aria-hidden="true">←</span> All companies
            </Link>
            <p
              className={`mt-8 text-xs font-semibold uppercase tracking-[0.25em] ${company.accentClass}`}
            >
              {company.eyebrow}
            </p>
            <h1
              className="cine-shadow mt-4 font-tight font-black leading-[0.92] tracking-tight text-white"
              style={{ fontSize: 'clamp(2.8rem, 7vw, 6rem)' }}
            >
              {company.name}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-200/90 sm:text-xl">
              {company.summary}
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* ══ BODY ══════════════════════════════════════════════════════ */}
      <section className="bg-ink-950 px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-3">
          <div className="space-y-16 lg:col-span-2">
            <AnimatedSection>
              <div className="gold-line mb-6" />
              <h2 className="font-tight text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">
                Services &amp; market focus
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">{company.detail}</p>
              <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {company.services.map((service) => (
                  <div
                    key={service}
                    className="rounded-xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm font-semibold text-white"
                  >
                    {service}
                  </div>
                ))}
              </div>
            </AnimatedSection>

            <AnimatedSection delay={0.06}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {company.gallery.map((image) => (
                  <figure
                    key={image.src}
                    className="group relative h-56 overflow-hidden rounded-2xl ring-1 ring-white/10"
                  >
                    <CinematicImage
                      src={image.src}
                      alt={image.alt}
                      sizes="(min-width:640px) 33vw, 100vw"
                      className="transition-transform duration-700 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/30 to-transparent" />
                    <figcaption className="absolute inset-x-0 bottom-0 p-4 text-xs font-medium leading-relaxed text-white/90">
                      {image.caption}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </AnimatedSection>

            <AnimatedSection delay={0.08}>
              <div className="gold-line mb-6" />
              <h2 className="mb-6 font-tight text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">
                Frequently asked questions
              </h2>
              <FaqList faqs={company.faqs} />
            </AnimatedSection>
          </div>

          <aside className="space-y-6">
            <AnimatedSection direction="fade" delay={0.08}>
              <div className={`space-y-5 border-l-2 ${company.accentBorder} pl-5`}>
                <div>
                  <div className="mb-1 text-xs text-slate-400">Sector</div>
                  <div className={`text-sm font-semibold ${company.accentClass}`}>
                    {company.sector}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-xs text-slate-400">Structure</div>
                  <div className="text-sm font-semibold text-white">Subsidiary of Itemba Group</div>
                </div>
                <div>
                  <div className="mb-1 text-xs text-slate-400">Location</div>
                  <div className="text-sm font-semibold text-white">Songwe Region, Tanzania</div>
                </div>
              </div>
            </AnimatedSection>

            <AnimatedSection direction="fade" delay={0.12}>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">
                  Key strengths
                </p>
                <div className="space-y-3">
                  {company.highlights.map((highlight) => (
                    <div key={highlight} className="flex gap-3 text-sm text-slate-300">
                      <span
                        className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${company.accentBg}`}
                      />
                      <span>{highlight}</span>
                    </div>
                  ))}
                </div>
              </div>
            </AnimatedSection>

            <AnimatedSection direction="fade" delay={0.16}>
              <EnquiryRouter
                compact
                defaultIntentId={company.id}
                title={company.enquiryLabel}
                description="Contact the group office with a prepared message that can be routed to the relevant operating team."
              />
            </AnimatedSection>
          </aside>
        </div>
      </section>
    </div>
  );
}
