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

/**
 * The credit line of a registry image that carries one, the licence linked:
 * - short (no `title`): "Photo: Richard grivas / Wikimedia Commons · CC BY-SA 4.0";
 * - full, with the photograph's `title` (the attribution the licence asks
 *   for: title, author / source, licence): "Songwe Region landscape,
 *   Richard grivas / Wikimedia Commons, CC BY-SA 4.0".
 */
export function MediaCredit({
  entry,
  title,
  label = 'Photo',
  className,
}: {
  entry: ResolvedMedia;
  /** The photograph's title; renders the full attribution. */
  title?: string;
  label?: string;
  className?: string;
}) {
  if (!entry.credit) return null;
  const licence = entry.licence ? (
    entry.licenceUrl ? (
      <a href={entry.licenceUrl} rel="license noopener" className="underline decoration-1 underline-offset-2">
        {entry.licence}
      </a>
    ) : (
      entry.licence
    )
  ) : null;
  if (title) {
    return (
      <span className={cn('text-legal', className)}>
        {title}, {entry.credit}
        {licence ? <>, {licence}</> : null}
      </span>
    );
  }
  return (
    <span className={cn('text-legal', className)}>
      {label}: {entry.credit}
      {licence ? <>{' · '}{licence}</> : null}
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
  // A numeric focus, or a horizontal one (focusX), is set inline as object-position.
  const inlineFocus = typeof focus === 'number' || entry.focusX !== undefined;
  const focusY = typeof focus === 'number' ? `${focus}%` : focus === 'top' ? '0%' : focus === 'bottom' ? '100%' : '50%';
  const focusX = focus === 'left' ? '0%' : focus === 'right' ? '100%' : `${entry.focusX ?? 50}%`;
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
      className={cn('object-cover', inlineFocus ? null : positions[focus])}
      style={inlineFocus ? { objectPosition: `${focusX} ${focusY}` } : undefined}
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
