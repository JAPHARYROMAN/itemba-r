import { locationPageCopy, type LocationProfile } from '@/content/locations';
import { Container, FactList, Heading, Section } from '@/ui';

/**
 * "At a glance": the location's facts as a quiet grid straight under the
 * hero (the hero supplies the space above it), as on a company page.
 */
export function LocationGlance({ location }: { location: LocationProfile }) {
  return (
    <Section space="none" labelledBy="glance-title" className="pb-section-tight">
      <Container>
        <Heading as="h2" id="glance-title" size="h5">
          {locationPageCopy.glanceTitle}
        </Heading>
        <FactList
          layout="grid"
          items={location.facts.map((fact) => ({ key: fact.label, term: fact.label, detail: fact.value }))}
          className="mt-6"
        />
      </Container>
    </Section>
  );
}
