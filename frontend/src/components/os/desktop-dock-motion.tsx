'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from 'motion/react';

/**
 * Dock motion: icons swell as the pointer passes (and push their neighbours
 * apart, so nothing overlaps), and an app bounces when it launches. Off when
 * motion is reduced; magnification is also off in narrow mode, where the dock
 * is a compact scrolling strip, and for touch, where there is no hover.
 */
export type DockEdge = 'bottom' | 'left' | 'right';

type DockMotion = {
  pointer: MotionValue<number>;
  edge: DockEdge;
  magnify: boolean;
  still: boolean;
};

const DockMotionContext = createContext<DockMotion | null>(null);

/** How far from the pointer (px) an icon still swells, and by how much at most. */
const REACH = 150;
const PEAK = 1.42;
const SPRING = { stiffness: 420, damping: 30, mass: 0.25 };
/** Launch bounce, in px away from the dock's edge. */
const BOUNCE = [0, -20, 0, -9, 0, -3, 0];

/** How much an icon this far (px) from the pointer is scaled: a cosine falloff. */
export function dockScaleAt(distance: number): number {
  if (!Number.isFinite(distance) || Math.abs(distance) >= REACH) return 1;
  return 1 + (PEAK - 1) * Math.cos((Math.abs(distance) / REACH) * (Math.PI / 2));
}

/** The launch bounce as offsets on the axis away from the dock's edge. */
export function dockBounceFrames(edge: DockEdge): number[] {
  if (edge === 'bottom') return BOUNCE; // y: negative is up, away from the bottom
  // x: away from the side (`|| 0` keeps rest frames at 0, not -0)
  return BOUNCE.map((px) => (edge === 'left' ? -px : px) || 0);
}

export function useDockMotion({
  edge,
  magnify,
  still,
}: {
  edge: DockEdge;
  magnify: boolean;
  still: boolean;
}) {
  const pointer = useMotionValue(Number.POSITIVE_INFINITY);
  const value = useMemo<DockMotion>(
    () => ({ pointer, edge, magnify: magnify && !still, still }),
    [pointer, edge, magnify, still],
  );
  useEffect(() => {
    if (!value.magnify) pointer.set(Number.POSITIVE_INFINITY);
  }, [pointer, value.magnify]);
  const handlers = {
    onPointerMove(event: PointerEvent) {
      if (event.pointerType !== 'mouse' || !value.magnify) return;
      pointer.set(edge === 'bottom' ? event.clientX : event.clientY);
    },
    onPointerLeave() {
      pointer.set(Number.POSITIVE_INFINITY);
    },
  };
  return { value, handlers };
}

export function DockMotionProvider({
  value,
  children,
}: {
  value: DockMotion;
  children: ReactNode;
}) {
  return <DockMotionContext.Provider value={value}>{children}</DockMotionContext.Provider>;
}

/**
 * Wraps one dock icon. The outer box grows along the dock by the same factor
 * the icon scales, so neighbours make room; the icon scales from the dock's
 * edge, so it swells out of the dock like the one it imitates. `bounce` is a
 * counter: each increase plays the launch bounce once.
 */
export function DockIcon({ children, bounce = 0 }: { children: ReactNode; bounce?: number }) {
  const motionContext = useContext(DockMotionContext);
  const box = useRef<HTMLSpanElement>(null);
  const icon = useRef<HTMLSpanElement>(null);
  const idle = useMotionValue(Number.POSITIVE_INFINITY);
  const pointer = motionContext?.pointer ?? idle;
  const edge = motionContext?.edge ?? 'bottom';
  const magnify = motionContext?.magnify ?? false;
  const still = motionContext?.still ?? true;

  const target = useTransform(pointer, (at) => {
    const el = box.current;
    if (!magnify || !el || !Number.isFinite(at)) return 1;
    const rect = el.getBoundingClientRect();
    const centre = edge === 'bottom' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
    return dockScaleAt(at - centre);
  });
  const scale = useSpring(target, SPRING);
  // offsetWidth/Height ignore transforms, so this is the icon's resting size.
  const along = useTransform(scale, (factor) => {
    const el = icon.current;
    const rest = el ? (edge === 'bottom' ? el.offsetWidth : el.offsetHeight) : 0;
    return rest ? rest * factor : 'auto';
  });

  const lift = useMotionValue(0);
  // Play each increase once: not on mount, not again when the edge changes,
  // and not twice under React's development double-run of effects.
  const played = useRef(bounce);
  useEffect(() => {
    if (bounce === played.current) return;
    played.current = bounce;
    if (still) return;
    const run = animate(lift, dockBounceFrames(edge), { duration: 0.8, ease: 'easeOut' });
    return () => {
      run.stop();
      lift.set(0);
    };
  }, [bounce, edge, lift, still]);

  const origin = edge === 'bottom' ? '50% 100%' : edge === 'left' ? '0% 50%' : '100% 50%';
  return (
    <motion.span
      ref={box}
      className="desktop-dock-icon"
      style={
        edge === 'bottom' ? { width: still ? 'auto' : along } : { height: still ? 'auto' : along }
      }
    >
      <motion.span
        ref={icon}
        className="desktop-dock-icon-face"
        style={{
          scale: still ? 1 : scale,
          transformOrigin: origin,
          ...(edge === 'bottom' ? { y: still ? 0 : lift } : { x: still ? 0 : lift }),
        }}
      >
        {children}
      </motion.span>
    </motion.span>
  );
}
