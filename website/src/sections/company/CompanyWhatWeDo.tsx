import { companyPageCopy, type Company } from '@/content/companies';
import { serviceUrl } from '@/content/site';
import { ChevronLink, Container, Eyebrow, Heading, Icon, Section, Stat, keepCompounds } from '@/ui';
import { companySectionIds } from './CompanySubNav';

/** An editorial overview followed by the company's three lines of business. */
export function CompanyWhatWeDo({ company }: { company: Company }) {
  const copy = companyPageCopy;
  return (
    <Section tone="alt" accent={company.accent} id={companySectionIds.whatWeDo} labelledBy="what-we-do-title">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-20">
          <div>
            <Eyebrow dot>{company.sector}</Eyebrow>
            <Heading as="h2" id="what-we-do-title" size="h1" className="mt-4">{copy.servicesHeading}</Heading>
            <p className="mt-6 max-w-2xl text-lede text-fg-muted">{keepCompounds(company.overview.lead)}</p>
          </div>
          <div className="border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
            <Eyebrow>{copy.keyFigure}</Eyebrow>
            <dl className="mt-5">
              <Stat value={company.keyStat.value} label={company.keyStat.label} note={company.keyStat.note} size="display" tone="accent" />
            </dl>
            <h3 className="mt-8 text-eyebrow text-fg-muted">{company.overview.label}</h3>
            <ul role="list" className="mt-3 space-y-2">
              {company.overview.points.map((point) => <li key={point} className="text-body text-fg">{keepCompounds(point)}</li>)}
            </ul>
          </div>
        </div>
        <div className="mt-12 divide-y divide-line border-y border-line md:mt-16">
          {company.offerings.map((offering, index) => (
            <article key={offering.title} className="grid gap-5 py-7 md:grid-cols-[3rem_minmax(0,1fr)_minmax(0,1.3fr)] md:gap-8 md:py-9">
              <span aria-hidden="true" className="text-caption tabular-nums text-accent-fg">{String(index + 1).padStart(2, '0')}</span>
              <div className="flex items-start gap-4">
                <Icon name={offering.icon} size="md" className="mt-1 shrink-0 text-accent" />
                <Heading as="h3" size="h3">{offering.title}</Heading>
              </div>
              <div>
                <p className="max-w-xl text-body-lg text-fg-muted">{keepCompounds(offering.body)}</p>
                {offering.serviceSlug ? <ChevronLink href={serviceUrl(offering.serviceSlug)} context={offering.title} className="mt-4">{copy.offeringAction}</ChevronLink> : null}
              </div>
            </article>
          ))}
        </div>
      </Container>
    </Section>
  );
}