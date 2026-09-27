import type { LocationProfile } from '@/content/locations';
import { locationsPage } from '@/content/locations';
import { locationUrl } from '@/content/site';
import { ButtonLink, Container, HeadlineText, PageHero } from '@/ui';
import { CreditedPhoto } from './CreditedPhoto';
import { DirectionsLink } from './DirectionsLink';

/**
 * The /locations hero: "Based in Songwe. Connected through Tunduma." as
 * Apple's two-tone line (the second sentence in grey, on its own line from
 * `md`), the group's base in one sentence, then the two ways on (the
 * location profile, or directions to the head office) and the Songwe
 * Region landscape under a big sky, with its CC BY-SA credit under the
 * frame.
 *
 * The photograph sits in the same 1068px frame a `framed` PageHero gives
 * it, but through the `bleed` slot, which has no clipping wrapper, so the
 * credit line can sit below the rounded frame (a framed hero clips its
 * media to the frame's radius). Static server HTML: nothing here animates.
 */
export function LocationsHero({ location }: { location: LocationProfile }) {
  const { hero, headquarters } = locationsPage;
  return (
    <PageHero
      eyebrow={hero.eyebrow}
      title={<HeadlineText headline={hero.headline} variant="muted-break" />}
      titleSize="display"
      lede={hero.lede}
      actions={
        <>
          <ButtonLink href={locationUrl(location.slug)} size="lg">
            {headquarters.action}
          </ButtonLink>
          <DirectionsLink size="body-lg" />
        </>
      }
      mediaLayout="bleed"
      media={
        location.image ? (
          <Container>
            <CreditedPhoto photo={location.image} priority />
          </Container>
        ) : undefined
      }
    />
  );
}
