import { companyPageCopy, type Company } from '@/content/companies';
import { Container, FactList, Heading, Section, type Fact } from '@/ui';

/**
 * "At a glance": the facts a bank or partner looks for first, as a quiet
 * grid straight under the hero (the hero supplies the space above it). The
 * registered name is the legal form used on documents; TINs, incorporation
 * numbers and directors stay on /company-profile and in the PDFs
 * (flags.publishLegalIdentifiers).
 */
export function CompanyGlance({ company }: { company: Company }) {
  const { glance, sectorLabel, facts } = companyPageCopy;
  const items: Fact[] = [
    { key: 'name', term: glance.registeredName, detail: company.legalName },
    { key: 'sector', term: sectorLabel, detail: company.sector },
    { key: 'incorporated', term: glance.incorporated, detail: company.legal.incorporationDate },
    ...facts.map((fact) => ({ key: fact.label, term: fact.label, detail: fact.value })),
    { key: 'status', term: glance.status, detail: company.legal.status },
  ];
  return (
    <Section space="none" labelledBy="glance-title" className="pb-section-tight">
      <Container>
        <Heading as="h2" id="glance-title" size="h5">
          {glance.title}
        </Heading>
        <FactList layout="grid" items={items} className="mt-6" />
      </Container>
    </Section>
  );
}
