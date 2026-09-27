import { companyPageCopy, type Company } from '@/content/companies';
import { serviceUrl } from '@/content/site';
import { Bento, BentoCell, ChevronLink, Container, Eyebrow, Heading, Icon, Section, Stat } from '@/ui';
import { companySectionIds } from './CompanySubNav';

/**
 * "What we do", as a bento: the company in a paragraph beside its headline
 * figure, then its three lines of business, each linking to the service
 * page that covers it. The cells sit white on the alternate grey tile.
 */
export function CompanyWhatWeDo({ company }: { company: Company }) {
  const copy = companyPageCopy;
  return (
    <Section tone="alt" accent={company.accent} id={companySectionIds.whatWeDo} labelledBy="what-we-do-title">
      <Container>
        <Heading as="h2" id="what-we-do-title" size="h1">
          {copy.servicesHeading}
        </Heading>

        <Bento className="mt-10 md:mt-14">
          <BentoCell span="two-thirds" padding="lg">
            <Eyebrow dot>{company.sector}</Eyebrow>
            <p className="mt-5 text-body-lg text-fg md:text-lede">{company.detail}</p>
          </BentoCell>

          <BentoCell span="third" padding="lg" className="justify-end">
            <dl>
              <Stat value={company.keyStat.value} label={company.keyStat.label} note={company.keyStat.note} tone="accent" />
            </dl>
          </BentoCell>

          {company.offerings.map((offering) => (
            <BentoCell key={offering.title} span="third">
              <Icon name={offering.icon} size="lg" strokeWidth={1.4} className="text-accent" />
              <Heading as="h3" size="h4" className="mt-8">
                {offering.title}
              </Heading>
              <p className="mt-2 text-body text-fg-muted">{offering.body}</p>
              {offering.serviceSlug ? (
                <ChevronLink href={serviceUrl(offering.serviceSlug)} context={offering.title} className="mt-auto pt-6">
                  {copy.offeringAction}
                </ChevronLink>
              ) : null}
            </BentoCell>
          ))}
        </Bento>
      </Container>
    </Section>
  );
}
