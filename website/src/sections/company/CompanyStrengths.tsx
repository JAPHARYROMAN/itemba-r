import { companyPageCopy, type Company } from '@/content/companies';
import { Container, Eyebrow, Heading, Icon, Reveal, Section, keepCompounds } from '@/ui';
import { companySectionIds } from './CompanySubNav';
import { LeadPhoto } from './LeadPhoto';

/** The strengths a page lists: every highlight except the one the key figure already states. */
export function pageStrengths(company: Company): readonly string[] {
  return company.highlights.filter((highlight) => highlight !== company.keyStat.restates);
}

/**
 * "Key strengths": the page's one cinema tile, and it carries a
 * photograph, as the plan's cinema tiles do: a photograph the page shows
 * nowhere else (company.strengthsImage) in a 440px column, beside a
 * heading and the strengths as large lines on black, each marked with a
 * check in the company accent. The photograph leads on every screen (first
 * on phones, on the left from `lg`, opposite the hero's photograph). The
 * highlight the "What we do" figure already states is left out rather
 * than said twice.
 */
export function CompanyStrengths({ company }: { company: Company }) {
  const photo = company.strengthsImage;
  return (
    <Section tone="cinema" accent={company.accent} id={companySectionIds.strengths} labelledBy="strengths-title">
      <Container className="grid items-center gap-10 md:gap-12 lg:grid-cols-[minmax(0,27.5rem)_minmax(0,1fr)] lg:gap-16">
        <div>
          <Eyebrow dot>{company.shortName}</Eyebrow>
          <Heading as="h2" id="strengths-title" size="h1" className="mt-3">
            {companyPageCopy.strengthsHeading}
          </Heading>
          <ul role="list" className="mt-8 border-b border-line md:mt-10">
            {pageStrengths(company).map((highlight) => (
              <li key={highlight} className="flex items-start gap-4 border-t border-line py-4 md:py-5">
                <Icon name="check" size="md" strokeWidth={1.8} className="mt-0.5 text-accent" />
                <span className="text-body-lg text-fg md:text-lede">{keepCompounds(highlight)}</span>
              </li>
            ))}
          </ul>
        </div>
        <Reveal className="order-first mx-auto w-full max-w-md lg:mx-0 lg:max-w-none">
          <LeadPhoto photo={photo} shape="portrait" width="split" />
        </Reveal>
      </Container>
    </Section>
  );
}
