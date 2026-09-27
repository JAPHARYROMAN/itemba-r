import type { Company } from '@/content/companies';
import { enquiryFormCopy, enquiryPrompts } from '@/content/enquiry';
import { servicePageCopy, type ServiceArea } from '@/content/services';
import EnquiryRouter from '@/islands/EnquiryRouter';
import { Container, Eyebrow, Heading, Lede, Section } from '@/ui';
import { serviceSectionIds } from './ServiceSubNav';

/**
 * The enquiry form, preset to the company that runs the service
 * (service.intentId): "Start a service enquiry", the group's routing
 * promise and how an enquiry travels on the left (sticky under the nav and
 * the sub-nav from `lg`), the compact form on the right. The sub-nav and
 * hero Enquire pills land here. White, with the form card on the
 * alternate grey, so the page's last tile stands apart from the footer.
 */
export function ServiceEnquire({ service, company }: { service: ServiceArea; company: Company }) {
  const { enquire } = servicePageCopy;
  return (
    <Section tone="light" accent={company.accent} id={serviceSectionIds.enquire} labelledBy="enquire-title">
      <Container className="grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div className="lg:sticky lg:top-[calc(var(--nav-height)+var(--subnav-height)+2rem)]">
          <Eyebrow dot>{enquire.eyebrow}</Eyebrow>
          <Heading as="h2" id="enquire-title" size="h1" className="mt-3">
            {enquiryPrompts.service.title}
          </Heading>
          <Lede tone="muted" className="mt-5">
            {enquire.body}
          </Lede>
          <h3 className="mt-10 text-eyebrow text-fg-muted">{enquire.stepsLabel}</h3>
          <ol role="list" className="mt-4 space-y-5">
            {enquire.steps.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line-strong text-caption font-semibold tabular-nums text-fg"
                >
                  {index + 1}
                </span>
                <p className="pt-1 text-body text-fg-muted">
                  <span className="font-semibold text-fg">{step.title}.</span> {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
        <EnquiryRouter
          compact
          headingLevel={3}
          defaultIntentId={service.intentId}
          title={enquiryFormCopy.title}
          description={enquiryPrompts.service.description}
        />
      </Container>
    </Section>
  );
}
