import React, { useId } from 'react';

interface SparklineProps {
  /** Series values, oldest first. Needs >= 2 points to render. */
  data: number[];
  /** Rendered box; the SVG stretches to its container width. */
  height?: number;
  color?: string;
  strokeWidth?: number;
  /** Soft gradient area under the line. */
  fill?: boolean;
  /** Draw-in animation on mount (auto-disabled by prefers-reduced-motion). */
  animate?: boolean;
  className?: string;
}

const VIEW_W = 100;

/**
 * Dependency-free inline sparkline for KPI cards and table cells. Pure SVG —
 * the draw-in is the aurora-draw-line keyframe in globals.css, so it costs no
 * JS and respects the global reduced-motion guard.
 */
export function Sparkline({
  data,
  height = 28,
  color = 'var(--aurora-primary)',
  strokeWidth = 1.5,
  fill = true,
  animate = true,
  className = '',
}: SparklineProps) {
  const gradientId = useId();
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = strokeWidth + 1;
  const innerH = height - pad * 2;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * VIEW_W;
    const y = pad + (1 - (v - min) / span) * innerH;
    return [x, y] as const;
  });

  // Approximate path length for the dash draw-in (viewBox units).
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    length += Math.hypot(dx, dy);
  }
  length = Math.ceil(length) + 2;

  const polyline = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `M0,${height} L${polyline.replace(/ /g, ' L')} L${VIEW_W},${height} Z`;

  return (
    <svg
      className={className}
      width="100%"
      height={height}
      viewBox={`0 0 ${VIEW_W} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
        </>
      )}
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={
          animate
            ? ({
                strokeDasharray: length,
                '--aurora-draw-length': `${length}`,
                animation: 'aurora-draw-line 0.8s cubic-bezier(0, 0, 0.2, 1) forwards',
              } as React.CSSProperties)
            : undefined
        }
      />
    </svg>
  );
}
