import { companies } from '@/content/companies';
import { contactPage } from '@/content/contactPage';
import { CompanyCards } from '@/sections/locations/CompanyCards';
import { Container, Heading, Lede, Section } from '@/ui';
import { contactSectionIds } from './ids';

/**
 * "Our companies": the three companies, each a link to its page (the
 * legacy page listed them as cards that looked clickable but were not).
 * The one group office routes every enquiry, so there is no per-company
 * contact line here; the form above reaches each of them.
 */
export function ContactCompanies() {
  const copy = contactPage.companies;
  return (
    <Section tone="alt" id={contactSectionIds.companies} labelledBy="companies-title">
      <Container>
        <div className="max-w-[46rem]">
          <Heading as="h2" id="companies-title" size="h1">
            {copy.heading}
          </Heading>
          <Lede tone="muted" className="mt-5 md:mt-6">
            {copy.lede}
          </Lede>
        </div>
        <CompanyCards companies={companies} action={copy.action} className="mt-10 md:mt-14" />
      </Container>
    </Section>
  );
}
