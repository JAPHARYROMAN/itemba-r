import type { MediaImage } from '@/content/media';
import { Media, cn } from '@/ui';

export type ShowcaseProps = {
  /** Lead first. One photograph is set wide; three stand side by side. */
  photos: readonly MediaImage[];
  /** The lead is the page's LCP image (a hero): preload it, no blur. */
  priority?: boolean;
  className?: string;
};

/** Rendered widths: the wide container (1440px) less the 22px gutters, and the 16px gaps of the trio. */
const sizes = {
  wide: '(min-width: 1484px) 1440px, calc(100vw - 44px)',
  third: '(min-width: 1484px) 470px, (min-width: 768px) calc((100vw - 76px) / 3), calc(100vw - 44px)',
} as const;

/**
 * A company's lead photographs, as its home tile and page hero show them.
 *
 * - One photograph: 4:3 on phones, 2:1 from `md`, cropped to the registry's
 *   focal edge (a big sky, a lit canopy).
 * - Three photographs: tall 3:4 frames side by side from `md`. Phones show
 *   the lead alone at 4:3; the other two are not displayed there, and as
 *   lazy images they are never fetched.
 *
 * Our phone photographs are mostly portrait and at most 1280px wide, so
 * only a 2000px+ landscape master is ever set wide (plan: low-res and
 * portrait photos only in small cells).
 */
export function Showcase({ photos, priority = false, className }: ShowcaseProps) {
  const [lead] = photos;
  if (!lead) return null;

  if (photos.length === 1) {
    return (
      <div className={cn('relative aspect-[4/3] overflow-hidden rounded-tile md:aspect-[2/1]', className)}>
        <Media media={lead} alt={lead.alt} sizes={sizes.wide} fill priority={priority} />
      </div>
    );
  }

  return (
    <div className={cn('grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4', className)}>
      {photos.map((photo, index) => (
        <div
          key={photo.media}
          className={cn('relative aspect-[4/3] overflow-hidden rounded-tile md:aspect-[3/4]', index > 0 && 'hidden md:block')}
        >
          <Media media={photo} alt={photo.alt} sizes={sizes.third} fill priority={priority && index === 0} />
        </div>
      ))}
    </div>
  );
}
