import { companyPageCopy, type Company } from '@/content/companies';
import { Container, Eyebrow, FactList, Heading, Icon, Section, keepCompounds } from '@/ui';
import { companySectionIds } from './CompanySubNav';

/** Actual operating brands and sites, separate from the photographic gallery. */
export function CompanySites({ company }: { company: Company }) {
  const copy = companyPageCopy;
  return (
    <Section accent={company.accent} id={companySectionIds.sites} labelledBy="sites-title">
      <Container>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16">
          <div>
            <Eyebrow dot>{company.shortName}</Eyebrow>
            <Heading as="h2" id="sites-title" size="h1" className="mt-4">{copy.sitesHeading}</Heading>
          </div>
          <ul role="list" className="divide-y divide-line border-y border-line">
            {company.sites.map((site) => (
              <li key={site.name} className="flex items-start gap-5 py-7">
                <Icon name={site.icon ?? 'map-pin'} size="md" className="mt-1 shrink-0 text-accent" />
                <div>
                  <Eyebrow>{site.kind}</Eyebrow>
                  <Heading as="h3" size="h3" className="mt-2">{site.name}</Heading>
                  <p className="mt-3 max-w-xl text-body text-fg-muted">{keepCompounds(site.detail)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        {company.branches?.length ? (
          <div className="mt-14 border-t border-line pt-10 md:mt-20 md:pt-12">
            <Heading as="h3" size="h3">{copy.branchesHeading}</Heading>
            <FactList layout="grid" className="mt-6" items={company.branches.map((branch) => ({ key: branch.name, term: branch.name, detail: branch.detail }))} />
          </div>
        ) : null}
      </Container>
    </Section>
  );
}