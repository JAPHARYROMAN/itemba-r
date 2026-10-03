import { aboutPage, type Pillar } from '@/content/about';
import { companies, getCompanyBySlug } from '@/content/companies';
import { serviceAreas, serviceIcons } from '@/content/services';
import { serviceUrl } from '@/content/site';
import {
  Bento,
  BentoCell,
  Container,
  Eyebrow,
  Heading,
  Icon,
  Lede,
  Section,
  SmartLink,
  Stat,
  keepCompounds,
  type BentoSpan,
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

/** The three companies as their accent dots: three independent revenue streams. */
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

/**
 * The bento's shape on the six-column grid (lg):
 *   risk reduction, with the six sectors (2/3) · the sectors figure (1/3)
 *   revenue · reach · scalability (1/3 each)
 * The cells sit on the alternate grey inside the white tile.
 */
const spans: readonly BentoSpan[] = ['two-thirds', 'third', 'third', 'third'];

/** "Why diversification?": four reasons as a bento, the first beside the six-sector figure. */
export function AboutApproach() {
  const { approach } = aboutPage;
  const [lead, ...rest] = approach.pillars;
  return (
    <Section labelledBy="approach-title">
      <Container>
        <div className="mx-auto max-w-prose text-center">
          <Eyebrow>{approach.eyebrow}</Eyebrow>
          <Heading as="h2" id="approach-title" size="h1" className="mt-2">
            {approach.title}
          </Heading>
          <Lede tone="muted" className="mx-auto mt-5 max-w-[40rem] md:mt-6">
            {approach.lede}
          </Lede>
        </div>

        <Bento className="mt-10 md:mt-16">
          <BentoCell span={spans[0] ?? 'two-thirds'} padding="lg">
            <Heading as="h3" size="h3">
              {lead.title}
            </Heading>
            <p className="mt-3 max-w-[34rem] text-body-lg text-fg-muted">{keepCompounds(lead.summary)}</p>
            <div className="mt-8 md:mt-10">
              <SectorRow />
            </div>
          </BentoCell>

          <BentoCell span="third" padding="lg" className="justify-center">
            <dl>
              <Stat value={approach.figure.value} label={approach.figure.label} note={approach.figure.note} size="display-xl" />
            </dl>
          </BentoCell>

          {rest.map((pillar, index) => (
            <BentoCell key={pillar.title} span={spans[index + 1] ?? 'third'}>
              <PillarVisual visual={pillar.visual} />
              <Heading as="h3" size="h4" className="mt-8">
                {pillar.title}
              </Heading>
              <p className="mt-2 text-body text-fg-muted">{keepCompounds(pillar.summary)}</p>
            </BentoCell>
          ))}
        </Bento>
      </Container>
    </Section>
  );
}
