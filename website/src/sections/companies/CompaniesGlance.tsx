import type { ReactNode } from 'react';
import { companies, companyPageCopy, type Company } from '@/content/companies';
import { homeSectors, homeTileActions } from '@/content/home';
import { companyUrl } from '@/content/site';
import { ButtonLink, Card, ChevronLink, Container, Heading, Section, keepCompounds } from '@/ui';

/** One compared fact: a small label over its value, a hairline above. */
function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <dl className="border-t border-line py-4">
      <dt className="text-caption text-fg-muted">{term}</dt>
      <dd className="mt-1 text-body text-fg">{children}</dd>
    </dl>
  );
}

function CompanyColumn({ company }: { company: Company }) {
  const copy = companyPageCopy;
  return (
    <Card
      as="li"
      tone="alt"
      accent={company.accent}
      padding="none"
      className="flex flex-col px-6 pb-6 pt-7 md:row-span-6 md:grid md:grid-rows-subgrid md:gap-y-0 md:px-7 md:pb-7"
    >
      <div className="pb-5">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full bg-accent" />
          <Heading as="h3" size="h4">
            {company.shortName}
          </Heading>
        </div>
        <p className="mt-1 text-caption text-fg-muted">{company.legalName}</p>
      </div>
      <Row term={copy.sectorLabel}>{company.sector}</Row>
      <Row term={copy.glance.incorporated}>{company.legal.incorporationDate}</Row>
      <Row term={copy.sitesHeading}>
        <ul role="list" className="space-y-0.5">
          {company.sites.map((site) => (
            <li key={site.name}>{keepCompounds(site.name)}</li>
          ))}
        </ul>
      </Row>
      <dl className="border-t border-line py-4">
        <dt className="text-caption text-fg-muted">{copy.keyFigure}</dt>
        <dd className="mt-1 text-h2 tabular-nums text-accent-fg">{company.keyStat.value}</dd>
        <dd className="text-body text-fg">{company.keyStat.label}</dd>
      </dl>
      <div className="border-t border-line pt-5 md:self-end">
        <ChevronLink href={companyUrl(company.slug)} context={company.shortName}>
          {homeTileActions.explore}
        </ChevronLink>
      </div>
    </Card>
  );
}

/**
 * "At a glance": the three companies side by side, as on Apple's compare
 * pages, for the banks and partners who read across rather than down: the
 * registered name, sector, incorporation date, brands and sites, and each
 * company's headline figure, in each company's accent. From `md` the three
 * columns share their rows (CSS subgrid), so each fact lines up across the
 * companies; phones stack the cards. Then the group's routing promise, for
 * a reader who is still unsure which company they need.
 */
export function CompaniesGlance() {
  const { routing } = homeSectors;
  return (
    <Section labelledBy="glance-title">
      <Container>
        <Heading as="h2" id="glance-title" size="h1">
          {companyPageCopy.glance.title}
        </Heading>
        <ul role="list" className="mt-10 grid gap-4 md:mt-14 md:grid-cols-3 md:gap-x-5">
          {companies.map((company) => (
            <CompanyColumn key={company.id} company={company} />
          ))}
        </ul>

        <div className="mt-14 flex flex-col items-start gap-6 border-t border-line pt-10 md:mt-20 md:flex-row md:items-center md:justify-between md:gap-10 md:pt-12">
          <div className="max-w-xl">
            <Heading as="h3" size="h3">
              {routing.title}
            </Heading>
            <p className="mt-2 text-body-lg text-fg-muted">{routing.body}</p>
          </div>
          <ButtonLink href={routing.link.href} size="lg" className="shrink-0">
            {routing.link.label}
          </ButtonLink>
        </div>
      </Container>
    </Section>
  );
}
