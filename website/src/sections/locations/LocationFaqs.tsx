import { locationPageCopy, type LocationProfile } from '@/content/locations';
import { Container, FaqList, Heading, Section } from '@/ui';
import { locationSectionIds } from './ids';

/**
 * The location's questions as disclosure rows (<details>, no JS), in the
 * same two columns as the form below, as on a company page. The questions
 * are h3s under the section's h2; the page's FAQPage JSON-LD lists exactly
 * these questions.
 */
export function LocationFaqs({ location }: { location: LocationProfile }) {
  return (
    <Section tone="alt" id={locationSectionIds.faq} labelledBy="faq-title">
      <Container className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <Heading as="h2" id="faq-title" size="h1">
          {locationPageCopy.faqHeading}
        </Heading>
        <FaqList faqs={location.faqs} headingLevel={3} />
      </Container>
    </Section>
  );
}
