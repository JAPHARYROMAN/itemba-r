import { companyPageCopy, type Company } from '@/content/companies';
import { Container, Eyebrow, Heading, Icon, Section } from '@/ui';
import { companySectionIds } from './CompanySubNav';

/**
 * "Key strengths": the page's one cinema tile. The strengths read as
 * large lines on black, each marked with a check in the company accent.
 */
export function CompanyStrengths({ company }: { company: Company }) {
  return (
    <Section tone="cinema" accent={company.accent} id={companySectionIds.strengths} labelledBy="strengths-title">
      <Container className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div>
          <Eyebrow dot>{company.shortName}</Eyebrow>
          <Heading as="h2" id="strengths-title" size="h1" className="mt-3">
            {companyPageCopy.strengthsHeading}
          </Heading>
        </div>
        <ul role="list" className="border-b border-line">
          {company.highlights.map((highlight) => (
            <li key={highlight} className="flex items-start gap-4 border-t border-line py-5 md:py-6">
              <Icon name="check" size="md" strokeWidth={1.8} className="mt-0.5 text-accent" />
              <span className="text-lede text-fg">{highlight}</span>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
