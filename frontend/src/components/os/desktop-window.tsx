'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useDragControls, useReducedMotion } from 'motion/react';
import { X, Minus, Maximize2, MoreHorizontal, Grip } from 'lucide-react';
import { AppGlyph } from './app-glyph';
import { WindowModalProvider } from '@/components/ui/modal';
import type { WorkspaceApp } from '@/lib/apps';
import { windowBounds, type Bounds, type DesktopWindow, type WindowMode } from '@/lib/desktop';

const positions: { mode: WindowMode; label: string }[] = [
  { mode: 'floating', label: 'Restore' },
  { mode: 'maximized', label: 'Maximise' },
  { mode: 'left', label: 'Left half' },
  { mode: 'right', label: 'Right half' },
  { mode: 'top-left', label: 'Top left' },
  { mode: 'top-right', label: 'Top right' },
  { mode: 'bottom-left', label: 'Bottom left' },
  { mode: 'bottom-right', label: 'Bottom right' },
];
export function DesktopWindowFrame({
  window: item,
  app,
  active,
  concealed,
  zIndex,
  area,
  narrow,
  onFocus,
  onChange,
  onClose,
  onNew,
  children,
  reduced,
  intensity,
}: {
  window: DesktopWindow;
  app: WorkspaceApp;
  active: boolean;
  concealed: boolean;
  zIndex: number;
  area: { width: number; height: number };
  narrow: boolean;
  onFocus: () => void;
  onChange: (change: Partial<DesktopWindow>) => void;
  onClose: () => void;
  onNew?: () => void;
  children: ReactNode;
  reduced: boolean;
  intensity: number;
}) {
  const controls = useDragControls();
  const prefersReduced = useReducedMotion();
  const noMotion = reduced || !!prefersReduced;
  const [menu, setMenu] = useState(false);
  const [resizing, setResizing] = useState<Bounds | null>(null);
  const [finishedHiding, setFinishedHiding] = useState(concealed);
  const surface = useRef<HTMLElement>(null);
  const [modalTarget, setModalTarget] = useState<HTMLDivElement | null>(null);
  const frame =
    resizing ??
    windowBounds(narrow ? { ...item, mode: 'maximized' } : item, area.width, area.height);
  useEffect(() => {
    if (!concealed) setFinishedHiding(false);
  }, [concealed]);
  useEffect(() => {
    if (!active || concealed) return;
    if (
      !surface.current?.contains(document.activeElement) &&
      (document.activeElement === document.body ||
        document.activeElement?.closest('.desktop-dock, .desktop-launcher, .desktop-overview'))
    )
      surface.current?.focus();
  }, [active, concealed]);
  return (
    <motion.section
      ref={surface}
      className="desktop-window"
      data-active={active}
      data-window-id={item.id}
      role="region"
      aria-label={`${app.label} window`}
      tabIndex={-1}
      aria-hidden={concealed}
      inert={concealed}
      style={{
        zIndex,
        width: frame.width,
        height: frame.height,
        visibility: concealed && finishedHiding ? 'hidden' : 'visible',
        pointerEvents: concealed ? 'none' : 'auto',
      }}
      initial={noMotion ? false : { opacity: 0, scale: 0.94, x: frame.x, y: frame.y + 24 }}
      animate={{
        opacity: concealed ? 0 : 1,
        scale: concealed && !noMotion ? 0.8 : 1,
        x: frame.x,
        y: concealed && !noMotion ? Math.min(area.height - 60, frame.y + 100) : frame.y,
      }}
      transition={
        noMotion
          ? { duration: 0 }
          : { type: 'spring', stiffness: 380 / intensity, damping: 35, mass: 0.8 }
      }
      onAnimationComplete={() => setFinishedHiding(concealed)}
      drag={!narrow && item.mode === 'floating'}
      dragControls={controls}
      dragListener={false}
      dragMomentum={false}
      onDragEnd={(_, info) => {
        const x = frame.x + info.offset.x,
          y = frame.y + info.offset.y;
        const mode: WindowMode =
          y < 12
            ? x < 50
              ? 'top-left'
              : x + frame.width > area.width - 50
                ? 'top-right'
                : 'maximized'
            : x < 12
              ? 'left'
              : x + frame.width > area.width - 12
                ? 'right'
                : 'floating';
        onChange({
          mode,
          bounds: {
            ...frame,
            x: Math.max(8, Math.min(x, area.width - 160)),
            y: Math.max(8, Math.min(y, area.height - 80)),
          },
        });
      }}
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
    >
      <header
        className="desktop-window-titlebar"
        onPointerDown={(event) => {
          if ((event.target as Element).closest('button, select, input')) return;
          if (!narrow && item.mode === 'floating') controls.start(event);
        }}
        onDoubleClick={(event) => {
          if (!(event.target as Element).closest('button'))
            onChange({ mode: item.mode === 'maximized' ? 'floating' : 'maximized' });
        }}
      >
        <div className="desktop-traffic-lights">
          <button aria-label={`Close ${app.label} window`} title="Close window" onClick={onClose}>
            <X size={12} />
          </button>
          <button
            aria-label={`Minimise ${app.label} window`}
            title="Minimise"
            onClick={() => onChange({ minimized: true })}
          >
            <Minus size={12} />
          </button>
          <button
            aria-label={`${item.mode === 'maximized' ? 'Restore' : 'Maximise'} ${app.label} window`}
            title="Maximise or restore"
            onClick={() => onChange({ mode: item.mode === 'maximized' ? 'floating' : 'maximized' })}
          >
            <Maximize2 size={11} />
          </button>
        </div>
        <div className="desktop-window-name">
          <AppGlyph app={app} size="small" />
          <strong>{app.label}</strong>
        </div>
        <button
          className="desktop-icon-button"
          aria-label={`${app.label} window actions`}
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <MoreHorizontal size={20} />
        </button>
      </header>
      {menu && (
        <div
          className="desktop-window-menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMenu(false);
          }}
        >
          <p>Arrange window</p>
          <div>
            {positions.map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => {
                  onChange({ mode });
                  setMenu(false);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {!narrow && (
            <div className="desktop-position-controls">
              <span>Move</span>
              {[
                ['←', -32, 0],
                ['↑', 0, -32],
                ['↓', 0, 32],
                ['→', 32, 0],
              ].map(([label, x, y]) => (
                <button
                  key={label}
                  aria-label={`Move window ${label}`}
                  onClick={() =>
                    onChange({
                      mode: 'floating',
                      bounds: {
                        ...frame,
                        x: Math.max(8, frame.x + Number(x)),
                        y: Math.max(8, frame.y + Number(y)),
                      },
                    })
                  }
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() =>
                  onChange({
                    mode: 'floating',
                    bounds: { ...frame, width: frame.width + 64, height: frame.height + 48 },
                  })
                }
              >
                Larger
              </button>
              <button
                onClick={() =>
                  onChange({
                    mode: 'floating',
                    bounds: { ...frame, width: frame.width - 64, height: frame.height - 48 },
                  })
                }
              >
                Smaller
              </button>
            </div>
          )}
          {onNew && (
            <button
              onClick={() => {
                onNew();
                setMenu(false);
              }}
            >
              New {app.label} window
            </button>
          )}
          <button onClick={() => setMenu(false)}>Done</button>
        </div>
      )}
      <WindowModalProvider target={modalTarget} active={active && !concealed}>
        <div className="desktop-window-content">{children}</div>
      </WindowModalProvider>
      <div className="desktop-window-modals" ref={setModalTarget} />
      {!narrow && item.mode === 'floating' && (
        <button
          className="desktop-resize"
          aria-label={`Resize ${app.label} window`}
          title="Drag to resize, or use arrow keys"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            onChange({
              bounds: {
                ...frame,
                width:
                  frame.width +
                  (event.key === 'ArrowRight' ? 32 : event.key === 'ArrowLeft' ? -32 : 0),
                height:
                  frame.height +
                  (event.key === 'ArrowDown' ? 32 : event.key === 'ArrowUp' ? -32 : 0),
              },
            });
          }}
          onPointerDown={(event) => {
            const target = event.currentTarget;
            target.setPointerCapture(event.pointerId);
            const startX = event.clientX,
              startY = event.clientY,
              start = frame;
            let latest = start;
            const move = (e: PointerEvent) => {
              latest = {
                ...start,
                width: Math.max(
                  480,
                  Math.min(area.width - start.x - 8, start.width + e.clientX - startX),
                ),
                height: Math.max(
                  360,
                  Math.min(area.height - start.y - 8, start.height + e.clientY - startY),
                ),
              };
              setResizing(latest);
            };
            const finish = () => {
              target.removeEventListener('pointermove', move);
              target.removeEventListener('pointerup', finish);
              target.removeEventListener('pointercancel', cancel);
              setResizing(null);
              onChange({ bounds: latest });
            };
            const cancel = () => {
              target.removeEventListener('pointermove', move);
              target.removeEventListener('pointerup', finish);
              target.removeEventListener('pointercancel', cancel);
              setResizing(null);
            };
            target.addEventListener('pointermove', move);
            target.addEventListener('pointerup', finish);
            target.addEventListener('pointercancel', cancel);
          }}
        >
          <Grip size={14} />
        </button>
      )}
    </motion.section>
  );
}
