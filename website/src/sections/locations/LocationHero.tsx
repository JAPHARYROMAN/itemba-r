import { locationPageCopy, type LocationProfile } from '@/content/locations';
import { ButtonLink, PageHero, TypePanel } from '@/ui';
import { DirectionsLink } from './DirectionsLink';
import { locationSectionIds } from './ids';

/**
 * The location profile's hero: where it is (eyebrow), its name as the
 * page's h1, one sentence on why it matters, then the two actions (ask
 * about it here, or get directions to the head office). There is no
 * photograph of the head office itself, so the visual beside the text is a
 * typographic panel: a line pin and one strong sentence (owner decision:
 * a typographic tile where no strong photograph exists). The index already
 * leads with the Songwe landscape; this page does not repeat it.
 */
export function LocationHero({ location }: { location: LocationProfile }) {
  const panel = location.heroPanel;
  return (
    <PageHero
      eyebrow={location.eyebrow}
      title={location.title}
      titleSize="display"
      lede={location.lede}
      actions={
        <>
          <ButtonLink href={`#${locationSectionIds.enquire}`} size="lg">
            {locationPageCopy.hero.enquire}
          </ButtonLink>
          <DirectionsLink size="body-lg" />
        </>
      }
      mediaLayout="split"
      media={
        <TypePanel
          icon={panel.icon}
          statement={panel.statement}
          caption={panel.caption}
          className="aspect-[4/3] w-full sm:aspect-square"
        />
      }
    />
  );
}
