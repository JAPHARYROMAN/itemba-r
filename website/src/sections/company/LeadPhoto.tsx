import { getMedia, type MediaImage } from '@/content/media';
import { Media, cn } from '@/ui';

/**
 * One lead photograph per tile or hero, framed for what the master can
 * carry (plan: low-resolution and portrait photographs only in small cells,
 * never as full-width heroes; a Retina screen needs about twice the frame's
 * CSS width in pixels).
 *
 * - A portrait photograph stands beside the text (a split tile or hero):
 *   square on phones and tablets, 3:4 from `lg` in a column of at most
 *   440px.
 * - A landscape master 2000px or wider may run the full wide container
 *   (1440px); the dusk tile keeps to the 1068px content width, where it
 *   stays sharp.
 * - A smaller landscape master stays within the 980px prose width.
 */

export type LeadPhotoShape = 'cinema' | 'panorama' | 'landscape' | 'photo' | 'portrait';
export type LeadPhotoWidth = 'wide' | 'content' | 'prose' | 'split';

const shapes: Record<LeadPhotoShape, string> = {
  /**
   * 4:3 on phones, 21:9 from `md`: the home hero, whose frame starts under a
   * three-line 96px headline, so its subject must sit high in a short frame.
   */
  cinema: 'aspect-[4/3] md:aspect-[21/9]',
  /** 4:3 on phones, 2:1 from `md`: a big sky, a lit canopy across a tile. */
  panorama: 'aspect-[4/3] md:aspect-[2/1]',
  /** 16:9 at every width. */
  landscape: 'aspect-video',
  /** 4:3 on phones, 3:2 from `md`. */
  photo: 'aspect-[4/3] md:aspect-[3/2]',
  /** Square until `lg`, then 3:4 beside the text. */
  portrait: 'aspect-square lg:aspect-[3/4]',
};

/** Rendered widths: each container less the 22px gutters; the split column is 440px (448px stacked). */
const sizes: Record<LeadPhotoWidth, string> = {
  wide: '(min-width: 1484px) 1440px, calc(100vw - 44px)',
  content: '(min-width: 1112px) 1068px, calc(100vw - 44px)',
  prose: '(min-width: 1024px) 980px, calc(100vw - 44px)',
  split: '(min-width: 1024px) 440px, (min-width: 492px) 448px, calc(100vw - 44px)',
};

/** Taller than wide: set beside the text, never across a tile. */
export function isPortrait(photo: MediaImage) {
  const { width, height } = getMedia(photo.media);
  return height > width;
}

/** Wide enough (2000px and up) to fill a 1440px frame sharply. */
export function isWideMaster(photo: MediaImage) {
  return getMedia(photo.media).width >= 2000;
}

/** The frame a page hero gives its photograph. */
export function heroFrame(photo: MediaImage): { layout: 'framed' | 'split'; shape: LeadPhotoShape; width: LeadPhotoWidth } {
  if (isPortrait(photo)) return { layout: 'split', shape: 'portrait', width: 'split' };
  if (!isWideMaster(photo)) return { layout: 'framed', shape: 'photo', width: 'prose' };
  const { width, height } = getMedia(photo.media);
  return { layout: 'framed', shape: width / height >= 1.7 ? 'landscape' : 'panorama', width: 'wide' };
}

export type LeadPhotoProps = {
  photo: MediaImage;
  shape: LeadPhotoShape;
  /** The container it renders in, for `sizes`. */
  width: LeadPhotoWidth;
  /** The page's LCP image (a hero): preloaded, no blur placeholder. */
  priority?: boolean;
  className?: string;
};

export function LeadPhoto({ photo, shape, width, priority = false, className }: LeadPhotoProps) {
  return (
    <div className={cn('relative overflow-hidden rounded-tile', shapes[shape], className)}>
      <Media media={photo} alt={photo.alt} sizes={sizes[width]} fill priority={priority} />
    </div>
  );
}
