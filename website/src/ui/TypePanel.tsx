import type { ReactNode } from 'react';
import type { AccentName, Tone } from '@/design/tokens';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';
import { keepCompounds } from './text';

export type TypePanelProps = {
  /** A line icon from the kit, drawn in the graphic accent. */
  icon: IconName;
  /** One strong sentence, set large (it is text, not a heading). */
  statement: ReactNode;
  /** A short line under the statement, such as a list of places. */
  caption?: ReactNode;
  /**
   * The panel's own tone. Omitted, it is a card on the tile around it
   * (`#f5f5f7` in a light tile, white in an alt tile, the raised black in
   * cinema); `cinema` gives an ink panel in a light tile.
   */
  tone?: Tone;
  accent?: AccentName;
  /** The frame's shape and size (an aspect ratio, a max width), from the caller. */
  className?: string;
};

/**
 * A typographic tile in a photograph's place: a line icon at the top and
 * one strong sentence at the foot, in the photograph's rounded frame. The
 * owner's photo rule: where no strong photograph exists, use this rather
 * than a weak one (docs/PAGE-GUIDE.md, "Photographs").
 *
 * Server markup with no motion; the statement is real text, so it reads
 * without images and with JavaScript off.
 */
export function TypePanel({ icon, statement, caption, tone, accent, className }: TypePanelProps) {
  return (
    <div
      data-tone={tone}
      data-accent={accent}
      data-type-panel=""
      className={cn(
        'flex flex-col justify-between gap-10 rounded-tile p-8 md:p-10',
        tone ? 'bg-surface' : 'bg-surface-alt',
        className,
      )}
    >
      <Icon name={icon} size="xl" strokeWidth={1.2} className="text-accent" />
      <div>
        <p className="text-h2 font-semibold text-fg">{keepCompounds(statement)}</p>
        {caption ? <p className="mt-3 text-body text-fg-muted">{keepCompounds(caption)}</p> : null}
      </div>
    </div>
  );
}
