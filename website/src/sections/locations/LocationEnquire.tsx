import { enquiryFormCopy, enquiryPrompts } from '@/content/enquiry';
import { locationPageCopy } from '@/content/locations';
import EnquiryRouter from '@/islands/EnquiryRouter';
import { Container, Eyebrow, Heading, Lede, Section } from '@/ui';
import { EnquireSteps } from './EnquireSteps';
import { locationSectionIds } from './ids';

/**
 * The enquiry form for the location (PAGE-GUIDE §5: compact, general
 * intent), as on a company page: "Ask about this location", the group's
 * routing promise and how an enquiry travels on the left, sticky under the
 * nav from `lg`; the compact form (preferred contact and message) on the
 * right, on the alternate grey. The hero's Enquire pill and the routing
 * cell's link land here. White, so the page's last tile stands apart from
 * the grey footer.
 */
export function LocationEnquire() {
  const { enquire } = locationPageCopy;
  return (
    <Section tone="light" id={locationSectionIds.enquire} labelledBy="enquire-title">
      <Container className="grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div className="lg:sticky lg:top-[calc(var(--nav-height)+2rem)]">
          <Eyebrow>{enquire.eyebrow}</Eyebrow>
          <Heading as="h2" id="enquire-title" size="h1" className="mt-2">
            {enquiryPrompts.location.title}
          </Heading>
          <Lede tone="muted" className="mt-5">
            {enquire.body}
          </Lede>
          <EnquireSteps label={enquire.stepsLabel} steps={enquire.steps} className="mt-10" />
        </div>
        <EnquiryRouter
          compact
          headingLevel={3}
          defaultIntentId="general"
          title={enquiryFormCopy.title}
          description={enquiryPrompts.location.description}
        />
      </Container>
    </Section>
  );
}
