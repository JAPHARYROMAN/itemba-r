import { contactPage } from '@/content/contactPage';
import EnquiryRouter from '@/islands/EnquiryRouter';
import { EnquireSteps } from '@/sections/locations/EnquireSteps';
import { Container, Eyebrow, Heading, Lede, Section } from '@/ui';
import { contactSectionIds } from './ids';

/**
 * The general enquiry form, high on the page: every Enquire pill on the
 * site lands on /contact (PAGE-GUIDE §5: the full form, general intent,
 * the default title and description). The group's routing promise sits
 * on the left from `lg`, with how an enquiry travels under it; the form
 * takes the wider column, so its fields sit side by side. On phones the
 * form follows the promise straight away and the steps come after it, so
 * the form stays high on the page. The form card is white on the grey
 * tile.
 */
export function ContactEnquire() {
  const { enquire } = contactPage;
  return (
    <Section tone="alt" id={contactSectionIds.enquire} labelledBy="enquire-title">
      <Container className="grid items-start gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:grid-rows-[auto_1fr] lg:gap-x-16 lg:gap-y-0">
        <div className="lg:col-start-1 lg:row-start-1">
          <Eyebrow>{enquire.eyebrow}</Eyebrow>
          <Heading as="h2" id="enquire-title" size="h1" className="mt-2">
            {enquire.title}
          </Heading>
          <Lede tone="muted" className="mt-5">
            {enquire.body}
          </Lede>
        </div>
        <EnquiryRouter headingLevel={3} defaultIntentId="general" className="lg:col-start-2 lg:row-span-2 lg:row-start-1" />
        <EnquireSteps label={enquire.stepsLabel} steps={enquire.steps} className="lg:col-start-1 lg:row-start-2 lg:mt-10" />
      </Container>
    </Section>
  );
}
