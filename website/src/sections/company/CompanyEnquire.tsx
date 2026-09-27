import { companyPageCopy, type Company } from '@/content/companies';
import { enquiryPrompts, enquiryFormCopy } from '@/content/enquiry';
import EnquiryRouter from '@/islands/EnquiryRouter';
import { Container, Eyebrow, Heading, Lede, Section } from '@/ui';
import { companySectionIds } from './CompanySubNav';

/**
 * The enquiry form, preset to this company: the group's routing promise on
 * the left, the compact form (preferred contact and message) on the right.
 * The SubNav pill and the home tile's "Enquire ›" land here.
 */
export function CompanyEnquire({ company }: { company: Company }) {
  const { enquire } = companyPageCopy;
  return (
    <Section tone="alt" accent={company.accent} id={companySectionIds.enquire} labelledBy="enquire-title">
      <Container className="grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div className="lg:sticky lg:top-[calc(var(--nav-height)+var(--subnav-height)+2.5rem)]">
          <Eyebrow dot>{enquire.eyebrow}</Eyebrow>
          <Heading as="h2" id="enquire-title" size="h1" className="mt-3">
            {company.enquiryLabel}
          </Heading>
          <Lede tone="muted" className="mt-5">
            {enquire.body}
          </Lede>
        </div>
        <EnquiryRouter
          compact
          tone="light"
          headingLevel={3}
          defaultIntentId={company.id}
          title={enquiryFormCopy.title}
          description={enquiryPrompts.company.description}
        />
      </Container>
    </Section>
  );
}
