import Image from 'next/image';
import { cn } from '@/ui/cn';

/**
 * The lion crest, white on a transparent field; `brightness-0` turns it ink
 * while keeping its alpha, so it sits cleanly on the translucent nav, the
 * white menu sheet and the #f5f5f7 footer alike (public/logo-print.png has
 * an opaque white field, which would show as a box on the translucent nav).
 *
 * - `lockup`: public/logo.png (930×360), the shield, ITEMBA and GROUP, at
 *   28px in the footer.
 * - `nav`: public/logo-nav.png (854×301, scripts/images/build-nav-crest.mjs),
 *   the shield and ITEMBA without the GROUP line, which at nav height would
 *   be about 5px tall. 30px tall in the 48px bars (the global nav and the
 *   menu sheet).
 */
const CRESTS = {
  lockup: { src: '/logo.png', width: 930, height: 360, display: 28, className: 'h-7' },
  nav: { src: '/logo-nav.png', width: 854, height: 301, display: 30, className: 'h-[1.875rem]' },
} as const;

export type CrestVariant = keyof typeof CRESTS;

/**
 * The crest, small and crisp, in ink (90% black, which reads as #1d1d1f on
 * white). It is decorative here: every use sits inside a link whose
 * accessible name is `brandLabel`. The image is requested at its display
 * size, so the optimiser serves a small file rather than the 930px master.
 * `eager` is for the global nav (above the fold); the sheet and the footer
 * load it lazily.
 */
export function Crest({ variant = 'lockup', eager = false, className }: { variant?: CrestVariant; eager?: boolean; className?: string }) {
  const crest = CRESTS[variant];
  return (
    <Image
      src={crest.src}
      alt=""
      width={Math.round((crest.display * crest.width) / crest.height)}
      height={crest.display}
      loading={eager ? 'eager' : 'lazy'}
      // Low priority: the crest never competes with a page's LCP image (and
      // React adds no preload for a low-priority image).
      fetchPriority={eager ? 'low' : undefined}
      className={cn('block w-auto max-w-none opacity-90 brightness-0', crest.className, className)}
    />
  );
}
