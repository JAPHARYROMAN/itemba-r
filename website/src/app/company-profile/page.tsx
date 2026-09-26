import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import AnimatedSection from '@/components/AnimatedSection';
import EnquiryRouter from '@/components/EnquiryRouter';
import FaqList from '@/components/FaqList';
import JsonLd from '@/components/JsonLd';
import PrintProfileButton from '@/components/PrintProfileButton';
import CompanyProfilePrintScope from '@/components/CompanyProfilePrintScope';
import CinematicImage from '@/components/cine/CinematicImage';
import ProfileNav from '@/components/cine/ProfileNav';
import Timeline from '@/components/cine/Timeline';
import OrgChart from '@/components/cine/OrgChart';
import LeadershipCard from '@/components/cine/LeadershipCard';
import SectorIcon from '@/components/SectorIcon';
import { enquiryPrompts } from '@/content/enquiry';
import { profileFaqCopy } from '@/content/faqs';
import {
  assetCapacity,
  assetIcons,
  assetsNote,
  attachments,
  attachmentsNote,
  bankingPurposes,
  branchOperations,
  businessActivities,
  complianceItems,
  corridorOpportunity,
  coverFacts,
  financialOverview,
  futurePlans,
  history,
  leadershipHeading,
  leadershipTeam,
  legalCompanyProfiles,
  legalLabels,
  operationsNote,
  outline,
  overviewFacts,
  overviewParagraphs,
  ownershipSummary,
  printProfileOptions,
  profileCompanyOperations,
  profileCover,
  profileMeta,
  profilePdfHref,
  profileProductsServices,
  profileScreenCopy,
  sectionLeads,
  sectionNumber,
  sectionTitle,
  strengths,
  targetMarketGroups,
  targetMarkets,
  visionMission,
  type ProfileSectionId,
} from '@/content/profile';
import type { CompanyId } from '@/content/types';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  contact,
  faqJsonLd,
  groupFaqs,
  site,
} from '@/lib/site';
import ProfileDocuments from '@/print/ProfileDocuments';

export const metadata: Metadata = {
  title: profileMeta.title,
  description: profileMeta.description,
  alternates: { canonical: absoluteUrl('/company-profile') },
  openGraph: {
    title: profileMeta.ogTitle,
    description: profileMeta.ogDescription,
    url: absoluteUrl('/company-profile'),
  },
};

const profileJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  '@id': `${absoluteUrl('/company-profile')}#profile`,
  name: profileMeta.ogTitle,
  url: absoluteUrl('/company-profile'),
  about: {
    '@id': `${site.url}/#organization`,
  },
};

/** Legacy accent bar per operating company (presentation stays out of content). */
const operationAccent: Record<CompanyId, string> = {
  mwanjalisi: 'bg-amber-500',
  westsides: 'bg-blue-500',
  enterprises: 'bg-emerald-500',
};

/** Anchor id, number, title and lead of a profile section, from the outline. */
function section(id: ProfileSectionId) {
  return { id, index: sectionNumber(id), title: sectionTitle(id), lead: sectionLeads[id] };
}

function ProfileSection({
  id,
  index,
  title,
  lead,
  children,
}: {
  id: string;
  index: number;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <AnimatedSection>
      <section id={id} className="scroll-mt-28 border-t border-white/10 py-12 print:break-inside-avoid">
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-gold-500/30 bg-gold-500/10 text-sm font-black text-gold-300">
            {index}
          </span>
          <div>
            <h2 className="font-tight text-3xl font-black leading-tight tracking-tight text-white">{title}</h2>
            {lead ? <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-300">{lead}</p> : null}
          </div>
        </div>
        {children}
      </section>
    </AnimatedSection>
  );
}

function BulletList({ items }: { items: readonly string[] }) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item} className="flex gap-3 text-sm leading-relaxed text-slate-300">
          <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-gold-400" />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

export default function CompanyProfilePage() {
  return (
    <>
      <JsonLd
        data={[
          profileJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Company Profile', path: '/company-profile' },
          ]),
          faqJsonLd(groupFaqs),
        ]}
      />

      <CompanyProfilePrintScope />

      <section
        id="cover-page"
        className="relative overflow-hidden bg-ink-950 px-5 pb-20 pt-40 sm:px-8 print:bg-white print:pb-8 print:pt-8"
      >
        <div className="hero-ambient print:hidden">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.4 }} />
          <div className="hero-orb hero-orb-blue" style={{ opacity: 0.28 }} />
          <div className="grid-overlay" />
        </div>
        <div className="grain-overlay print:hidden" />
        <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <AnimatedSection>
            <div className="mb-4 flex items-center gap-3">
              <span className="h-px w-10 bg-gold-400 print:hidden" />
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300 print:text-ink-900">
                {profileCover.eyebrow}
              </p>
            </div>
            <h1
              className="mb-6 font-tight font-black leading-none text-white print:text-ink-900"
              style={{ fontSize: 'clamp(2.7rem, 6vw, 5.4rem)' }}
            >
              {profileCover.headline.lead}
              <span className="block text-gold-300 print:text-ink-900">{profileCover.headline.accent}</span>
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-slate-300 print:text-slate-700">
              {profileCover.lede}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <PrintProfileButton profiles={printProfileOptions} />
              <Link
                href="/contact"
                className="print-hidden btn-primary inline-flex rounded-full border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-200 hover:border-slate-300 hover:text-white"
              >
                {profileCover.enquireLabel}
              </Link>
            </div>

            <div className="print-hidden mt-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gold-400">{profileCover.downloads.heading}</p>
              <div className="flex flex-wrap gap-2">
                {printProfileOptions.map((option) => (
                  <a
                    key={option.id}
                    href={profilePdfHref(option.id)}
                    download
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-gold-400/60 hover:text-white"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-3.5 w-3.5" aria-hidden="true">
                      <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {option.label}
                  </a>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-400">
                {profileCover.downloads.note}
              </p>
            </div>
          </AnimatedSection>

          <AnimatedSection direction="fade" className="print:hidden">
            <div className="relative h-80 overflow-hidden rounded-2xl ring-1 ring-white/10 cine-shadow">
              <CinematicImage
                src={profileCover.image.src}
                alt={profileCover.image.alt}
                priority
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/20 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-5">
                <p className="text-sm font-semibold text-white">{profileCover.imageCaption}</p>
                <p className="mt-1 text-xs text-slate-400">{site.domain}</p>
              </div>
            </div>
          </AnimatedSection>
        </div>

        <div className="relative z-10 mx-auto mt-14 grid max-w-7xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {coverFacts.map((fact) => (
            <div key={fact.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 print:border-slate-200 print:bg-white">
              <p className="text-xs font-semibold uppercase tracking-widest text-gold-400 print:text-slate-500">{fact.label}</p>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-white print:text-ink-900">{fact.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-ink-950 px-5 py-16 sm:px-8 print:px-0 print:py-8">
        <div className="print-sheet mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[18rem_1fr]">
          <aside className="print-hidden lg:sticky lg:top-28 lg:self-start">
            <ProfileNav outline={outline} />
          </aside>

          <div>
            <ProfileSection {...section('company-overview')}>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_0.85fr]">
                <div className="space-y-4 text-sm leading-relaxed text-slate-300">
                  {overviewParagraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                  <dl className="space-y-4 text-sm">
                    {overviewFacts.map((fact) => (
                      <div key={fact.label}>
                        <dt className="font-semibold text-white">{fact.label}</dt>
                        <dd className={fact.value === contact.email ? 'mt-1 break-all text-slate-300' : 'mt-1 text-slate-300'}>
                          {fact.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </ProfileSection>

            <ProfileSection {...section('vision-mission')}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {visionMission.map((item) => (
                  <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-sm print:shadow-none">
                    <h3 className="font-tight text-xl font-black text-white">{item.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-slate-300">{item.body}</p>
                  </div>
                ))}
              </div>
            </ProfileSection>

            <ProfileSection {...section('business-activities')}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {businessActivities.map((activity) => (
                  <div
                    key={activity.title}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
                  >
                    <p className="text-xs font-semibold uppercase text-slate-400">{activity.company}</p>
                    <h3 className="mt-3 font-tight text-xl font-black text-white">{activity.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-slate-300">{activity.summary}</p>
                    {'divisions' in activity ? (
                      <div className="mt-5 space-y-4">
                        {activity.divisions.map((division, index) => (
                          <div key={division.name} className="rounded-md bg-white/[0.04] p-4">
                            <p className="text-xs font-black uppercase text-gold-400">
                              {profileScreenCopy.divisionLabel} {index + 1}
                            </p>
                            <h4 className="mt-1 font-tight text-base font-black text-white">
                              {division.name}
                            </h4>
                            <p className="mt-2 text-sm leading-relaxed text-slate-300">
                              {division.detail}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-5 space-y-2">
                        {activity.points.map((point) => (
                          <div key={point} className="flex gap-2 text-sm text-slate-300">
                            <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gold-400" />
                            <span>{point}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ProfileSection>

            <ProfileSection {...section('products-services')}>
              <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
                {profileProductsServices.map((service) => (
                  <div key={service.title} className="grid grid-cols-1 gap-5 p-5 md:grid-cols-[0.8fr_1.2fr]">
                    <div>
                      <p className="text-xs font-semibold uppercase text-gold-400">{service.eyebrow}</p>
                      <h3 className="mt-2 font-tight text-xl font-black text-white">{service.title}</h3>
                      <p className="mt-2 text-sm text-slate-400">{service.eyebrow}</p>
                    </div>
                    <div>
                      <p className="text-sm leading-relaxed text-slate-300">{service.summary}</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {service.offerings.map((offering) => (
                          <span key={offering} className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-slate-300">
                            {offering}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ProfileSection>

            <ProfileSection {...section('target-market')}>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {targetMarketGroups.map((market) => (
                  <div key={market.company} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                    <p className="text-xs font-semibold uppercase text-gold-400">{market.company}</p>
                    <h3 className="mt-2 font-tight text-xl font-black text-white">{market.title}</h3>
                    <div className="mt-4">
                      <BulletList items={market.points} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-2xl border border-gold-500/30 bg-gold-500/[0.08] p-5">
                <p className="text-sm font-semibold uppercase text-gold-300">
                  {corridorOpportunity.title}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-slate-300">
                  {corridorOpportunity.body}
                </p>
              </div>
              <div className="mt-6">
                <BulletList items={targetMarkets} />
              </div>
            </ProfileSection>

            <ProfileSection {...section('operations-branches')}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {profileCompanyOperations.map((company) => (
                  <Link
                    key={company.slug}
                    href={`/companies/${company.slug}`}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-gold-400 hover:bg-white/[0.06]"
                  >
                    <div className={`mb-4 h-2 w-12 rounded-full ${operationAccent[company.companyId]}`} />
                    <h3 className="font-tight text-lg font-black text-white">{company.name}</h3>
                    <p className="mt-2 text-xs font-semibold uppercase text-slate-400">{company.sector}</p>
                    <p className="mt-3 text-sm leading-relaxed text-slate-300">{company.detail}</p>
                  </Link>
                ))}
              </div>
              <p className="mt-5 text-sm leading-relaxed text-slate-300">
                {operationsNote}
              </p>

              <div className="mt-8 space-y-6">
                {branchOperations.map((operation) => (
                  <div key={operation.company} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                    <h3 className="font-tight text-xl font-black text-white">{operation.company}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-300">{operation.summary}</p>
                    <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {operation.branches.map((branch) => (
                        <div key={branch.name} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                          {'image' in branch && branch.image ? (
                            <div className="relative mb-4 overflow-hidden rounded-2xl bg-ink-950">
                              <img
                                src={branch.image.src}
                                alt=""
                                aria-hidden="true"
                                className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-xl"
                                loading="lazy"
                              />
                              <div className="relative flex min-h-48 items-center justify-center p-2">
                                <img
                                  src={branch.image.src}
                                  alt={branch.image.alt}
                                  className="max-h-52 w-full rounded-md object-contain shadow-lg ring-1 ring-white/10"
                                  loading="lazy"
                                />
                              </div>
                            </div>
                          ) : null}
                          <h4 className="font-tight text-lg font-black text-white">{branch.name}</h4>
                          <p className="mt-2 text-sm font-semibold text-gold-300">{branch.focus}</p>
                          <p className="mt-2 text-sm leading-relaxed text-slate-300">{branch.coverage}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ProfileSection>

            <ProfileSection {...section('management-ownership')}>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <BulletList items={ownershipSummary} />
              </div>
              <div className="mt-6">
                <OrgChart companies={legalCompanyProfiles} />
              </div>

              <div className="mt-8">
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">{leadershipHeading}</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {leadershipTeam.map((leader) => (
                    <LeadershipCard key={leader.name} leader={leader} />
                  ))}
                </div>
              </div>

              <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-sm print:shadow-none">
                <p className="text-xs font-semibold uppercase text-gold-400">
                  {legalLabels.heading}
                </p>
                <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
                  {legalCompanyProfiles.map((company) => (
                    <div key={company.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                      <h3 className="font-tight text-lg font-black text-white">{company.name}</h3>
                      <dl className="mt-4 space-y-3 text-sm">
                        <div>
                          <dt className="font-semibold uppercase text-slate-400">{legalLabels.tin}</dt>
                          <dd className="mt-1 text-slate-300">{company.tin}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold uppercase text-slate-400">{legalLabels.incorporation}</dt>
                          <dd className="mt-1 text-slate-300">
                            {company.incorporationDate}; {legalLabels.numberPrefix} {company.incorporationNumber}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold uppercase text-slate-400">{legalLabels.directors}</dt>
                          <dd className="mt-1 text-slate-300">{company.directors.join('; ')}</dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>
              </div>
            </ProfileSection>

            <ProfileSection {...section('company-history')}>
              <Timeline items={history} />
            </ProfileSection>

            <ProfileSection {...section('assets-capacity')}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {assetCapacity.map((item, index) => (
                  <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                    <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gold-500/20 bg-gold-500/10 text-gold-300">
                      <SectorIcon name={assetIcons[index] ?? 'trade'} className="h-5 w-5" />
                    </span>
                    <h3 className="font-tight text-lg font-black text-white">{item.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-slate-300">{item.body}</p>
                  </div>
                ))}
              </div>
              <p className="mt-5 text-sm leading-relaxed text-slate-300">
                {assetsNote}
              </p>
            </ProfileSection>

            <ProfileSection {...section('financial-overview')}>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <p className="text-sm leading-relaxed text-slate-300">
                  {financialOverview[0]}
                </p>
                <p className="mt-4 text-sm leading-relaxed text-slate-300">
                  {financialOverview[1]}
                </p>
              </div>
            </ProfileSection>

            <ProfileSection {...section('compliance-information')}>
              <BulletList items={complianceItems} />
            </ProfileSection>

            <ProfileSection {...section('competitive-strengths')}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {strengths.map((strength) => (
                  <div key={strength} className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                    <span className="mt-0.5 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-gold-500/20 bg-gold-500/10 text-gold-300">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" aria-hidden="true">
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <p className="text-sm leading-relaxed text-slate-300">{strength}</p>
                  </div>
                ))}
              </div>
            </ProfileSection>

            <ProfileSection {...section('future-plans')}>
              <BulletList items={futurePlans} />
            </ProfileSection>

            <ProfileSection {...section('banking-purpose')}>
              <BulletList items={bankingPurposes} />
            </ProfileSection>

            <ProfileSection {...section('contact-information')}>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.85fr_1.15fr]">
                <div className="rounded-2xl bg-ink-900 p-6 text-white print:border print:border-slate-200 print:bg-white print:text-ink-900">
                  <p className="mb-5 text-xs font-semibold uppercase text-gold-400 print:text-slate-500">{profileScreenCopy.contact.heading}</p>
                  <div className="space-y-4 text-sm leading-relaxed">
                    <div>
                      <div className="font-semibold">{profileScreenCopy.contact.headOffice}</div>
                      <p className="text-slate-300 print:text-slate-600">{contact.headOffice}</p>
                    </div>
                    <div>
                      <div className="font-semibold">{profileScreenCopy.contact.postal}</div>
                      <p className="text-slate-300 print:text-slate-600">{contact.postal}</p>
                    </div>
                    <div>
                      <div className="font-semibold">{profileScreenCopy.contact.phone}</div>
                      <p className="text-slate-300 print:text-slate-600">{contact.primaryPhoneDisplay}</p>
                      <p className="text-slate-300 print:text-slate-600">{contact.secondaryPhoneDisplay}</p>
                    </div>
                    <div>
                      <div className="font-semibold">{profileScreenCopy.contact.email}</div>
                      <p className="break-all text-gold-400 print:text-slate-600">{contact.email}</p>
                    </div>
                  </div>
                </div>
                <EnquiryRouter
                  compact
                  title={enquiryPrompts.companyProfile.title}
                  description={enquiryPrompts.companyProfile.description}
                  className="print-hidden"
                />
              </div>
            </ProfileSection>

            <ProfileSection {...section('attachments')}>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <BulletList items={attachments} />
                <p className="mt-6 text-sm leading-relaxed text-slate-300">
                  {attachmentsNote}
                </p>
              </div>
            </ProfileSection>

            <AnimatedSection className="pt-10">
              <div className="grid grid-cols-1 gap-8 border-t border-white/10 pt-12 lg:grid-cols-[0.8fr_1.2fr]">
                <div>
                  <div className="gold-line mb-6" />
                  <h2 className="mb-4 font-tight text-3xl font-black leading-tight text-white">
                    {profileFaqCopy.title}
                  </h2>
                  <p className="text-sm leading-relaxed text-slate-300">
                    {profileFaqCopy.body}
                  </p>
                </div>
                <FaqList faqs={groupFaqs} />
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      <ProfileDocuments />
    </>
  );
}
