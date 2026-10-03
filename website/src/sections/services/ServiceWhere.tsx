import type { Company, CompanySite } from '@/content/companies';
import { locationProfiles, type LocationProfile } from '@/content/locations';
import type { MediaImage } from '@/content/media';
import { servicePageCopy, type ServiceArea, type ServiceRouteStop } from '@/content/services';
import { locationUrl } from '@/content/site';
import { Card, ChevronLink, Container, Eyebrow, Heading, Icon, Lede, Media, Reveal, Section, cn, keepCompounds } from '@/ui';
import { serviceSectionIds } from './ServiceSubNav';

type Layout = { grid: string; sizes: string };

/**
 * How the site cards sit: two or four two by two from `sm` (large enough
 * for the photographs and the ALL-CAPS brand names), three across from `md`.
 */
function gridFor(count: number): Layout {
  if (count === 3) {
    return {
      grid: 'md:grid-cols-3',
      sizes: '(min-width: 1112px) 346px, (min-width: 768px) calc(33vw - 28px), calc(100vw - 44px)',
    };
  }
  return {
    grid: 'sm:grid-cols-2',
    sizes: '(min-width: 1112px) 524px, (min-width: 640px) calc(50vw - 32px), calc(100vw - 44px)',
  };
}

/** What a site is, its name and where it is. */
function SiteText({ site }: { site: CompanySite }) {
  return (
    <>
      <Eyebrow>{site.kind}</Eyebrow>
      <Heading as="h3" size="h4" className="mt-1.5">
        {site.name}
      </Heading>
      <p className="mt-2 text-body text-fg-muted">{keepCompounds(site.detail)}</p>
    </>
  );
}

/**
 * A site card, as on the company pages: its photograph (3:2), what it is,
 * its name and where it is. Among photo cards a site without one gets a
 * panel the size of a photograph that sets its figure large ("3 planned"),
 * or its icon; when no site has a photograph the cards are compact, the
 * icon above the text.
 */
function SiteCard({ site, sizes, panel }: { site: CompanySite; sizes: string; panel: boolean }) {
  const icon = site.icon ?? 'map-pin';
  return (
    <Card as="li" padding="none" className="flex flex-col overflow-hidden">
      {site.image ? (
        <Reveal>
          <Media media={site.image} alt={site.image.alt} sizes={sizes} aspect="3/2" />
        </Reveal>
      ) : panel ? (
        <div className="flex aspect-[3/1] flex-col items-center justify-center border-b border-line px-6 text-center sm:aspect-[3/2]">
          {site.figure ? (
            // Decorative: the card's heading and text below say the same in words.
            <p aria-hidden="true" className="flex flex-col items-center">
              <span className="text-display-xl tabular-nums text-accent-fg">{site.figure.value}</span>
              <span className="mt-1 text-body-lg text-fg-muted">{site.figure.label}</span>
            </p>
          ) : (
            <Icon name={icon} size="xl" strokeWidth={1.2} className="text-accent" />
          )}
        </div>
      ) : null}
      <div className="flex flex-1 flex-col p-6 md:p-7">
        {!site.image && !panel ? <Icon name={icon} size="lg" strokeWidth={1.4} className="mb-8 text-accent" /> : null}
        <SiteText site={site} />
      </div>
    </Card>
  );
}

/**
 * A service delivered from one site with a photograph (UZUNGUNI INN): one
 * wide card, the photograph beside the text from `md`, above it on phones.
 */
function SingleSite({ site, image }: { site: CompanySite; image: MediaImage }) {
  return (
    <Card as="div" padding="none" className="mt-10 grid overflow-hidden md:mt-14 md:grid-cols-2">
      <Reveal className="relative aspect-[4/3]">
        <Media
          media={image}
          alt={image.alt}
          fill
          sizes="(min-width: 1112px) 534px, (min-width: 768px) calc(50vw - 22px), calc(100vw - 44px)"
        />
      </Reveal>
      <div className="flex flex-col justify-center p-7 md:p-10 lg:p-12">
        <SiteText site={site} />
      </div>
    </Card>
  );
}

/**
 * The group base as a card of its own, beside a service's one typographic
 * site (Itemba Estate), so the site does not stand alone; it links to the
 * location profile.
 */
function LocationCard({ location }: { location: LocationProfile }) {
  const { locationCard } = servicePageCopy;
  return (
    <Card as="li" padding="none" className="flex flex-col">
      <div className="flex flex-1 flex-col p-6 md:p-7">
        <Icon name="map-pin" size="lg" strokeWidth={1.4} className="mb-8 text-accent" />
        <Eyebrow>{locationCard.kind}</Eyebrow>
        <Heading as="h3" size="h4" className="mt-1.5">
          {location.shortTitle}
        </Heading>
        <p className="mt-2 text-body text-fg-muted">{keepCompounds(locationCard.detail)}</p>
        <ChevronLink href={locationUrl(location.slug)} context={location.shortTitle} className="mt-auto pt-6">
          {locationCard.action}
        </ChevronLink>
      </div>
    </Card>
  );
}

/**
 * A route as numbered stops on a hairline: across the content width from
 * `md`, down the left edge on phones. Each dot is the company accent; the
 * list is ordered, so a screen reader hears the stops in order.
 */
function RouteStops({ stops }: { stops: readonly ServiceRouteStop[] }) {
  return (
    <ol role="list" className="mt-10 grid md:mt-14 md:grid-cols-4 md:gap-6">
      {stops.map((stop, index) => (
        <li key={stop.name} className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-5 pb-10 last:pb-0 md:block md:pb-0">
          {index < stops.length - 1 ? (
            <span
              aria-hidden="true"
              className="absolute bottom-0 left-[0.5625rem] top-3 w-px bg-line-strong md:bottom-auto md:left-3 md:-right-6 md:top-[0.5625rem] md:h-px md:w-auto"
            />
          ) : null}
          <span aria-hidden="true" className="relative mt-1.5 size-5 rounded-full border-4 border-surface bg-accent md:mt-0 md:block" />
          <div className="md:mt-6">
            <p className="text-caption tabular-nums text-fg-muted">{String(index + 1).padStart(2, '0')}</p>
            <h3 className="mt-1 text-lede font-semibold text-fg">{keepCompounds(stop.name)}</h3>
            <p className="mt-2 text-body text-fg-muted">{keepCompounds(stop.detail)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * "Where it runs": the sites that deliver the service (the ITEMBA stations
 * and the parking yard; the branches; the inn), or, for logistics, the
 * route from Dar es Salaam to the border and beyond; then the group's
 * location profile (a card of its own beside a lone typographic site).
 * On the fuel page this is the stations showcase, within the page's two
 * canopies: ITEMBA-MPEMBA, already the hero, is typographic here. White,
 * between the grey bento and the black company tile.
 */
export function ServiceWhere({ service, company }: { service: ServiceArea; company: Company }) {
  const { where } = service;
  const sites = service.sites ?? [];
  const location = locationProfiles[0];
  const layout = gridFor(sites.length);
  const withPhotos = sites.some((site) => site.image);
  const single = !service.route?.length && sites.length === 1 ? sites[0] : undefined;
  // A lone typographic site sits beside the group base's card, which carries the location link.
  const locationCarded = Boolean(single && !single.image && location);
  return (
    <Section accent={company.accent} id={serviceSectionIds.where} labelledBy="sites-title">
      <Container>
        <Heading as="h2" id="sites-title" size="h1" className="max-w-3xl">
          {where.heading}
        </Heading>
        {where.body ? (
          <Lede tone="muted" className="mt-5 max-w-[40rem]">
            {where.body}
          </Lede>
        ) : null}

        {service.route?.length ? (
          <RouteStops stops={service.route} />
        ) : single?.image ? (
          <SingleSite site={single} image={single.image} />
        ) : single && location ? (
          <ul role="list" className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 md:mt-14 md:gap-5">
            <SiteCard site={single} sizes={layout.sizes} panel={false} />
            <LocationCard location={location} />
          </ul>
        ) : sites.length ? (
          <ul role="list" className={cn('mt-10 grid grid-cols-1 gap-4 md:mt-14 md:gap-5', layout.grid)}>
            {sites.map((site) => (
              <SiteCard key={site.name} site={site} sizes={layout.sizes} panel={withPhotos} />
            ))}
          </ul>
        ) : null}

        {location && !locationCarded ? (
          <ChevronLink href={locationUrl(location.slug)} className="mt-10 md:mt-12">
            {servicePageCopy.locationLink}
          </ChevronLink>
        ) : null}
      </Container>
    </Section>
  );
}
