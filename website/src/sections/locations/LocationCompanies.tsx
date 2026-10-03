import { getCompanyBySlug, type Company } from '@/content/companies';
import { locationPageCopy, type LocationProfile } from '@/content/locations';
import { Container, Heading, Lede, Section } from '@/ui';
import { CompanyCards } from './CompanyCards';
import { locationSectionIds } from './ids';

/** The three companies behind the location's services, each a link to its page. */
export function LocationCompanies({ location }: { location: LocationProfile }) {
  const copy = locationPageCopy;
  const companies = location.companySlugs.map(getCompanyBySlug).filter((company): company is Company => Boolean(company));
  return (
    <Section id={locationSectionIds.companies} labelledBy="companies-title">
      <Container>
        <div className="max-w-[46rem]">
          <Heading as="h2" id="companies-title" size="h1">
            {copy.companiesHeading}
          </Heading>
          <Lede tone="muted" className="mt-5 md:mt-6">
            {copy.companiesLede}
          </Lede>
        </div>
        <CompanyCards companies={companies} action={copy.companiesAction} className="mt-10 md:mt-14" />
      </Container>
    </Section>
  );
}
