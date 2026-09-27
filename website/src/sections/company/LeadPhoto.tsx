import type { CSSProperties } from 'react';
import { getMedia, type MediaImage } from '@/content/media';
import { breakpoints, containers, gutter } from '@/design/tokens';
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
 * - A landscape master 2000px or wider may run a wide frame; the dusk tile
 *   and the company heroes keep to the 1068px content width.
 */

export type LeadPhotoShape = 'cinema' | 'panorama' | 'landscape' | 'photo' | 'portrait' | 'square';
export type LeadPhotoWidth = 'wide' | 'content' | 'prose' | 'measure' | 'split';

/** From a viewport width (px) up, the frame's aspect ratio (width / height). */
type ShapeStep = { from: number; ratio: number };

const shapes: Record<LeadPhotoShape, { className: string; steps: readonly ShapeStep[] }> = {
  /**
   * The home hero: 4:3 on phones (with `zoom`, a tighter crop on the
   * canopy, so it reads rather than sitting small under a big sky); 21:9
   * from `md`, where its frame starts under a two-line 96px headline, so
   * its subject must sit high in a short frame.
   */
  cinema: {
    className: 'aspect-[4/3] md:aspect-[21/9]',
    steps: [
      { from: 0, ratio: 4 / 3 },
      { from: breakpoints.md, ratio: 21 / 9 },
    ],
  },
  /** 4:3 on phones, 2:1 from `md`: a big sky, a lit canopy across a tile. */
  panorama: {
    className: 'aspect-[4/3] md:aspect-[2/1]',
    steps: [
      { from: 0, ratio: 4 / 3 },
      { from: breakpoints.md, ratio: 2 },
    ],
  },
  /** 16:9 at every width. */
  landscape: { className: 'aspect-video', steps: [{ from: 0, ratio: 16 / 9 }] },
  /** 4:3 on phones, 3:2 from `md`. */
  photo: {
    className: 'aspect-[4/3] md:aspect-[3/2]',
    steps: [
      { from: 0, ratio: 4 / 3 },
      { from: breakpoints.md, ratio: 3 / 2 },
    ],
  },
  /**
   * Square at every width: a company hero's photograph beside the text
   * (heroFrame), about as tall as the text block beside it, so the text
   * does not float in a band of white beside a tall photograph.
   */
  square: { className: 'aspect-square', steps: [{ from: 0, ratio: 1 }] },
  /** Square until `lg`, then 3:4 beside the text. */
  portrait: {
    className: 'aspect-square lg:aspect-[3/4]',
    steps: [
      { from: 0, ratio: 1 },
      { from: breakpoints.lg, ratio: 3 / 4 },
    ],
  },
};

/**
 * From a viewport width (px) up, the frame's CSS width: a fixed width, or
 * (without `px`) the viewport less the two 22px gutters. Each container
 * reaches its full width once the viewport has room for it and the gutters;
 * the split column is 440px beside the text from `lg`, 448px when stacked.
 */
type WidthStep = { from: number; px?: number };

const fullWidthFrom = (px: number) => px + 2 * gutter;

const widths: Record<LeadPhotoWidth, readonly WidthStep[]> = {
  wide: [{ from: 0 }, { from: fullWidthFrom(containers.wide), px: containers.wide }],
  content: [{ from: 0 }, { from: fullWidthFrom(containers.content), px: containers.content }],
  prose: [{ from: 0 }, { from: fullWidthFrom(containers.prose), px: containers.prose }],
  /** The 680px reading column of an article. */
  measure: [{ from: 0 }, { from: fullWidthFrom(containers.measure), px: containers.measure }],
  split: [{ from: 0 }, { from: fullWidthFrom(448), px: 448 }, { from: breakpoints.lg, px: 440 }],
};

const stepAt = <T extends { from: number }>(steps: readonly T[], viewport: number): T =>
  steps.filter((step) => step.from <= viewport).at(-1) ?? steps[0]!;

/**
 * The `sizes` attribute for a photograph in a frame. `object-fit: cover`
 * scales a photograph wider than its frame to the frame's height, so it
 * renders wider than the frame by (photo ratio / frame ratio): a 1.42:1
 * master in a square phone frame draws 1.42 frames wide; a phone `zoom`
 * multiplies that below `md`. `sizes` says so, or the browser would pick
 * a file too small for the crop and it would look soft.
 */
export function leadPhotoSizes(shape: LeadPhotoShape, width: LeadPhotoWidth, photoRatio: number, zoom = 1): string {
  const { steps } = shapes[shape];
  const frames = widths[width];
  const from = [...new Set([...steps, ...frames, { from: breakpoints.md }].map((step) => step.from))].sort((a, b) => a - b);
  const entries: { from: number; size: string }[] = [];
  for (const viewport of from) {
    const cover = Math.max(1, photoRatio / stepAt(steps, viewport).ratio);
    const factor = viewport < breakpoints.md ? cover * zoom : cover;
    const frame = stepAt(frames, viewport);
    const scale = Math.round(factor * 100) / 100;
    const size =
      frame.px !== undefined
        ? `${Math.ceil(frame.px * factor)}px`
        : scale === 1
          ? `calc(100vw - ${2 * gutter}px)`
          : `calc((100vw - ${2 * gutter}px) * ${scale})`;
    // A step that renders the same size as the one below it adds nothing.
    if (entries.at(-1)?.size !== size) entries.push({ from: viewport, size });
  }
  return entries
    .reverse()
    .map(({ from: viewport, size }) => (viewport === 0 ? size : `(min-width: ${viewport}px) ${size}`))
    .join(', ');
}

const ratioOf = (photo: MediaImage) => {
  const { width, height } = getMedia(photo.media);
  return width / height;
};

/** Taller than wide: set beside the text, never across a tile. */
export function isPortrait(photo: MediaImage) {
  return ratioOf(photo) < 1;
}

/** Wide enough (2000px and up) to fill a 1068px frame sharply. */
export function isWideMaster(photo: MediaImage) {
  return getMedia(photo.media).width >= 2000;
}

/**
 * The frame a company hero gives its photograph, one template for every
 * company page:
 * - a landscape master 2000px or wider runs under the centred text in the
 *   1068px content width, 2:1 from `md` (at most 2.1:1, so the subject
 *   enters the first screen under the headline, and never taller than it
 *   can fill), magnified on phones by the registry's `phoneZoom`;
 * - any other photograph (a portrait, or a phone-resolution landscape)
 *   stands beside the text, square, in a column of at most 440px, where it
 *   stays sharp and about matches the text block's height. This split is a
 *   recorded deviation from the plan's centred hero (the photograph below
 *   the text): a phone-resolution photograph cannot fill a 1068px frame.
 */
export function heroFrame(photo: MediaImage): {
  layout: 'framed' | 'split';
  shape: LeadPhotoShape;
  width: LeadPhotoWidth;
  zoom?: number;
} {
  if (isPortrait(photo) || !isWideMaster(photo)) return { layout: 'split', shape: 'square', width: 'split' };
  return { layout: 'framed', shape: 'panorama', width: 'content', zoom: getMedia(photo.media).phoneZoom };
}

export type LeadPhotoProps = {
  photo: MediaImage;
  shape: LeadPhotoShape;
  /** The container it renders in, for `sizes`. */
  width: LeadPhotoWidth;
  /** The page's LCP image (a hero): preloaded, no blur placeholder. */
  priority?: boolean;
  /**
   * Art direction below `md`: magnify the photograph about its focus (the
   * registry's focusX and focus), a tighter crop for a subject that would
   * otherwise sit small in a phone-sized frame. Static: nothing animates.
   */
  zoom?: number;
  className?: string;
};

export function LeadPhoto({ photo, shape, width, priority = false, zoom, className }: LeadPhotoProps) {
  const sizes = leadPhotoSizes(shape, width, ratioOf(photo), zoom);
  const image = <Media media={photo} alt={photo.alt} sizes={sizes} fill priority={priority} />;
  let content = image;
  if (zoom && zoom !== 1) {
    const { focus, focusX } = getMedia(photo.media);
    const y = typeof focus === 'number' ? focus : focus === 'top' ? 0 : focus === 'bottom' ? 100 : 50;
    content = (
      <div
        className="absolute inset-0 max-md:[transform:scale(var(--lead-zoom))]"
        style={{ '--lead-zoom': zoom, transformOrigin: `${focusX ?? 50}% ${y}%` } as CSSProperties}
      >
        {image}
      </div>
    );
  }
  return <div className={cn('relative overflow-hidden rounded-tile', shapes[shape].className, className)}>{content}</div>;
}
