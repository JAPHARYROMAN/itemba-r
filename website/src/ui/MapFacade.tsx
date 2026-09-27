import { mapCopy, mapsEmbedUrl } from '@/content/contact';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export type MapFacadeProps = {
  /** The iframe's accessible title. */
  title: string;
  /**
   * - `panel`: a tall panel (a column beside the address): the line icon at
   *   the top, the place and the control at the foot.
   * - `bar`: a slim full-width row (under contact cards): icon, place, and
   *   the control on the right from `md`.
   */
  layout?: 'panel' | 'bar';
  /** The line icon: the pin by default; another where a pin card sits beside it. */
  icon?: IconName;
  className?: string;
};

/** The "Show map" control: an outlined pill that fills on hover, inside the summary. */
function ShowMap() {
  return (
    <span className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-fg px-5 text-body text-fg transition-colors duration-fast ease-apple group-hover:bg-fg group-hover:text-surface">
      {mapCopy.show}
      <Icon name="plus" size="xs" />
    </span>
  );
}

/**
 * The map facade (architecture §3, "Maps"): a closed <details> whose
 * summary is a quiet panel (a line icon, the town, a "Show map" control),
 * so nothing loads from Google until a visitor opens it. It needs no
 * JavaScript: the iframe inside is `loading="lazy"`, and a closed
 * disclosure's content is not rendered, so it is only fetched once open.
 * Opened, the panel folds to a slim "Hide map" bar above the map.
 *
 * The panel names the town and region (a map's label), not the street
 * address, which the page sets beside it. The directions link is not in
 * here: the page shows it beside the address, always visible
 * (DirectionsLink).
 */
export function MapFacade({ title, layout = 'panel', icon = 'map-pin', className }: MapFacadeProps) {
  const bar = layout === 'bar';
  // The town and region are decorative here (the control's name is "Show map"); the address beside it says the same in words.
  const place = (
    <span className="block">
      <span aria-hidden="true" className={cn('block font-semibold text-fg', bar ? 'text-lede' : 'text-h3')}>
        {mapCopy.place}
      </span>
      <span aria-hidden="true" className="mt-1 block text-body text-fg-muted">
        {mapCopy.area}
      </span>
    </span>
  );
  const note = <span className="block text-caption text-fg-muted">{mapCopy.note}</span>;

  return (
    <div className={cn('overflow-hidden rounded-tile bg-surface-alt', className)}>
      <details className="group">
        <summary className="block cursor-pointer list-none rounded-tile focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus group-open:rounded-none [&::-webkit-details-marker]:hidden">
          {bar ? (
            <span className="flex flex-col gap-6 p-7 group-open:hidden md:flex-row md:items-center md:gap-8 md:p-8">
              <Icon name={icon} size="lg" strokeWidth={1.4} className="text-accent" />
              <span className="block md:flex-1">{place}</span>
              <span className="flex flex-col items-start gap-2 md:items-end">
                <ShowMap />
                {note}
              </span>
            </span>
          ) : (
            <span className="flex min-h-72 flex-col justify-between gap-10 p-8 group-open:hidden md:p-10">
              <Icon name={icon} size="xl" strokeWidth={1.2} className="text-accent" />
              <span className="block">
                {place}
                <span className="mt-6 block">
                  <ShowMap />
                </span>
                <span className="mt-3 block">{note}</span>
              </span>
            </span>
          )}
          <span className="hidden min-h-14 items-center justify-between gap-4 px-6 py-3 text-body font-semibold text-fg group-open:flex md:px-8">
            {mapCopy.hide}
            <Icon name="close" size="sm" className="text-fg-muted" />
          </span>
        </summary>
        <iframe
          title={title}
          src={mapsEmbedUrl()}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className={cn('block w-full border-0', bar ? 'aspect-[4/3] md:aspect-[21/9]' : 'aspect-[4/3] md:aspect-[16/10]')}
        />
      </details>
    </div>
  );
}
