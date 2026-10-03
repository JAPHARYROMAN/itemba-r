import type { LocationProfile } from '@/content/locations';
import { locationsPage } from '@/content/locations';
import { locationUrl } from '@/content/site';
import { ButtonLink, DirectionsLink, HeadlineText, PageHero } from '@/ui';
import { PanoramaPhoto, PhotoCredit } from './CreditedPhoto';

/**
 * The /locations hero: "Based in Songwe. Connected through Tunduma." as
 * Apple's two-tone line (the second sentence in grey, on its own line from
 * `md`), the group's base in one sentence, then the two ways on (the
 * location profile, or directions to the head office) and the Songwe
 * Region landscape under a big sky, with its CC BY-SA credit under the
 * frame.
 *
 * The photograph sits in a `framed` hero in the 1068px content width, its
 * credit in the hero's caption slot under the rounded frame (the frame
 * clips its media to the radius; the credit is never cropped). Static
 * server HTML: nothing here animates.
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
      mediaSize="content"
      media={location.image ? <PanoramaPhoto photo={location.image} priority /> : undefined}
      mediaCaption={location.image ? <PhotoCredit photo={location.image} /> : undefined}
    />
  );
}
