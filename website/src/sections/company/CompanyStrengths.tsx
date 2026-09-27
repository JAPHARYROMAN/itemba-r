import { companyPageCopy, type Company } from '@/content/companies';
import { Container, Eyebrow, Heading, Icon, Section, keepCompounds } from '@/ui';
import { companySectionIds } from './CompanySubNav';

/** The strengths a page lists: every highlight except the one the key figure already states. */
export function pageStrengths(company: Company): readonly string[] {
  return company.highlights.filter((highlight) => highlight !== company.keyStat.restates);
}

/**
 * "Key strengths": the page's one cinema tile. A centred heading over one
 * 680px column of large lines on black, each marked with a check in the
 * company accent. The highlight the "What we do" figure already states is
 * left out rather than said twice.
 */
export function CompanyStrengths({ company }: { company: Company }) {
  return (
    <Section tone="cinema" accent={company.accent} id={companySectionIds.strengths} labelledBy="strengths-title">
      <Container size="measure">
        <div className="text-center">
          <Eyebrow dot>{company.shortName}</Eyebrow>
          <Heading as="h2" id="strengths-title" size="h1" className="mt-3">
            {companyPageCopy.strengthsHeading}
          </Heading>
        </div>
        <ul role="list" className="mt-10 border-b border-line md:mt-14">
          {pageStrengths(company).map((highlight) => (
            <li key={highlight} className="flex items-start gap-4 border-t border-line py-5 md:py-6">
              <Icon name="check" size="md" strokeWidth={1.8} className="mt-0.5 text-accent" />
              <span className="text-lede text-fg">{keepCompounds(highlight)}</span>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
