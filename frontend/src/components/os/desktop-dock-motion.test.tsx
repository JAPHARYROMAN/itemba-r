import { render } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import {
  DockIcon,
  DockMotionProvider,
  dockBounceFrames,
  dockScaleAt,
  useDockMotion,
} from './desktop-dock-motion';

describe('dock magnification', () => {
  it('is largest under the pointer and fades to rest at the reach', () => {
    expect(dockScaleAt(0)).toBeCloseTo(1.42);
    expect(dockScaleAt(75)).toBeGreaterThan(1);
    expect(dockScaleAt(75)).toBeLessThan(dockScaleAt(30));
    expect(dockScaleAt(-75)).toBe(dockScaleAt(75));
    expect(dockScaleAt(150)).toBe(1);
    expect(dockScaleAt(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('dock launch bounce', () => {
  it('moves away from whichever edge the dock sits on, and settles', () => {
    expect(Math.min(...dockBounceFrames('bottom'))).toBeLessThan(0); // up
    expect(Math.max(...dockBounceFrames('left'))).toBeGreaterThan(0); // right
    expect(Math.min(...dockBounceFrames('right'))).toBeLessThan(0); // left
    for (const edge of ['bottom', 'left', 'right'] as const) {
      expect(dockBounceFrames(edge).at(-1)).toBe(0);
    }
  });
});

function Dock({ still, magnify }: { still: boolean; magnify: boolean }) {
  const dock = useDockMotion({ edge: 'bottom', magnify, still });
  useEffect(() => {
    dock.value.pointer.set(10);
  }, [dock.value.pointer]);
  return (
    <nav {...dock.handlers}>
      <DockMotionProvider value={dock.value}>
        <DockIcon>
          <span>icon</span>
        </DockIcon>
      </DockMotionProvider>
    </nav>
  );
}

describe('dock motion settings', () => {
  it('never magnifies when motion is reduced or magnification is off', () => {
    const { container, rerender } = render(<Dock still magnify />);
    const face = () => container.querySelector('.desktop-dock-icon-face') as HTMLElement;
    expect(face().style.transform).not.toMatch(/scale\((?!1\))/);
    rerender(<Dock still={false} magnify={false} />);
    expect(face().style.transform).not.toMatch(/scale\((?!1\))/);
  });
});
