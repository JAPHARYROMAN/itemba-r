'use client';

import { useState } from 'react';

/**
 * Interactive schematic of the Tunduma trade corridor and the Itemba sites
 * clustered at the Mpemba-Tunduma hub. Not a GPS map — a cinematic diagram
 * built from the group's own site list. Hover, tap or keyboard-focus a pin to
 * read who manages it and what it does. Pin pulse is CSS-driven, so it stops
 * under the global prefers-reduced-motion rule.
 */

type Manager = 'mwanjalisi' | 'westsides' | 'group';

interface Site {
  id: string;
  name: string;
  manager: Manager;
  managerName: string;
  kind: string;
  detail: string;
  x: number;
  y: number;
  side: 'left' | 'right';
}

const ACCENT: Record<Manager, { dot: string; ring: string; chip: string }> = {
  mwanjalisi: {
    dot: '#e8b52e',
    ring: 'rgba(232,181,46,0.9)',
    chip: 'border-amber-400/30 bg-amber-500/15 text-amber-300',
  },
  westsides: {
    dot: '#3b82f6',
    ring: 'rgba(59,130,246,0.9)',
    chip: 'border-blue-400/30 bg-blue-500/15 text-blue-300',
  },
  group: {
    dot: '#10b981',
    ring: 'rgba(16,185,129,0.9)',
    chip: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300',
  },
};

const HUB = { x: 365, y: 322 };

const SITES: Site[] = [
  {
    id: 'mpemba',
    name: 'ITEMBA-MPEMBA',
    manager: 'mwanjalisi',
    managerName: 'Mwanjalisi Oil',
    kind: 'Filling station',
    detail: 'Diesel, petrol, kerosene and lubricants near the Tunduma Bus Station.',
    x: 170,
    y: 232,
    side: 'left',
  },
  {
    id: 'yard',
    name: 'UZUNGUNI PARKING YARD',
    manager: 'mwanjalisi',
    managerName: 'Mwanjalisi Oil',
    kind: 'Parking & staging',
    detail: 'Corridor vehicle staging and overnight parking in Uzunguni Area.',
    x: 132,
    y: 322,
    side: 'left',
  },
  {
    id: 'hardware',
    name: 'ITEMBA-HARDWARE',
    manager: 'westsides',
    managerName: 'Westsides',
    kind: 'Trade & supply',
    detail: 'Building materials, tools and construction equipment for contractors.',
    x: 170,
    y: 412,
    side: 'left',
  },
  {
    id: 'uzunguni',
    name: 'ITEMBA-UZUNGUNI',
    manager: 'mwanjalisi',
    managerName: 'Mwanjalisi Oil',
    kind: 'Filling station',
    detail: 'Fuel and lubricants along the TANZAM Highway in Uzunguni Area.',
    x: 560,
    y: 232,
    side: 'right',
  },
  {
    id: 'inn',
    name: 'UZUNGUNI INN',
    manager: 'westsides',
    managerName: 'Westsides',
    kind: 'Hospitality',
    detail: 'Lodging, restaurant and bar for travellers and corridor traders.',
    x: 598,
    y: 322,
    side: 'right',
  },
  {
    id: 'hq',
    name: 'Group head office',
    manager: 'group',
    managerName: 'Itemba Group',
    kind: 'Headquarters',
    detail: 'Itemba Filling Station, along the Tunduma-Ileje Highway, Mpemba.',
    x: 560,
    y: 412,
    side: 'right',
  },
];

const WAYPOINTS = [
  { label: 'Dar es Salaam', sub: 'Origin of supply', x: 365, y: 54 },
  { label: 'Southern Highlands', sub: 'Mbeya · Iringa', x: 365, y: 150 },
  { label: 'Zambia border', sub: 'DRC · Zimbabwe · Malawi', x: 365, y: 506 },
];

function connector(site: Site) {
  const cx = (HUB.x + site.x) / 2;
  const cy = (HUB.y + site.y) / 2 + (site.side === 'left' ? -22 : 22);
  return `M ${HUB.x} ${HUB.y} Q ${cx} ${cy} ${site.x} ${site.y}`;
}

export default function CorridorMap() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = SITES.find((s) => s.id === activeId) ?? null;

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.45fr_1fr] lg:items-center">
      {/* ── Schematic ───────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-ink-900/60 p-2 sm:p-4">
        <div className="grain-overlay" />
        <svg
          viewBox="0 0 730 560"
          className="relative z-10 w-full"
          role="img"
          aria-label="Schematic map of the Tunduma trade corridor showing Itemba Group sites at the Mpemba-Tunduma hub"
        >
          <defs>
            <linearGradient id="corridorRibbon" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c8860a" stopOpacity="0.05" />
              <stop offset="45%" stopColor="#e8b52e" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#c8860a" stopOpacity="0.05" />
            </linearGradient>
            <radialGradient id="hubGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#e8b52e" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#e8b52e" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* corridor ribbon */}
          <path
            d="M 365 30 C 345 130 385 210 365 322 C 348 430 382 450 365 530"
            fill="none"
            stroke="url(#corridorRibbon)"
            strokeWidth="26"
            strokeLinecap="round"
          />
          <path
            d="M 365 30 C 345 130 385 210 365 322 C 348 430 382 450 365 530"
            fill="none"
            stroke="#e8b52e"
            strokeOpacity="0.55"
            strokeWidth="1.5"
            strokeDasharray="2 7"
            strokeLinecap="round"
          />

          {/* macro waypoints */}
          {WAYPOINTS.map((w) => (
            <g key={w.label}>
              <circle cx={w.x} cy={w.y} r="4.5" fill="#cbd5e1" />
              <circle cx={w.x} cy={w.y} r="9" fill="none" stroke="#cbd5e1" strokeOpacity="0.3" />
              <text x={w.x} y={w.y - 16} textAnchor="middle" className="fill-white" fontSize="14" fontWeight="700">
                {w.label}
              </text>
              <text x={w.x} y={w.y + 22} textAnchor="middle" className="fill-slate-400" fontSize="10.5">
                {w.sub}
              </text>
            </g>
          ))}

          {/* hub glow + label */}
          <circle cx={HUB.x} cy={HUB.y} r="58" fill="url(#hubGlow)" />
          <circle cx={HUB.x} cy={HUB.y} r="7" fill="#e8b52e" />
          <text x={HUB.x} y={HUB.y - 64} textAnchor="middle" className="fill-gold-300" fontSize="11" fontWeight="700" letterSpacing="2">
            TUNDUMA · MPEMBA
          </text>

          {/* connectors */}
          {SITES.map((s) => {
            const on = active?.id === s.id;
            return (
              <path
                key={`c-${s.id}`}
                d={connector(s)}
                fill="none"
                stroke={on ? ACCENT[s.manager].dot : '#ffffff'}
                strokeOpacity={on ? 0.8 : 0.16}
                strokeWidth={on ? 2 : 1.25}
              />
            );
          })}

          {/* site pins */}
          {SITES.map((s) => {
            const a = ACCENT[s.manager];
            const on = active?.id === s.id;
            const labelX = s.side === 'left' ? s.x - 16 : s.x + 16;
            const anchor = s.side === 'left' ? 'end' : 'start';
            return (
              <g
                key={s.id}
                tabIndex={0}
                role="button"
                aria-label={`${s.name} — ${s.kind}, managed by ${s.managerName}`}
                className="cine-pin"
                onMouseEnter={() => setActiveId(s.id)}
                onMouseLeave={() => setActiveId(null)}
                onFocus={() => setActiveId(s.id)}
                onBlur={() => setActiveId(null)}
                onClick={() => setActiveId(s.id)}
              >
                {/* generous transparent hit area */}
                <circle cx={s.x} cy={s.y} r="22" fill="transparent" />
                <circle
                  cx={s.x}
                  cy={s.y}
                  r={on ? 17 : 13}
                  fill={a.dot}
                  fillOpacity="0.16"
                  stroke={a.dot}
                  strokeOpacity={on ? 0.9 : 0.5}
                  style={{ transition: 'all 0.25s ease' }}
                />
                <circle cx={s.x} cy={s.y} r={on ? 6 : 5} fill={a.dot} style={{ transition: 'all 0.25s ease' }} />
                <text
                  x={labelX}
                  y={s.y + 4}
                  textAnchor={anchor}
                  fontSize="12.5"
                  fontWeight={on ? 800 : 600}
                  className={on ? 'fill-white' : 'fill-slate-300'}
                  style={{ transition: 'fill 0.2s ease' }}
                >
                  {s.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* ── Detail panel ────────────────────────────────────────────── */}
      <div className="min-h-[15rem]">
        {active ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-7">
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${ACCENT[active.manager].chip}`}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ACCENT[active.manager].dot }} />
              {active.managerName}
            </span>
            <h3 className="mt-5 font-tight text-2xl font-black leading-tight tracking-tight text-white">
              {active.name}
            </h3>
            <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-gold-400">{active.kind}</p>
            <p className="mt-4 text-base leading-relaxed text-slate-300">{active.detail}</p>
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-white/12 bg-white/[0.02] p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">One hub, six sites</p>
            <h3 className="mt-4 font-tight text-2xl font-black leading-tight tracking-tight text-white">
              Every Itemba site sits on the same corridor.
            </h3>
            <p className="mt-4 text-base leading-relaxed text-slate-400">
              Fuel, parking, hardware, hospitality and logistics — all anchored where the Dar es Salaam supply line
              meets the Tanzania-Zambia border at Tunduma. Hover or tap a pin to explore.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-amber-300">
                Mwanjalisi Oil
              </span>
              <span className="rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-blue-300">
                Westsides
              </span>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-emerald-300">
                Itemba Group
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
