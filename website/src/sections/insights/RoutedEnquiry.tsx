import { enquiryFormCopy } from '@/content/enquiry';
import { routedEnquiryCopy } from '@/content/insights';
import EnquiryRouter from '@/islands/EnquiryRouter';
import { Container, Eyebrow, Heading, Lede, Section } from '@/ui';

export type RoutedEnquiryProps = {
  /** The section's h2: the page's own prompt ("Ask about this topic", "Still need help?"). */
  title: string;
  /** The form's description (the page's enquiryPrompts entry). */
  description: string;
};

/**
 * The enquiry section of an insight article and of /faq (id="enquire"), in
 * the company page's pattern: the page's prompt, the group's routing
 * promise and how an enquiry travels (three numbered steps) on the left,
 * sticky under the nav from `lg`; the compact form on the right, starting
 * on General. White with the form card on the alternate grey, so the last
 * tile stands apart from the grey footer below it.
 */
export function RoutedEnquiry({ title, description }: RoutedEnquiryProps) {
  const copy = routedEnquiryCopy;
  return (
    <Section tone="light" id="enquire" labelledBy="enquire-title">
      <Container className="grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div className="lg:sticky lg:top-[calc(var(--nav-height)+2rem)]">
          <Eyebrow>{copy.eyebrow}</Eyebrow>
          <Heading as="h2" id="enquire-title" size="h1" className="mt-3">
            {title}
          </Heading>
          <Lede tone="muted" className="mt-5">
            {copy.body}
          </Lede>
          <h3 className="mt-10 text-eyebrow text-fg-muted">{copy.stepsLabel}</h3>
          <ol role="list" className="mt-4 space-y-5">
            {copy.steps.map((step, index) => (
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
        <EnquiryRouter compact headingLevel={3} defaultIntentId="general" title={enquiryFormCopy.title} description={description} />
      </Container>
    </Section>
  );
}
