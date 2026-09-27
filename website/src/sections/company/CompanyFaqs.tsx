import { companyPageCopy, type Company } from '@/content/companies';
import { Container, FaqList, Heading, Section } from '@/ui';
import { companySectionIds } from './CompanySubNav';

/**
 * The company's questions as disclosure rows (<details>, no JS), on the
 * alternate grey between the black strengths tile and the white enquiry
 * section, in the same two columns as the form below. The questions are
 * h3s under the section's h2, and the FAQPage JSON-LD on the page lists
 * exactly these questions.
 */
export function CompanyFaqs({ company }: { company: Company }) {
  return (
    <Section tone="alt" id={companySectionIds.faq} labelledBy="faq-title">
      <Container className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <Heading as="h2" id="faq-title" size="h1">
          {companyPageCopy.faqHeading}
        </Heading>
        <FaqList faqs={company.faqs} headingLevel={3} />
      </Container>
    </Section>
  );
}
