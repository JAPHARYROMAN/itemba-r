import { getCompanyBySlug, type Company } from '@/content/companies';
import { locationsPage, type LocationProfile } from '@/content/locations';
import { companyUrl, locationUrl } from '@/content/site';
import { Card, ChevronLink, Container, Eyebrow, Heading, Icon, Section, SmartLink, keepCompounds } from '@/ui';
import { DirectionsLink } from './DirectionsLink';

/**
 * The one location, as Apple lists a store: its name and why it matters on
 * the left, and a card with the head office's address and the companies
 * based there on the right; the way on is the location profile, or
 * directions. The index has one location today; the card is the pattern
 * for more.
 */
export function LocationsHeadquarters({ location }: { location: LocationProfile }) {
  const copy = locationsPage.headquarters;
  const companies = location.companySlugs.map(getCompanyBySlug).filter((company): company is Company => Boolean(company));
  return (
    <Section labelledBy="headquarters-title">
      <Container className="grid items-center gap-10 md:gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <Eyebrow>{copy.eyebrow}</Eyebrow>
          <Heading as="h2" id="headquarters-title" size="h1" className="mt-2">
            {location.title}
          </Heading>
          <p className="mt-5 text-body-lg text-fg-muted md:text-lede">{keepCompounds(location.detail)}</p>
          <div className="mt-7 flex flex-wrap items-center gap-x-8 gap-y-3">
            <ChevronLink href={locationUrl(location.slug)}>{copy.action}</ChevronLink>
            <DirectionsLink />
          </div>
        </div>

        <Card padding="lg" className="lg:max-w-[30rem] lg:justify-self-end">
          <Icon name="map-pin" size="lg" strokeWidth={1.4} className="text-accent" />
          <h3 className="mt-8 text-eyebrow text-fg-muted">{copy.addressLabel}</h3>
          <address className="mt-2 text-body-lg not-italic text-fg md:text-lede">
            {location.addressLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
          <h3 className="mt-8 text-eyebrow text-fg-muted">{copy.companiesLabel}</h3>
          <ul role="list" className="mt-2 border-t border-line">
            {companies.map((company) => (
              <li key={company.slug} data-accent={company.accent} className="border-b border-line">
                <SmartLink
                  href={companyUrl(company.slug)}
                  className="group flex min-h-12 items-center gap-3 py-2.5 text-body text-fg"
                >
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
                  {/* The sector sits under the name on phones and beside it from `sm`. */}
                  <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                    <span className="font-semibold decoration-1 underline-offset-4 group-hover:underline">{company.shortName}</span>
                    <span className="text-caption text-fg-muted sm:text-right">{company.sector}</span>
                  </span>
                </SmartLink>
              </li>
            ))}
          </ul>
        </Card>
      </Container>
    </Section>
  );
}
