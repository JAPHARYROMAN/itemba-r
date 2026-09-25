'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useDragControls, useReducedMotion } from 'motion/react';
import { X, Minus, Maximize2, MoreHorizontal, Grip } from 'lucide-react';
import { AppGlyph } from './app-glyph';
import { WindowModalProvider } from '@/components/ui/modal';
import { WindowNavigationProvider } from './window-navigation-context';
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
function dockAnchor(appId: string) {
  if (typeof document === 'undefined') return null;
  const icon = document.querySelector<HTMLElement>('[data-dock-app="' + appId + '"]');
  const workspace = document.getElementById('desktop-workspace');
  if (!icon || !workspace) return null;
  const target = icon.getBoundingClientRect(),
    area = workspace.getBoundingClientRect();
  return {
    x: target.left - area.left + target.width / 2,
    y: target.top - area.top + target.height / 2,
    width: target.width,
  };
}
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
  contextLabel,
  focusRequest = 0,
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
  contextLabel?: string;
  focusRequest?: number;
}) {
  const controls = useDragControls();
  const prefersReduced = useReducedMotion();
  const noMotion = reduced || !!prefersReduced;
  const [menu, setMenu] = useState(false);
  const [resizing, setResizing] = useState<Bounds | null>(null);
  const [finishedHiding, setFinishedHiding] = useState(concealed);
  const [anchor, setAnchor] = useState(() => dockAnchor(app.id));
  const surface = useRef<HTMLElement>(null);
  const menuTarget = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const closeMenu = () => {
    setMenu(false);
    menuTrigger.current?.focus();
  };
  const lastFocus = useRef<HTMLElement | null>(null);
  const [modalTarget, setModalTarget] = useState<HTMLDivElement | null>(null);
  const [navigationTarget, setNavigationTarget] = useState<HTMLDivElement | null>(null);
  const frame =
    resizing ??
    windowBounds(narrow ? { ...item, mode: 'maximized' } : item, area.width, area.height);
  useEffect(() => {
    setAnchor(dockAnchor(app.id));
  }, [app.id, item.minimized, area.width, area.height]);
  const dockPosition = anchor
    ? {
        x: anchor.x - frame.width / 2,
        y: anchor.y - frame.height / 2,
        scale: Math.max(0.04, Math.min(0.2, anchor.width / frame.width)),
      }
    : { x: frame.x, y: Math.min(area.height - 60, frame.y + 100), scale: 0.8 };
  const hiddenPosition = item.minimized
    ? dockPosition
    : { x: frame.x, y: frame.y + 16, scale: 0.96 };
  useEffect(() => {
    if (!menu) return;
    menuTarget.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuTarget.current?.contains(target) && !menuTrigger.current?.contains(target))
        setMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenu(false);
      menuTrigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [menu]);
  useEffect(() => {
    if (concealed || !active) setMenu(false);
  }, [concealed, active]);
  useEffect(() => {
    if (!concealed) setFinishedHiding(false);
  }, [concealed]);
  useEffect(() => {
    if (!focusRequest || !active || concealed) return;
    const target = lastFocus.current;
    if (
      target?.isConnected &&
      !target.matches(':disabled') &&
      !target.closest('[inert], [aria-hidden="true"]')
    )
      target.focus();
    else surface.current?.focus();
  }, [focusRequest, active, concealed]);
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
      aria-describedby={contextLabel ? `${item.id}-context` : undefined}
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
      initial={noMotion ? false : { opacity: 0, ...dockPosition }}
      animate={{
        opacity: concealed ? 0 : 1,
        scale: concealed && !noMotion ? hiddenPosition.scale : 1,
        x: concealed && !noMotion ? hiddenPosition.x : frame.x,
        y: concealed && !noMotion ? hiddenPosition.y : frame.y,
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
      onPointerDownCapture={(event) => {
        if (!(event.target as Element).closest('[data-window-dismiss]')) onFocus();
      }}
      onFocusCapture={(event) => {
        if (event.target !== surface.current) lastFocus.current = event.target as HTMLElement;
        if (!(event.target as Element).closest('[data-window-dismiss]')) onFocus();
      }}
    >
      <header
        className="desktop-window-titlebar"
        onPointerDown={(event) => {
          if ((event.target as Element).closest('button, a, nav, select, input')) return;
          if (!narrow && item.mode === 'floating') controls.start(event);
        }}
        onDoubleClick={(event) => {
          if (!narrow && !(event.target as Element).closest('button, a, nav'))
            onChange({ mode: item.mode === 'maximized' ? 'floating' : 'maximized' });
        }}
      >
        <div className="desktop-traffic-lights">
          <button
            data-window-dismiss
            aria-label={`Close ${app.label} window`}
            title="Close window"
            onClick={onClose}
          >
            <X size={12} />
          </button>
          <button
            aria-label={`Minimise ${app.label} window`}
            data-window-dismiss
            title="Minimise"
            onClick={() => onChange({ minimized: true })}
          >
            <Minus size={12} />
          </button>
          <button
            aria-label={`${item.mode === 'maximized' ? 'Restore' : 'Maximise'} ${app.label} window`}
            title={narrow ? 'Full-size on this display' : 'Maximise or restore'}
            disabled={narrow}
            onClick={() => onChange({ mode: item.mode === 'maximized' ? 'floating' : 'maximized' })}
          >
            <Maximize2 size={11} />
          </button>
        </div>
        <div className="desktop-window-name">
          <AppGlyph app={app} size="small" />
          <strong>{app.label}</strong>
          {contextLabel && (
            <span id={`${item.id}-context`} className="desktop-window-context">
              {contextLabel}
            </span>
          )}
        </div>
        <div className="desktop-window-navigation" ref={setNavigationTarget} />
        <button
          ref={menuTrigger}
          className="desktop-icon-button"
          aria-label={`${app.label} window actions`}
          aria-haspopup="menu"
          aria-controls={menu ? `${item.id}-actions` : undefined}
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <MoreHorizontal size={20} />
        </button>
      </header>
      {menu && (
        <div
          ref={menuTarget}
          id={`${item.id}-actions`}
          role="menu"
          aria-label={`${app.label} window actions`}
          className="desktop-window-menu"
          onBlurCapture={(event) => {
            if (
              event.relatedTarget &&
              !event.currentTarget.contains(event.relatedTarget as Node) &&
              event.relatedTarget !== menuTrigger.current
            )
              setMenu(false);
          }}
          onKeyDown={(e) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault();
            const options = Array.from(
              e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
            );
            const current = options.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? options.length - 1
                  : (current + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
            options[next]?.focus();
          }}
        >
          <p>{narrow ? 'One full-size app at a time on this display.' : 'Arrange window'}</p>
          {!narrow && (
            <div>
              {positions.map(({ mode, label }) => (
                <button
                  role="menuitem"
                  key={mode}
                  onClick={() => {
                    onChange({ mode });
                    closeMenu();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
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
                  role="menuitem"
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
                role="menuitem"
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
                role="menuitem"
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
              role="menuitem"
              onClick={() => {
                onNew();
                setMenu(false);
              }}
            >
              New {app.label} window
            </button>
          )}
          <button role="menuitem" onClick={closeMenu}>
            Done
          </button>
        </div>
      )}
      <WindowModalProvider target={modalTarget} active={active && !concealed}>
        <WindowNavigationProvider target={navigationTarget}>
          <div className="desktop-window-content">{children}</div>
        </WindowNavigationProvider>
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
