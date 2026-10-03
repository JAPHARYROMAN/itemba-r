import { groupFaqs, profileFaqCopy } from '@/content/faqs';
import { Container, FaqList, Heading, Lede, Section } from '@/ui';

/**
 * The group questions after the report, as disclosure rows (<details>, no
 * JS), on white before the grey footer, in the report's two columns. The
 * questions are h3s under the h2, and the page's FAQPage JSON-LD lists
 * exactly these questions.
 */
export function ProfileFaqs() {
  return (
    <Section id="faq" labelledBy="faq-title">
      <Container className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div>
          <Heading as="h2" id="faq-title" size="h1">
            {profileFaqCopy.title}
          </Heading>
          <Lede tone="muted" className="mt-5">
            {profileFaqCopy.body}
          </Lede>
        </div>
        <FaqList faqs={groupFaqs} headingLevel={3} />
      </Container>
    </Section>
  );
}
