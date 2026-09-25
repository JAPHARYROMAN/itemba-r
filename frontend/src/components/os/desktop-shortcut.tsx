'use client';
import { useLayoutEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { motion, useMotionValue } from 'motion/react';

/** Keep saved desktop coordinates separate from temporary viewport fitting. */
export function DesktopShortcut({
  position,
  area,
  narrow,
  onMove,
  onContextMenu,
  children,
}: {
  position: { x: number; y: number };
  area: { width: number; height: number };
  narrow: boolean;
  onMove: (x: number, y: number) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const x = useMotionValue(position.x);
  const y = useMotionValue(position.y);
  const dragged = useRef(false);
  const right = Math.max(0, area.width - 116);
  // Leave the desktop footer controls clear, even when fitting a saved larger layout.
  const bottom = Math.max(0, area.height - 160);
  useLayoutEffect(() => {
    x.set(narrow ? 0 : Math.max(0, Math.min(position.x, right)));
    y.set(narrow ? 0 : Math.max(0, Math.min(position.y, bottom)));
  }, [position.x, position.y, narrow, right, bottom, x, y]);
  return (
    <motion.div
      className="desktop-shortcut"
      drag={!narrow}
      dragMomentum={false}
      dragElastic={0}
      dragConstraints={{ left: 0, right, top: 0, bottom }}
      style={{ x, y }}
      onPointerDownCapture={() => {
        dragged.current = false;
      }}
      onDragStart={() => {
        dragged.current = true;
      }}
      onClickCapture={(event) => {
        if (dragged.current && event.detail > 0) {
          event.preventDefault();
          event.stopPropagation();
        }
        dragged.current = false;
      }}
      onDragEnd={() =>
        onMove(Math.max(0, Math.min(x.get(), right)), Math.max(0, Math.min(y.get(), bottom)))
      }
      onContextMenu={onContextMenu}
    >
      {children}
    </motion.div>
  );
}
