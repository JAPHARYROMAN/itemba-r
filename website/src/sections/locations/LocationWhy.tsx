import { locationPageCopy, type LocationAdvantage, type LocationProfile } from '@/content/locations';
import { Bento, BentoCell, ChevronLink, Container, Heading, Icon, Lede, Media, Reveal, Section, keepCompounds } from '@/ui';
import { locationSectionIds } from './ids';

function AdvantageText({ advantage }: { advantage: LocationAdvantage }) {
  return (
    <>
      <Icon name={advantage.icon} size="lg" strokeWidth={1.4} className="text-accent" />
      <Heading as="h3" size="h4" className="mt-8">
        {advantage.title}
      </Heading>
      <p className="mt-2 text-body text-fg-muted">{keepCompounds(advantage.summary)}</p>
    </>
  );
}

/**
 * "Why this location matters", as a bento on the six-column grid (lg):
 *   border corridor access, beside the corridor's truck line (2/3) · multi-sector coverage (1/3)
 *   local operating presence (1/3) · the routing promise, on black (2/3)
 * From `md` to `lg` the lead and the promise run the full row and the two
 * others pair up; phones stack them, the photograph above its text. The
 * photograph is the page's only one (UZUNGUNI PARKING YARD's truck line at
 * Mpemba-Tunduma): phone resolution, so it stays in a cell.
 */
export function LocationWhy({ location }: { location: LocationProfile }) {
  const copy = locationPageCopy;
  const [lead, ...rest] = location.advantages;
  const photo = location.advantagesImage;
  return (
    <Section id={locationSectionIds.why} labelledBy="why-title">
      <Container>
        <div className="max-w-[46rem]">
          <Heading as="h2" id="why-title" size="h1">
            {copy.whyHeading}
          </Heading>
          <Lede tone="muted" className="mt-5 md:mt-6">
            {location.detail}
          </Lede>
        </div>

        <Bento className="mt-10 md:mt-14">
          {lead ? (
            <BentoCell span="two-thirds" padding="none" className="md:flex-row">
              <div className="flex flex-1 flex-col p-7 md:p-8">
                <AdvantageText advantage={lead} />
              </div>
              {photo ? (
                <Reveal className="relative aspect-[3/2] max-md:order-first md:aspect-auto md:w-1/2 md:shrink-0">
                  <Media
                    media={photo}
                    alt={photo.alt}
                    fill
                    sizes="(min-width: 1112px) 620px, (min-width: 768px) calc((100vw - 44px) * 0.85), calc((100vw - 44px) * 1.38)"
                  />
                </Reveal>
              ) : null}
            </BentoCell>
          ) : null}
          {rest.map((advantage) => (
            <BentoCell key={advantage.title} span="third">
              <AdvantageText advantage={advantage} />
            </BentoCell>
          ))}
          <BentoCell span="two-thirds" tone="cinema" className="justify-center">
            <Heading as="h3" size="h3">
              {copy.routing.title}
            </Heading>
            <p className="mt-3 max-w-[30rem] text-body-lg text-fg-muted">{keepCompounds(copy.routing.body)}</p>
            <ChevronLink href={`#${locationSectionIds.enquire}`} className="mt-6">
              {copy.routing.action}
            </ChevronLink>
          </BentoCell>
        </Bento>
      </Container>
    </Section>
  );
}
