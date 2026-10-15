import { companyPageCopy, type Company } from '@/content/companies';
import { flags } from '@/content/flags';
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
    { key: 'name', term: flags.publishLegalIdentifiers ? glance.registeredName : glance.companyName, detail: company.name },
    { key: 'sector', term: sectorLabel, detail: company.sector },
    ...(flags.publishLegalIdentifiers ? [{ key: 'incorporated', term: glance.incorporated, detail: company.legal.incorporationDate }] : []),
    ...facts.map((fact) => ({ key: fact.label, term: fact.label, detail: fact.value })),
    ...(flags.publishLegalIdentifiers ? [{ key: 'status', term: glance.status, detail: company.legal.status }] : []),
  ];
  return (
    <Section space="tight" labelledBy="glance-title" className="border-y border-line">
      <Container>
        <Heading as="h2" id="glance-title" size="h5">
          {glance.title}
        </Heading>
        <FactList layout="grid" items={items} className="mt-6" />
      </Container>
    </Section>
  );
}
