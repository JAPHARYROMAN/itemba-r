import Image from 'next/image';
import type { ReactNode } from 'react';
import { isEnabled } from '@/content/flags';
import { getMedia, type MediaId, type MediaImage, type ResolvedMedia } from '@/content/media';
import { cn } from './cn';

/**
 * Photographs from the media registry (src/content/media.ts), through
 * next/image. Intrinsic size and the blur placeholder come from
 * media.generated.ts, so images never shift layout. A registry entry with a
 * credit (the CC BY-SA Songwe landscape) always renders its credit line.
 *
 * `alt` and `sizes` are required on purpose: say what the photo shows in
 * this context ("" only when it is purely decorative), and how wide it
 * renders.
 */

const aspects = {
  '21/9': 'aspect-[21/9]',
  '2/1': 'aspect-[2/1]',
  '16/9': 'aspect-video',
  '3/2': 'aspect-[3/2]',
  '4/3': 'aspect-[4/3]',
  '1/1': 'aspect-square',
  '4/5': 'aspect-[4/5]',
  '3/4': 'aspect-[3/4]',
} as const;

export type MediaAspect = keyof typeof aspects;

const positions = {
  center: 'object-center',
  top: 'object-top',
  bottom: 'object-bottom',
  left: 'object-left',
  right: 'object-right',
} as const;

const radii = {
  none: '',
  card: 'rounded-card',
  tile: 'rounded-tile',
} as const;

export type MediaSource = MediaId | MediaImage;

export type MediaProps = {
  /** A registry id, or an image as content carries it. */
  media: MediaSource;
  alt: string;
  /** The `sizes` attribute, e.g. "(min-width: 1068px) 1024px, 100vw". */
  sizes: string;
  /** The page's LCP image: preloaded, eager, no blur placeholder. */
  priority?: boolean;
  /** Crop to this aspect ratio (object-fit: cover). Omit to keep the photo's own shape. */
  aspect?: MediaAspect;
  /** Fill the parent box instead (the parent sets the size and `position: relative`). */
  fill?: boolean;
  /**
   * Which part of the photo a crop keeps; defaults to the registry's `focus`
   * (else the centre). A number is a percentage from the top.
   */
  position?: keyof typeof positions | number;
  radius?: keyof typeof radii;
  /**
   * Where the credit line goes, for images that carry one: `below` the
   * image, or `overlay` on its lower edge. `none` is only for a caller that
   * renders <MediaCredit> itself (Figure does).
   */
  credit?: 'below' | 'overlay' | 'none';
  /** Encoder quality: one of next.config.ts `images.qualities` (75 when omitted). */
  quality?: 60 | 75 | 85;
  className?: string;
};

function mediaId(source: MediaSource): MediaId {
  return typeof source === 'string' ? source : source.media;
}

/** The registry entry for a source, or null when a content flag hides it. */
export function resolveMedia(source: MediaSource): ResolvedMedia | null {
  const entry = getMedia(mediaId(source));
  return isEnabled(entry.requires) ? entry : null;
}

/** "Photo: Richard grivas / Wikimedia Commons · CC BY-SA 4.0" with the licence linked. */
export function MediaCredit({ entry, label = 'Photo', className }: { entry: ResolvedMedia; label?: string; className?: string }) {
  if (!entry.credit) return null;
  return (
    <span className={cn('text-legal', className)}>
      {label}: {entry.credit}
      {entry.licence ? (
        <>
          {' · '}
          {entry.licenceUrl ? (
            <a href={entry.licenceUrl} rel="license noopener" className="underline decoration-1 underline-offset-2">
              {entry.licence}
            </a>
          ) : (
            entry.licence
          )}
        </>
      ) : null}
    </span>
  );
}

export function Media({
  media,
  alt,
  sizes,
  priority = false,
  aspect,
  fill = false,
  position,
  radius = 'none',
  credit = 'below',
  quality,
  className,
}: MediaProps) {
  const entry = resolveMedia(media);
  if (!entry) return null;

  const cropped = fill || aspect !== undefined;
  const focus = position ?? entry.focus ?? 'center';
  const placeholder = priority ? 'empty' : 'blur';
  const image = cropped ? (
    <Image
      src={entry.src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      quality={quality}
      placeholder={placeholder}
      blurDataURL={entry.blurDataURL}
      className={cn('object-cover', typeof focus === 'number' ? null : positions[focus])}
      style={typeof focus === 'number' ? { objectPosition: `50% ${focus}%` } : undefined}
    />
  ) : (
    <Image
      src={entry.src}
      alt={alt}
      width={entry.width}
      height={entry.height}
      sizes={sizes}
      priority={priority}
      quality={quality}
      placeholder={placeholder}
      blurDataURL={entry.blurDataURL}
      className="block h-auto w-full"
    />
  );

  // A filled image has no room below it, so its credit always overlays.
  const placement = fill && credit === 'below' ? 'overlay' : credit;
  const creditBelow = placement === 'below' && Boolean(entry.credit);

  const frame = (
    <div
      className={cn(
        'relative overflow-hidden',
        aspect ? aspects[aspect] : null,
        fill ? 'size-full' : null,
        radii[radius],
        creditBelow ? null : className,
      )}
    >
      {image}
      {placement === 'overlay' && entry.credit ? (
        <p className="absolute bottom-2 right-2 max-w-[calc(100%-1rem)] rounded-md bg-black/60 px-2 py-0.5 text-white">
          <MediaCredit entry={entry} />
        </p>
      ) : null}
    </div>
  );

  if (!creditBelow) return frame;
  return (
    <div className={className}>
      {frame}
      <p className="mt-2 text-fg-muted">
        <MediaCredit entry={entry} />
      </p>
    </div>
  );
}

/* ── Figure ───────────────────────────────────────────────────────────── */

export type FigureProps = Omit<MediaProps, 'credit'> & {
  caption?: ReactNode;
};

/**
 * A photo with a caption. The credit (when the image has one) joins the
 * caption line. Uses the content image's own caption when none is given.
 */
export function Figure({ caption, className, ...media }: FigureProps) {
  const entry = resolveMedia(media.media);
  if (!entry) return null;
  const text = caption ?? (typeof media.media === 'string' ? undefined : media.media.caption);
  const hasCaption = Boolean(text) || Boolean(entry.credit);
  return (
    <figure className={className}>
      <Media {...media} credit="none" />
      {hasCaption ? (
        <figcaption className="mt-3 text-caption text-fg-muted">
          {text}
          {text && entry.credit ? <br /> : null}
          <MediaCredit entry={entry} />
        </figcaption>
      ) : null}
    </figure>
  );
}
