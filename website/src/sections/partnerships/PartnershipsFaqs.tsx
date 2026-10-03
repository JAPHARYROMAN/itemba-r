import { partnershipFaqs } from '@/content/faqs';
import { partnershipsPage } from '@/content/partnerships';
import { Container, FaqList, Heading, Lede, Section } from '@/ui';
import { partnershipsSectionIds as ids } from './ids';

/**
 * "Partnership questions" as disclosure rows (<details>, no JS) on the
 * alternate grey, in the same two columns as the form below. The questions
 * are h3s under the section's h2, and the page's FAQPage JSON-LD lists
 * exactly these four.
 */
export function PartnershipsFaqs() {
  const { faq } = partnershipsPage;
  return (
    <Section tone="alt" id={ids.faq} labelledBy="faq-title">
      <Container className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div>
          <Heading as="h2" id="faq-title" size="h1">
            {faq.title}
          </Heading>
          <Lede tone="muted" className="mt-5 max-md:text-body-lg">
            {faq.body}
          </Lede>
        </div>
        <FaqList faqs={partnershipFaqs} headingLevel={3} />
      </Container>
    </Section>
  );
}
