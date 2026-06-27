import Image from 'next/image';

interface CinematicImageProps {
  src: string;
  /** Empty string marks a decorative image (the visual is backdrop, not content). */
  alt: string;
  /** Set true only for the above-the-fold LCP image on a page. */
  priority?: boolean;
  /** Responsive sizes hint; defaults to full-bleed. */
  sizes?: string;
  /** Extra classes applied to the underlying <img> (e.g. object-position, animation). */
  className?: string;
}

/**
 * Full-bleed image for the cinematic surfaces. Wraps next/image in `fill` mode so
 * every hero/cover gets responsive srcset + AVIF/WebP + lazy-loading (and a
 * `priority` LCP hint when above the fold) instead of a raw <img>. The PARENT
 * element must be positioned (relative/absolute) and sized — every cinematic
 * section/card already is.
 */
export default function CinematicImage({
  src,
  alt,
  priority = false,
  sizes = '100vw',
  className = '',
}: CinematicImageProps) {
  return (
    <Image
      src={src}
      alt={alt}
      fill
      priority={priority}
      sizes={sizes}
      className={`object-cover ${className}`}
    />
  );
}
