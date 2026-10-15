import { aboutPage, type Pillar } from '@/content/about';
import { companies, getCompanyBySlug } from '@/content/companies';
import { serviceAreas, serviceIcons } from '@/content/services';
import { serviceUrl } from '@/content/site';
import {
  Container,
  Eyebrow,
  Heading,
  Icon,
  Lede,
  Section,
  SmartLink,
  Stat,
  keepCompounds,
} from '@/ui';

/**
 * The lead pillar's visual: the six sectors, each its line icon in the
 * accent of the company that runs it and a link to its service page, so the
 * reason ("six sectors") is also the way in. Two rows of three on phones,
 * one row of six from `sm`.
 */
function SectorRow() {
  return (
    <ul role="list" aria-label={aboutPage.approach.sectorsLabel} className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {serviceAreas.map((service) => {
        const company = getCompanyBySlug(service.companySlug);
        return (
          <li key={service.slug} data-accent={company?.accent}>
            <SmartLink
              href={serviceUrl(service.slug)}
              className="group flex min-h-11 flex-col items-center gap-2 rounded-card px-1 py-3 text-center text-caption text-fg-muted transition-colors duration-fast ease-apple hover:bg-surface hover:text-fg"
            >
              <Icon name={serviceIcons[service.visual]} size="lg" strokeWidth={1.4} className="text-accent" />
              {service.shortTitle}
            </SmartLink>
          </li>
        );
      })}
    </ul>
  );
}

/** The operating companies as their accent dots. */
function CompanyDots() {
  return (
    <p aria-hidden="true" className="flex h-8 items-center gap-2">
      {companies.map((company) => (
        <span key={company.id} data-accent={company.accent} className="inline-block size-3.5 rounded-full bg-accent" />
      ))}
    </p>
  );
}

function PillarVisual({ visual }: { visual: Pillar['visual'] }) {
  if (visual === 'sectors') return null;
  if (visual === 'companies') return <CompanyDots />;
  return <Icon name={visual} size="lg" strokeWidth={1.4} className="text-gold" />;
}

/** The strategy beside its evidence: a large sector figure and four clear reasons. */
export function AboutApproach() {
  const { approach } = aboutPage;
  return (
    <Section labelledBy="approach-title">
      <Container className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16">
        <div>
          <Eyebrow>{approach.eyebrow}</Eyebrow>
          <Heading as="h2" id="approach-title" size="h1" className="mt-2">
            {approach.title}
          </Heading>
          <Lede tone="muted" className="mt-5 md:mt-6">
            {approach.lede}
          </Lede>
          <dl className="mt-8 border-t border-line pt-7 md:mt-10">
            <Stat value={approach.figure.value} label={approach.figure.label} note={approach.figure.note} size="display-xl" />
          </dl>
        </div>
        <div>
          <ol role="list" className="border-b border-line">
            {approach.pillars.map((pillar, index) => (
              <li key={pillar.title} className="grid gap-3 border-t border-line py-6 sm:grid-cols-[3rem_minmax(0,1fr)] sm:gap-5 md:py-8">
                <p aria-hidden="true" className="text-h3 tabular-nums text-gold-fg">{String(index + 1).padStart(2, '0')}</p>
                <div>
                  <div className="flex items-center justify-between gap-4">
                    <Heading as="h3" size="h3">{pillar.title}</Heading>
                    <PillarVisual visual={pillar.visual} />
                  </div>
                  <p className="mt-2 text-body-lg text-fg-muted">{keepCompounds(pillar.summary)}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-7"><SectorRow /></div>
        </div>
      </Container>
    </Section>
  );
}
