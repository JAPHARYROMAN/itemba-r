import { companyPageCopy, isPhoto, type Company } from '@/content/companies';
import { CheckList, Container, Eyebrow, Heading, Reveal, Section, TypePanel } from '@/ui';
import { companySectionIds } from './CompanySubNav';
import { LeadPhoto } from './LeadPhoto';

/** The strengths a page lists: every highlight except the one the key figure already states. */
export function pageStrengths(company: Company): readonly string[] {
  return company.highlights.filter((highlight) => highlight !== company.keyStat.restates);
}

/**
 * "Key strengths": the page's one cinema tile, beside a heading and the
 * strengths as large lines on black, each marked with a check in the
 * company accent. Its visual (company.strengthsVisual) leads on every
 * screen (first on phones, on the left from `lg`, opposite the hero's
 * photograph):
 * - a photograph the page shows nowhere else, and not the company's home
 *   tile (one click away), square in a 440px column (about the height of
 *   the list beside it); or,
 * - where no such photograph is strong enough, a typographic panel (a line
 *   icon and one strong sentence) on the raised black.
 * The highlight the "What we do" figure already states is left out rather
 * than said twice.
 */
export function CompanyStrengths({ company }: { company: Company }) {
  const visual = company.strengthsVisual;
  return (
    <Section tone="cinema" accent={company.accent} id={companySectionIds.strengths} labelledBy="strengths-title">
      <Container className="grid items-center gap-10 md:gap-12 lg:grid-cols-[minmax(0,27.5rem)_minmax(0,1fr)] lg:gap-16">
        <div>
          <Eyebrow dot>{company.shortName}</Eyebrow>
          <Heading as="h2" id="strengths-title" size="h1" className="mt-3">
            {companyPageCopy.strengthsHeading}
          </Heading>
          <CheckList items={pageStrengths(company)} className="mt-8 md:mt-10" />
        </div>
        {isPhoto(visual) ? (
          <Reveal className="order-first mx-auto w-full max-w-md lg:mx-0 lg:max-w-none">
            <LeadPhoto photo={visual} shape="square" width="split" />
          </Reveal>
        ) : (
          <TypePanel
            icon={visual.icon}
            statement={visual.statement}
            caption={visual.caption}
            className="order-first mx-auto aspect-square w-full max-w-md lg:mx-0 lg:max-w-none"
          />
        )}
      </Container>
    </Section>
  );
}
