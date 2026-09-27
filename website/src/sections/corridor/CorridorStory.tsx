import type { CSSProperties } from 'react';
import { corridorCopy, corridorHubStopId, corridorSites, corridorStops } from '@/content/corridor';
import { withFlags } from '@/content/flags';
import { cn } from '@/ui/cn';
import { keepCompounds } from '@/ui/text';
import { nodeLabel, routeMap, routeNodes, routeSegments, routeTrack, siteDot } from './geometry';
import './corridor.css';

export type CorridorStoryProps = {
  /** Level of each stop's name (h3 by default), to fit the page outline. */
  stepHeadingLevel?: 3 | 4;
  /** id of the heading that names the story; without one, the list is named from content. */
  labelledBy?: string;
  className?: string;
};

/**
 * The corridor story: Dar es Salaam → Southern Highlands → Mpemba-Tunduma →
 * Tunduma border → Zambia, DRC, Zimbabwe and Malawi. A server component with
 * no client JavaScript; the page supplies the section and its heading.
 *
 * - The accessible content is the ordered list of stops, each with its
 *   note and one sentence; the Mpemba-Tunduma stop lists the six sites.
 * - From `lg`, a drawing of the route sits beside the list (aria-hidden).
 *   Where scroll-driven animations are supported and motion is welcome, it
 *   is sticky scrollytelling: each stop's own view timeline draws the route
 *   up to its node, lights the node and, at the hub, the six sites, while
 *   the stop in view reads in full colour (corridor.css).
 * - Everywhere else (no support, reduced motion, narrow screens, print, no
 *   JS) it is static: the drawing is fully drawn, and below `lg` the list
 *   itself carries the drawn route as a rail with a node per stop.
 */
export function CorridorStory({ stepHeadingLevel = 3, labelledBy, className }: CorridorStoryProps) {
  const sites = withFlags(corridorSites);
  const StopName = `h${stepHeadingLevel}` as const;
  const hub = routeNodes[corridorHubStopId];
  const hubStep = corridorStops.findIndex((stop) => stop.id === corridorHubStopId) + 1;

  return (
    <div className={cn('corridor-story', className)}>
      <div aria-hidden="true" className="corridor-story__figure">
        <svg viewBox={`0 0 ${routeMap.width} ${routeMap.height}`} className="corridor-route" focusable="false">
          <line className="corridor-route__border" x1="16" y1={routeMap.borderY} x2={routeMap.width - 16} y2={routeMap.borderY} />
          <text className="corridor-route__side" x={routeMap.width - 16} y={routeMap.borderY - 10} textAnchor="end">
            {corridorCopy.borderSides.north}
          </text>
          <text className="corridor-route__side" x={routeMap.width - 16} y={routeMap.borderY + 20} textAnchor="end">
            {corridorCopy.borderSides.south}
          </text>

          <path className="corridor-route__track" d={routeTrack} />
          {routeSegments.map((d, index) => (
            <path key={d} className="corridor-route__line" data-step={index + 2} d={d} pathLength={1} />
          ))}

          {/*
            The sites light up with the hub's stop, so they share its step number (and timeline).
            Until then only their hairline ring shows (one quiet circle, not six empty dots).
          */}
          <g data-step={hubStep}>
            {sites.length ? <circle className="corridor-route__ring" cx={hub.x} cy={hub.y} r={routeMap.siteRing} /> : null}
            {sites.map((site, index) => {
              const dot = siteDot(index, sites.length, hub);
              return (
                <circle
                  key={site.id}
                  className="corridor-route__site"
                  data-manager={site.manager}
                  style={{ '--i': index } as CSSProperties}
                  cx={dot.x}
                  cy={dot.y}
                  r={routeMap.siteRadius}
                />
              );
            })}
          </g>

          {corridorStops.map((stop, index) => {
            const node = routeNodes[stop.id];
            const label = nodeLabel(stop.id);
            return (
              <g key={stop.id} className="corridor-route__node" data-step={index + 1} data-hub={stop.id === corridorHubStopId || undefined}>
                <circle cx={node.x} cy={node.y} r={stop.id === corridorHubStopId ? routeMap.hubRadius : routeMap.nodeRadius} />
                <text x={label.x} y={label.y} textAnchor={label.anchor}>
                  {stop.mapLabel}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <ol
        role="list"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : corridorCopy.stopsLabel}
        className="corridor-story__steps"
      >
        {corridorStops.map((stop, index) => (
          <li key={stop.id} className="corridor-step" data-step={index + 1} data-hub={stop.id === corridorHubStopId || undefined}>
            <div>
              <p className="text-eyebrow text-accent-fg">{stop.note}</p>
              <StopName className="corridor-step__title mt-1.5 text-h3 text-fg">{stop.name}</StopName>
              <p className="mt-3 max-w-[34rem] text-body-lg text-fg-muted">{keepCompounds(stop.detail)}</p>
              {stop.id === corridorHubStopId && sites.length ? (
                <ul role="list" className="mt-6 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {sites.map((site) => (
                    <li key={site.id} data-manager={site.manager} className="flex items-start gap-3">
                      <span aria-hidden="true" className="corridor-story__site-dot mt-[0.4375rem] size-2.5 shrink-0 rounded-full" />
                      <span className="min-w-0">
                        <span className="block text-body font-semibold text-fg">{site.name}</span>
                        <span className="block text-caption text-fg-muted">
                          {site.kind} · {site.managerName}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
