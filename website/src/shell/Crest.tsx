import Image from 'next/image';
import { cn } from '@/ui/cn';

/**
 * The lion-crest lockup. public/logo.png (930×360) is the white mark on a
 * transparent field; `brightness-0` turns it ink while keeping its alpha, so
 * the crest sits cleanly on the translucent nav, the white menu sheet and
 * the #f5f5f7 footer alike (public/logo-print.png has an opaque white field,
 * which would show as a box on the translucent nav).
 */
const CREST = { src: '/logo.png', width: 930, height: 360 } as const;

/** Display height in px: the global nav, the menu sheet and the footer all use 28px. */
const HEIGHT = 28;
const WIDTH = Math.round((HEIGHT * CREST.width) / CREST.height);

/**
 * The crest, small and crisp, in ink (90% black, which reads as #1d1d1f on
 * white). It is decorative here: every use sits inside a link whose
 * accessible name is `brandLabel`. The image is requested at its display
 * size, so the optimiser serves a small file rather than the 930px master.
 * `eager` is for the global nav (above the fold); the sheet and the footer
 * load it lazily.
 */
export function Crest({ eager = false, className }: { eager?: boolean; className?: string }) {
  return (
    <Image
      src={CREST.src}
      alt=""
      width={WIDTH}
      height={HEIGHT}
      loading={eager ? 'eager' : 'lazy'}
      // Low priority: the crest never competes with a page's LCP image (and
      // React adds no preload for a low-priority image).
      fetchPriority={eager ? 'low' : undefined}
      className={cn('block h-7 w-auto max-w-none opacity-90 brightness-0', className)}
    />
  );
}
