import type { LocationProfile } from '@/content/locations';
import { locationsPage } from '@/content/locations';
import { locationUrl } from '@/content/site';
import { ButtonLink, DirectionsLink, HeadlineText, PageHero } from '@/ui';
import { PanoramaPhoto, PhotoCredit } from './CreditedPhoto';

/** Regional introduction with the verified Songwe landscape and its full licence credit below the frame. */
export function LocationsHero({ location }: { location: LocationProfile }) {
  const { hero, headquarters } = locationsPage;
  return (
    <PageHero
      align="start"
      eyebrow={hero.eyebrow}
      title={<HeadlineText headline={hero.headline} variant="muted-break" />}
      titleSize="display"
      titleMeasure="wide"
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
