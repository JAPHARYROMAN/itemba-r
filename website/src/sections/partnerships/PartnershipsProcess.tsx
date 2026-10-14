import { companies } from '@/content/companies';
import { partnershipsPage } from '@/content/partnerships';
import { Container, Eyebrow, Heading, Section, TypePanel, keepCompounds } from '@/ui';
import { partnershipsSectionIds as ids } from './ids';

/**
 * "How enquiries move": the page's one cinema tile, set as the company
 * pages set their key strengths. The typographic panel leads (first on
 * phones, on the left from `lg`) with the group's routing promise and the
 * three companies it routes to; beside it the four steps from first
 * message to follow-up, numbered, as hairline rows on black. The capability
 * page's "How enquiries move" link lands here.
 */
export function PartnershipsProcess() {
  const { process } = partnershipsPage;
  return (
    <Section tone="cinema" id={ids.process} labelledBy="process-title">
      <Container className="grid items-center gap-10 md:gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
        <div>
          <Eyebrow>{process.eyebrow}</Eyebrow>
          <Heading as="h2" id="process-title" size="h1" className="mt-3">
            {process.title}
          </Heading>
          <ol role="list" className="mt-8 border-b border-line md:mt-10">
            {process.steps.map((step, index) => (
              <li key={step.title} className="flex gap-5 border-t border-line py-5 md:py-6">
                <span
                  aria-hidden="true"
                  className="w-9 shrink-0 pt-1 text-h3 tabular-nums text-gold-fg"
                >
                  {index + 1}
                </span>
                <div className="pt-1">
                  <h3 className="text-body-lg font-semibold text-fg md:text-lede md:font-semibold">{keepCompounds(step.title)}</h3>
                  <p className="mt-1 text-body text-fg-muted">{keepCompounds(step.body)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <TypePanel
          icon={process.visual.icon}
          statement={process.visual.statement}
          caption={companies.map((company) => company.shortName).join(' · ')}
          className="aspect-[4/3] w-full border border-line lg:aspect-square"
        />
      </Container>
    </Section>
  );
}
