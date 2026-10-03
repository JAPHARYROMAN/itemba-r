import { capabilitiesPage } from '@/content/capabilities';
import { getCompanyBySlug } from '@/content/companies';
import { serviceAreas, serviceIcons, type ServiceArea } from '@/content/services';
import { companyUrl, serviceUrl } from '@/content/site';
import { ChevronLink, Container, Eyebrow, Heading, Icon, Section, SmartLink, keepCompounds } from '@/ui';
import { capabilitiesSectionIds as ids } from './ids';

const { map } = capabilitiesPage;

/** How many audiences a row lists (the first three, as on origin/main). */
const AUDIENCES = 3;

/**
 * One service as a row of the map: its line icon (in the accent of the
 * company that runs it), title and summary with the link to its page; then
 * who runs it and the enquiries it most often gets. The row's id is the
 * service slug, the target of the hero's shortcut. Links stay group gold,
 * as on home; the company shows only in its icon and dot.
 */
function ServiceRow({ service }: { service: ServiceArea }) {
  const company = getCompanyBySlug(service.companySlug);
  return (
    <li
      id={service.slug}
      data-accent={company?.accent}
      className="grid gap-6 border-t border-line py-8 md:grid-cols-12 md:gap-8 md:py-10"
    >
      <div className="md:col-span-7 lg:col-span-6">
        <Icon name={serviceIcons[service.visual]} size="lg" strokeWidth={1.4} className="text-accent" />
        <Heading as="h3" size="h3" className="mt-5">
          {service.title}
        </Heading>
        <p className="mt-3 max-w-xl text-body text-fg-muted">{keepCompounds(service.summary)}</p>
        <ChevronLink href={serviceUrl(service.slug)} tone="gold" context={service.title} className="mt-4">
          {map.action}
        </ChevronLink>
      </div>
      <dl className="grid content-start gap-6 sm:grid-cols-2 md:col-span-5 md:grid-cols-1 md:pt-[3.25rem] lg:col-span-6 lg:grid-cols-2 lg:gap-8">
        <div>
          <dt className="text-caption text-fg-muted">{map.companyLabel}</dt>
          <dd className="mt-2 flex items-center gap-2.5">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
            <SmartLink
              href={companyUrl(service.companySlug)}
              className="text-body-lg font-semibold text-fg decoration-1 underline-offset-4 hover:underline"
            >
              {company?.shortName ?? service.companyName}
            </SmartLink>
          </dd>
        </div>
        <div>
          <dt className="text-caption text-fg-muted">{map.enquiriesLabel}</dt>
          <dd className="mt-2">
            <ul role="list" className="space-y-1">
              {service.audience.slice(0, AUDIENCES).map((audience) => (
                <li key={audience} className="text-body text-fg">
                  {keepCompounds(audience)}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </li>
  );
}

/**
 * "Services, owners, and best-fit enquiries": the six services as
 * hairline rows on white, like a spec table: what each covers, the company
 * responsible for it, and who usually asks. Every row links to its service
 * page and its company.
 */
export function CapabilitiesMap() {
  return (
    <Section id={ids.map} labelledBy="map-title">
      <Container>
        <div className="max-w-[40rem]">
          <Eyebrow>{map.eyebrow}</Eyebrow>
          <Heading as="h2" id="map-title" size="h1" className="mt-2">
            {map.title}
          </Heading>
        </div>
        <ol role="list" className="mt-10 border-b border-line md:mt-14">
          {serviceAreas.map((service) => (
            <ServiceRow key={service.slug} service={service} />
          ))}
        </ol>
      </Container>
    </Section>
  );
}
