import { companyPageCopy, type Company, type CompanySite } from '@/content/companies';
import { Card, Container, Eyebrow, FactList, Heading, Icon, Media, Reveal, Section, cn } from '@/ui';
import { companySectionIds } from './CompanySubNav';

/**
 * A site card: its photograph, what it is, its name and where it is. A
 * site without a photograph is typographic: among photo cards it gets a
 * quiet icon panel the size of a photograph, so the row lines up; when no
 * site has a photograph, the cards are compact, the icon above the text.
 */
function SiteCard({ site, sizes, panel }: { site: CompanySite; sizes: string; panel: boolean }) {
  const icon = site.icon ?? 'map-pin';
  return (
    <Card as="li" padding="none" className="flex flex-col overflow-hidden">
      {site.image ? (
        <Reveal>
          <Media media={site.image} alt={site.image.alt} sizes={sizes} aspect="4/3" />
        </Reveal>
      ) : panel ? (
        <div className="flex aspect-[3/1] items-center justify-center border-b border-line sm:aspect-[4/3]">
          <Icon name={icon} size="xl" strokeWidth={1.2} className="text-accent" />
        </div>
      ) : null}
      <div className="flex flex-1 flex-col p-6 md:p-7">
        {!site.image && !panel ? <Icon name={icon} size="lg" strokeWidth={1.4} className="mb-8 text-accent" /> : null}
        <Eyebrow>{site.kind}</Eyebrow>
        <Heading as="h3" size="h4" className="mt-1.5">
          {site.name}
        </Heading>
        <p className="mt-2 text-body text-fg-muted">{site.detail}</p>
      </div>
    </Card>
  );
}

/**
 * "Brands and sites": the trading brands, stations, branches and yards the
 * company runs. Four sites sit two by two from `sm` (large enough for the
 * photographs and the ALL-CAPS brand names); three sit three across from
 * `md`. A branch list follows where the company has one.
 */
export function CompanySites({ company }: { company: Company }) {
  const copy = companyPageCopy;
  const four = company.sites.length >= 4;
  const withPhotos = company.sites.some((site) => site.image);
  const sizes = four
    ? '(min-width: 1112px) 524px, (min-width: 640px) calc(50vw - 32px), calc(100vw - 44px)'
    : '(min-width: 1112px) 346px, (min-width: 768px) calc(33vw - 28px), calc(100vw - 44px)';
  return (
    <Section accent={company.accent} id={companySectionIds.sites} labelledBy="sites-title">
      <Container>
        <Heading as="h2" id="sites-title" size="h1">
          {copy.sitesHeading}
        </Heading>
        <ul
          role="list"
          className={cn('mt-10 grid grid-cols-1 gap-4 md:mt-14 md:gap-5', four ? 'sm:grid-cols-2' : 'md:grid-cols-3')}
        >
          {company.sites.map((site) => (
            <SiteCard key={site.name} site={site} sizes={sizes} panel={withPhotos} />
          ))}
        </ul>

        {company.branches?.length ? (
          <div className="mt-14 md:mt-20">
            <Heading as="h3" size="h3">
              {copy.branchesHeading}
            </Heading>
            <FactList
              className="mt-6"
              items={company.branches.map((branch) => ({ key: branch.name, term: branch.name, detail: branch.detail }))}
            />
          </div>
        ) : null}
      </Container>
    </Section>
  );
}
