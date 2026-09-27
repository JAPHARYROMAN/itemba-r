import { partnerChecklist } from '@/content/capabilities';
import { enquiryPrompts } from '@/content/enquiry';
import { partnershipsPage } from '@/content/partnerships';
import EnquiryRouter from '@/islands/EnquiryRouter';
import { CheckList, Container, Eyebrow, Heading, Lede, Section } from '@/ui';
import { partnershipsSectionIds as ids } from './ids';

/**
 * "Ready to talk to Itemba Group?": the full enquiry form (name,
 * organisation, preferred contact and message), for the general route by
 * default; each route card above names the option to choose. On the left,
 * sticky under the nav from `lg`, the routing promise and what to include
 * (the partner checklist the capability page also sets out); on the right
 * the form, on the alternate grey. The section is white, so the page's last
 * tile stands apart from the grey footer. The hero pill and every card's
 * "Enquire ›" land here.
 */
export function PartnershipsEnquire() {
  const { enquire } = partnershipsPage;
  return (
    <Section id={ids.enquire} labelledBy="enquire-title">
      <Container className="grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div className="lg:sticky lg:top-[calc(var(--nav-height)+2rem)]">
          <Eyebrow>{enquire.eyebrow}</Eyebrow>
          <Heading as="h2" id="enquire-title" size="h1" className="mt-3">
            {enquire.title}
          </Heading>
          <Lede tone="muted" className="mt-5">
            {enquire.body}
          </Lede>
          <h3 className="mt-10 text-eyebrow text-fg-muted">{enquire.checklistLabel}</h3>
          <CheckList items={partnerChecklist} size="md" className="mt-3" />
        </div>
        <EnquiryRouter
          headingLevel={3}
          defaultIntentId="general"
          title={enquiryPrompts.partnerships.title}
          description={enquiryPrompts.partnerships.description}
        />
      </Container>
    </Section>
  );
}
