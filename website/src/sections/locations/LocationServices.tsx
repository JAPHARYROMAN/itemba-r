import { getCompanyBySlug } from '@/content/companies';
import { locationServicesCopy, type LocationProfile } from '@/content/locations';
import { serviceAreas, serviceIcons } from '@/content/services';
import { serviceUrl } from '@/content/site';
import type { Tone } from '@/design/tokens';
import { Chevron, Container, Heading, Icon, Lede, Section, SmartLink, keepCompounds } from '@/ui';

/** A stretched title link: the whole card is one target named by the service. */
const stretchedLink =
  'after:absolute after:inset-0 after:rounded-tile focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus';

export type LocationServicesProps = {
  location: LocationProfile;
  titleId: string;
  title: string;
  lede?: string;
  tone?: Tone;
  id?: string;
};

/**
 * The services a location serves, as the home sectors bento sets them: a
 * card per service with its line icon in the accent of the company that
 * runs it, the service, the company, and "Learn more ›" in group gold (one
 * link colour, as on home; the company shows in its icon and dot). Each
 * card is one link. Phones get a compact two-column grid; three across
 * from `md`.
 */
export function LocationServices({ location, titleId, title, lede, tone = 'alt', id }: LocationServicesProps) {
  const services = serviceAreas.filter((service) => location.serviceSlugs.includes(service.slug));
  return (
    <Section tone={tone} id={id} labelledBy={titleId}>
      <Container>
        <div className="max-w-[46rem]">
          <Heading as="h2" id={titleId} size="h1">
            {title}
          </Heading>
          {lede ? (
            <Lede tone="muted" className="mt-5 md:mt-6">
              {lede}
            </Lede>
          ) : null}
        </div>
        <ul role="list" className="mt-10 grid grid-cols-2 gap-3 md:mt-14 md:grid-cols-3 md:gap-4">
          {services.map((service) => {
            const company = getCompanyBySlug(service.companySlug);
            return (
              <li
                key={service.slug}
                data-accent={company?.accent}
                className="group relative flex min-w-0 flex-col rounded-tile bg-surface-alt p-5 transition-shadow duration-base ease-apple hover:shadow-card md:p-8"
              >
                <Icon name={serviceIcons[service.visual]} size="md" strokeWidth={1.4} className="text-accent md:size-8" />
                <Heading as="h3" size="h4" className="mt-4 max-md:text-body max-md:font-semibold md:mt-10">
                  <SmartLink href={serviceUrl(service.slug)} className={stretchedLink}>
                    {keepCompounds(service.title)}
                  </SmartLink>
                </Heading>
                {company ? (
                  <p className="mt-1.5 flex items-center gap-2 text-caption text-fg-muted md:mt-2">
                    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent" />
                    {locationServicesCopy.runBy} {company.shortName}
                  </p>
                ) : null}
                <span aria-hidden="true" className="mt-auto hidden items-center gap-[0.3em] pt-8 text-body text-gold-fg md:inline-flex">
                  {locationServicesCopy.action}
                  <Chevron />
                </span>
              </li>
            );
          })}
        </ul>
      </Container>
    </Section>
  );
}
