import { servicePageCopy, type ServiceArea } from '@/content/services';
import { Container, FaqList, Heading, Section } from '@/ui';
import { serviceSectionIds } from './ServiceSubNav';

/**
 * The service's questions as disclosure rows (<details>, no JS), on the
 * alternate grey between the black company tile and the white enquiry
 * section, in the same two columns as the form below. The questions are
 * h3s under the section's h2, and the page's FAQPage JSON-LD lists exactly
 * these questions.
 */
export function ServiceFaqs({ service }: { service: ServiceArea }) {
  return (
    <Section tone="alt" id={serviceSectionIds.faq} labelledBy="faq-title">
      <Container className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <Heading as="h2" id="faq-title" size="h1">
          {servicePageCopy.faqHeading}
        </Heading>
        <FaqList faqs={service.faqs} headingLevel={3} />
      </Container>
    </Section>
  );
}
