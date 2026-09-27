import { aboutPage } from '@/content/about';
import { contact, mapsDirectionsUrl } from '@/content/contact';
import { isEnabled } from '@/content/flags';
import { footerDirectory } from '@/content/nav';
import type { RichText } from '@/content/types';
import { PanoramaPhoto, PhotoCredit } from '@/sections/locations/CreditedPhoto';
import { ChevronLink, Container, Eyebrow, FactList, Heading, Section, keepCompounds } from '@/ui';

function Rich({ text }: { text: RichText }) {
  return (
    <>
      {text.map((run, index) =>
        typeof run === 'string' ? (
          <span key={index}>{keepCompounds(run)}</span>
        ) : (
          <strong key={index} className="font-semibold text-fg">
            {run.strong}
          </strong>
        ),
      )}
    </>
  );
}

/**
 * "Where we are": the page's one cinema tile and its one photograph. The
 * head office in a sentence and as facts (address, post, region), the
 * directions (a new tab) and the location page, then the Songwe landscape
 * across the content width with its CC BY-SA credit as a caption under the
 * frame, as on /locations (never over the picture, never cropped away). It
 * does not fade in. The head office is not equated
 * with the ITEMBA-MPEMBA station (flags.stateHqIsItembaMpemba), and the
 * unsourced growth claim stays off (flags.songweGrowthClaim).
 */
export function AboutHeadquarters() {
  const { headquarters: hq } = aboutPage;
  return (
    <Section tone="cinema" labelledBy="hq-title">
      <Container className="grid gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <Eyebrow>{hq.eyebrow}</Eyebrow>
          <Heading as="h2" id="hq-title" size="h1" className="mt-2">
            {hq.title}
          </Heading>
          <p className="mt-5 text-body-lg text-fg-muted md:mt-6 md:text-lede">
            <Rich text={hq.body} />
          </p>
          {isEnabled(hq.growth.requires) ? <p className="mt-4 text-body text-fg-muted">{hq.growth.text}</p> : null}
        </div>
        <div className="lg:pt-2">
          <FactList
            items={[
              { key: 'office', term: hq.facts.headOffice, detail: keepCompounds(contact.headOffice) },
              { key: 'postal', term: hq.facts.postal, detail: keepCompounds(contact.postal) },
              { key: 'region', term: hq.facts.region, detail: hq.facts.regionValue },
            ]}
          />
          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3">
            <ChevronLink href={mapsDirectionsUrl()} target="_blank" rel="noopener noreferrer" context={footerDirectory.contact.newTab}>
              {hq.links.directions}
            </ChevronLink>
            <ChevronLink href={hq.links.location.href}>{hq.links.location.label}</ChevronLink>
          </div>
        </div>
      </Container>
      <Container className="mt-12 md:mt-16">
        <figure>
          <div className="overflow-hidden rounded-tile">
            <PanoramaPhoto photo={hq.image} />
          </div>
          <figcaption className="mt-3 text-legal text-fg-muted md:text-right">
            <PhotoCredit photo={hq.image} />
          </figcaption>
        </figure>
      </Container>
    </Section>
  );
}
