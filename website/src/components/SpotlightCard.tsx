'use client';

import { useRef, useState, MouseEvent, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
  spotlightColor?: string;
}

/**
 * Wraps content in a card that reveals a soft radial spotlight following
 * the cursor on desktop. Disabled on touch devices via @media (hover: none).
 */
export default function SpotlightCard({
  children,
  className = '',
  spotlightColor = 'rgba(255, 255, 255, 0.08)',
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const [active, setActive] = useState(false);

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    });
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      className={`relative ${className}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-500 hidden md:block"
        style={{
          opacity: active ? 1 : 0,
          background: `radial-gradient(600px circle at ${pos.x}% ${pos.y}%, ${spotlightColor}, transparent 40%)`,
        }}
      />
      {children}
    </div>
  );
}
