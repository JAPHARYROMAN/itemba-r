import React from 'react';

interface MiniTrendLineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  className?: string;
}

export function MiniTrendLine({
  data,
  width = 100,
  height = 32,
  color = 'var(--aurora-primary)',
  fill = true,
  className = '',
}: MiniTrendLineProps) {
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className={className} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return [x, y] as [number, number];
  });

  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
  const fillPath = `${path} L${width},${height} L0,${height} Z`;

  return (
    <svg width={width} height={height} className={className} style={{ overflow: 'visible' }}>
      {fill && <path d={fillPath} fill={color} fillOpacity="0.1" />}
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
