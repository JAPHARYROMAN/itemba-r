import { companies, companiesPage } from '@/content/companies';
import { companyUrl } from '@/content/site';
import { LeadPhoto } from '@/sections/company/LeadPhoto';
import { ButtonLink, ChevronLink, Container, Eyebrow, Heading, Section, cn, keepCompounds } from '@/ui';

/** The company directory has its own editorial bands and retains the original jump anchors. */
export function CompaniesTiles() {
  return (
    <>
      {companies.map((company, index) => (
        <div key={company.id} id={company.id}>
          <Section tone={index === 0 ? 'cinema' : index === 1 ? 'light' : 'alt'} accent={company.accent} labelledBy={`tile-${company.slug}`}>
            <Container className="grid items-center gap-10 lg:grid-cols-2 lg:gap-20">
              <div className={cn(index % 2 === 1 && 'lg:order-2')}>
                <div className="flex items-center gap-4">
                  <span aria-hidden="true" className="text-caption tabular-nums text-accent-fg">{String(index + 1).padStart(2, '0')}</span>
                  <Eyebrow dot>{company.name}</Eyebrow>
                </div>
                <Heading as="h2" id={`tile-${company.slug}`} size="h1" className="mt-5">{company.shortName}</Heading>
                <p className="mt-4 text-eyebrow text-accent-fg">{company.sector}</p>
                <p className="mt-6 max-w-xl text-body-lg text-fg-muted">{keepCompounds(company.lede)}</p>
                <ul role="list" className="mt-7 space-y-2 border-t border-line pt-5">
                  {company.offerings.map((offering) => <li key={offering.title} className="text-body text-fg">{offering.title}</li>)}
                </ul>
                <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
                  <ButtonLink href={companyUrl(company.slug)}>{companiesPage.directory.explore}</ButtonLink>
                  <ChevronLink href={`${companyUrl(company.slug)}#enquire`} context={company.shortName}>{companiesPage.directory.enquire}</ChevronLink>
                </div>
              </div>
              <div className="mx-auto w-full max-w-md overflow-hidden rounded-tile lg:max-w-none">
                <LeadPhoto photo={company.heroImage} shape="square" width="split" />
              </div>
            </Container>
          </Section>
        </div>
      ))}
    </>
  );
}