import { companyPageCopy, type Company } from '@/content/companies';
import { serviceUrl } from '@/content/site';
import { Bento, BentoCell, ChevronLink, Container, Eyebrow, Heading, Icon, Section, Stat, keepCompounds } from '@/ui';
import { companySectionIds } from './CompanySubNav';

/**
 * "What we do", as a bento: the company in one sentence, then a short list
 * (its sites, or the markets it serves) under a small label, beside its
 * headline figure; then its three lines of business, each linking to the
 * service page that covers it. The figure cell carries its eyebrow at the
 * top and the display-xl numeral centred in the space below it, so a tall
 * row (the neighbouring list sets its height) never leaves a band of empty
 * card between the two. The cells sit white on the alternate grey tile.
 */
export function CompanyWhatWeDo({ company }: { company: Company }) {
  const copy = companyPageCopy;
  const { overview } = company;
  return (
    <Section tone="alt" accent={company.accent} id={companySectionIds.whatWeDo} labelledBy="what-we-do-title">
      <Container>
        <Heading as="h2" id="what-we-do-title" size="h1">
          {copy.servicesHeading}
        </Heading>

        <Bento className="mt-10 md:mt-14">
          <BentoCell span="two-thirds" padding="lg">
            <Eyebrow dot>{company.sector}</Eyebrow>
            <p className="mt-5 text-body-lg text-fg md:text-lede">{keepCompounds(overview.lead)}</p>
            <h3 className="mt-8 text-eyebrow text-fg-muted">{overview.label}</h3>
            <ul role="list" className="mt-2 border-t border-line">
              {overview.points.map((point) => (
                <li key={point} className="border-b border-line py-3 text-body text-fg">
                  {keepCompounds(point)}
                </li>
              ))}
            </ul>
          </BentoCell>

          <BentoCell span="third" padding="lg">
            <Eyebrow>{copy.keyFigure}</Eyebrow>
            <dl className="my-auto pt-8">
              <Stat
                value={company.keyStat.value}
                label={company.keyStat.label}
                note={company.keyStat.note}
                size="display-xl"
                tone="accent"
              />
            </dl>
          </BentoCell>

          {company.offerings.map((offering) => (
            <BentoCell key={offering.title} span="third">
              <Icon name={offering.icon} size="lg" strokeWidth={1.4} className="text-accent" />
              <Heading as="h3" size="h4" className="mt-8">
                {offering.title}
              </Heading>
              <p className="mt-2 text-body text-fg-muted">{keepCompounds(offering.body)}</p>
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
