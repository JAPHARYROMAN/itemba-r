import { corridorCopy, corridorSites } from '@/content/corridor';
import { withFlags } from '@/content/flags';
import { cn } from '@/ui/cn';
import { hubMap, pinGeometry } from './geometry';
import './corridor.css';

export type CorridorMapProps = {
  /** Level of each site's name (h3 by default), to fit the page outline. */
  headingLevel?: 3 | 4 | 5;
  /** id of the heading that names the site list; without one, the list is named from content. */
  labelledBy?: string;
  className?: string;
};

/**
 * The Mpemba-Tunduma hub and the six Itemba sites around it. A server
 * component with no client JavaScript.
 *
 * - The accessible content is the ordered list: every site's name, what it
 *   is, which company runs it and what it does, all visible.
 * - The drawing beside it is decorative (aria-hidden): numbered pins in each
 *   company's colour around the hub, on the corridor from Dar es Salaam to
 *   the Zambia border. The numbers match the list.
 * - Pointing at a site in the list or at its pin lifts both (CSS :has(),
 *   src/sections/corridor/corridor.css); nothing depends on it.
 * - The group head office is drawn in group gold, never in a company colour.
 */
export function CorridorMap({ headingLevel = 3, labelledBy, className }: CorridorMapProps) {
  const sites = withFlags(corridorSites);
  const SiteName = `h${headingLevel}` as const;
  const { width, height, center, hubRadius, pinRadius, spine } = hubMap;

  return (
    <div className={cn('corridor-map grid items-start gap-10 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-14', className)}>
      <div aria-hidden="true" className="mx-auto w-full max-w-[26rem] md:sticky md:top-[calc(var(--sticky-top,var(--nav-height))+2rem)]">
        <svg viewBox={`0 0 ${width} ${height}`} className="corridor-map__svg block h-auto w-full" focusable="false">
          {/* The spine stops at the hub's rim, so it never crosses the hub's label. */}
          <line className="corridor-map__spine" x1={center.x} y1={spine.top} x2={center.x} y2={center.y - hubRadius - 6} />
          <line className="corridor-map__spine" x1={center.x} y1={center.y + hubRadius + 6} x2={center.x} y2={spine.bottom} />
          <text className="corridor-map__terminus" x={center.x} y={spine.top - 18} textAnchor="middle">
            {corridorCopy.termini.north}
          </text>
          <text className="corridor-map__terminus" x={center.x} y={spine.bottom + 26} textAnchor="middle">
            {corridorCopy.termini.south}
          </text>

          {sites.map((site) => {
            const { spoke } = pinGeometry(site.id);
            return <line key={`spoke-${site.id}`} className="corridor-map__spoke" data-site={site.id} data-manager={site.manager} {...spoke} />;
          })}

          <circle className="corridor-map__hub" cx={center.x} cy={center.y} r={hubRadius} />
          {corridorCopy.hubLines.map((line, index) => (
            <text
              key={line}
              className="corridor-map__hub-label"
              x={center.x}
              y={center.y + (index - (corridorCopy.hubLines.length - 1) / 2) * 19}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {line}
            </text>
          ))}

          {sites.map((site, index) => {
            const pin = pinGeometry(site.id);
            return (
              <g key={site.id} className="corridor-map__pin" data-site={site.id} data-manager={site.manager}>
                <circle cx={pin.x} cy={pin.y} r={pinRadius} />
                <text x={pin.x} y={pin.y} textAnchor="middle" dominantBaseline="central">
                  {index + 1}
                </text>
              </g>
            );
          })}
        </svg>
        <ul className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-caption text-fg-muted">
          {corridorCopy.legend.map((item) => (
            <li key={item.manager} data-manager={item.manager} className="inline-flex items-center gap-2">
              <span className="corridor-map__swatch size-2.5 shrink-0 rounded-full" />
              {item.label}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-center text-legal text-fg-muted">{corridorCopy.schematicNote}</p>
      </div>

      <ol
        role="list"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : corridorCopy.sitesLabel}
        className="border-b border-line"
      >
        {sites.map((site, index) => (
          <li key={site.id} data-site={site.id} data-manager={site.manager} className="corridor-site flex gap-4 border-t border-line px-2 py-5 md:gap-5">
            <span aria-hidden="true" className="corridor-site__marker mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-caption font-semibold tabular-nums text-fg">
              {index + 1}
            </span>
            <div className="min-w-0">
              <SiteName className="text-body-lg font-semibold text-fg">{site.name}</SiteName>
              <p className="mt-0.5 text-caption text-fg-muted">
                {site.kind} · {site.managerName}
              </p>
              <p className="mt-2 text-body text-fg-muted">{site.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
