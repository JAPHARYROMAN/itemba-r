import { locationPageCopy, type LocationProfile } from '@/content/locations';
import { Container, DirectionsLink, Eyebrow, Heading, MapFacade, Section } from '@/ui';
import { locationSectionIds } from './ids';

/**
 * Where to find the head office: the address and the directions link
 * (always visible) on the left; the map facade on the right, closed until
 * a visitor asks for the map, so no Google request happens on page load.
 */
export function LocationVisit({ location }: { location: LocationProfile }) {
  const { visit, mapTitle } = locationPageCopy;
  return (
    <Section tone="alt" id={locationSectionIds.visit} labelledBy="visit-title">
      <Container className="grid items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div>
          <Eyebrow>{visit.eyebrow}</Eyebrow>
          <Heading as="h2" id="visit-title" size="h1" className="mt-2">
            {visit.title}
          </Heading>
          <h3 className="mt-8 text-eyebrow text-fg-muted">{visit.addressHeading}</h3>
          <address className="mt-2 text-body-lg not-italic text-fg md:text-lede">
            {location.addressLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
          <DirectionsLink className="mt-6" />
        </div>
        <MapFacade title={mapTitle} />
      </Container>
    </Section>
  );
}
