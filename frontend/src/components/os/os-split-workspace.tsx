'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { Columns2, Focus, GripVertical, X } from 'lucide-react';
import { Modal, ModalPortalProvider } from '@/components/ui/modal';
import { UnsavedWorkScope, useUnsavedWork } from '@/components/workspace/unsaved-work-provider';
import {
  APP_REGISTRY,
  appForPath,
  canOpenApp,
  usesStandalonePosShell,
  type WorkspaceApp,
} from '@/lib/apps';
import { AppGlyph } from './app-glyph';
import { OsCompanionApp, supportsCompanion } from './os-companion-app';
import './os-split-workspace.css';

export const COMPANION_SCOPE = 'os-companion';
export type WorkspacePane = 'primary' | 'companion';

export function OsSplitWorkspace({
  children,
  primaryId,
  primaryName,
  companion,
  onCompanion,
  activePane,
  onActivePane,
  hidden,
  pickerOpen,
  onPickerOpen,
  onPickerClose,
  pickerTrigger,
  hasPermission,
}: {
  children: ReactNode;
  primaryId: string;
  primaryName: string;
  companion: WorkspaceApp | null;
  onCompanion: (app: WorkspaceApp | null) => void;
  activePane: WorkspacePane;
  onActivePane: (pane: WorkspacePane) => void;
  hidden: boolean;
  pickerOpen: boolean;
  onPickerOpen: (trigger: HTMLButtonElement) => void;
  onPickerClose: () => void;
  pickerTrigger: RefObject<HTMLButtonElement | null>;
  hasPermission: (permission: string) => boolean;
}) {
  const { request } = useUnsavedWork();
  const [ratio, setRatio] = useState(50);
  const [focused, setFocused] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const primaryPane = useRef<HTMLDivElement>(null);
  const companionPane = useRef<HTMLElement>(null);
  const resizeOrigin = useRef<number | null>(null);
  const id = useId();
  const single = narrow || focused;
  const primaryHidden = !!companion && single && activePane === 'companion';
  const companionHidden = single && activePane !== 'companion';
  const choices = APP_REGISTRY.filter(
    (app) => supportsCompanion(app.id) && app.id !== primaryId && canOpenApp(app, hasPermission),
  );
  const survivesNavigation = useCallback(
    (href: string) => {
      const pathname = new URL(href, window.location.href).pathname;
      return !usesStandalonePosShell(pathname) && appForPath(pathname)?.id !== companion?.id;
    },
    [companion?.id],
  );

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1000px)');
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  function focusPane(pane: WorkspacePane) {
    onActivePane(pane);
    requestAnimationFrame(() =>
      (pane === 'primary' ? primaryPane.current : companionPane.current)?.focus(),
    );
  }
  function choose(app: WorkspaceApp) {
    // A replaced companion is the only window that closes. The main form stays intact.
    onPickerClose();
    if (app.id === companion?.id) {
      focusPane('companion');
      return;
    }
    request(
      () => {
        onCompanion(app);
        setFocused(false);
        focusPane('companion');
      },
      undefined,
      'close',
      { scope: COMPANION_SCOPE },
    );
  }
  function closeCompanion() {
    request(
      () => {
        onCompanion(null);
        setFocused(false);
        focusPane('primary');
      },
      undefined,
      'close',
      { scope: COMPANION_SCOPE },
    );
  }
  function clamp(value: number) {
    return Math.round(Math.min(65, Math.max(35, value)));
  }
  function resize(clientX: number) {
    const bounds = grid.current?.getBoundingClientRect();
    if (bounds?.width) setRatio(clamp(((clientX - bounds.left) / bounds.width) * 100));
  }

  return (
    <ModalPortalProvider>
      <div
        className="os-workspace-layout"
        hidden={hidden}
        data-paired={!!companion}
        data-single={single}
        onKeyDown={(event) => {
          if (
            !companion ||
            event.key !== 'F6' ||
            (event.target as HTMLElement).closest('[role="dialog"], dialog')
          )
            return;
          event.preventDefault();
          focusPane(activePane === 'primary' ? 'companion' : 'primary');
        }}
      >
        {companion && (
          <div className="os-workspace-strip">
            <div
              className="os-pane-tabs"
              role="group"
              aria-label="Open workspaces"
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const pane =
                  event.key === 'Home' || event.key === 'ArrowLeft' ? 'primary' : 'companion';
                onActivePane(pane);
                event.currentTarget
                  .querySelectorAll<HTMLButtonElement>('button')
                  [pane === 'primary' ? 0 : 1]?.focus();
              }}
            >
              <button
                type="button"
                aria-pressed={activePane === 'primary'}
                aria-controls={`${id}-primary`}
                onClick={() => focusPane('primary')}
              >
                <span className="os-pane-dot" aria-hidden="true" />
                {primaryName}
              </button>
              <button
                type="button"
                aria-pressed={activePane === 'companion'}
                aria-controls={`${id}-companion`}
                onClick={() => focusPane('companion')}
              >
                <span className="os-pane-dot" aria-hidden="true" />
                {companion.label}
              </button>
            </div>
            {!narrow && (
              <button
                type="button"
                className="os-focus-workspace"
                onClick={() => setFocused((value) => !value)}
                aria-pressed={focused}
              >
                {focused ? <Columns2 size={16} /> : <Focus size={16} />}
                <span>{focused ? 'Show both' : 'Focus app'}</span>
              </button>
            )}
          </div>
        )}
        <div
          ref={grid}
          className="os-workspace-grid"
          style={{ '--os-pane-ratio': ratio } as CSSProperties}
        >
          <div
            className="os-workspace-pane"
            data-os-pane="primary"
            data-os-active={activePane === 'primary' || !companion}
            role="region"
            aria-label={`${primaryName} main workspace`}
            id={`${id}-primary`}
            ref={primaryPane}
            tabIndex={-1}
            hidden={primaryHidden}
            inert={primaryHidden || hidden}
            onFocusCapture={() => onActivePane('primary')}
          >
            <UnsavedWorkScope id="os-primary">{children}</UnsavedWorkScope>
          </div>
          {companion && (
            <>
              <div
                role="separator"
                aria-label={`Resize ${primaryName} and ${companion.label}`}
                aria-orientation="vertical"
                aria-valuemin={35}
                aria-valuemax={65}
                aria-valuenow={ratio}
                aria-valuetext={`${primaryName} ${ratio}%, ${companion.label} ${100 - ratio}%`}
                aria-controls={`${id}-primary ${id}-companion`}
                aria-describedby={`${id}-resize-help`}
                tabIndex={0}
                className="os-workspace-divider"
                hidden={single}
                onKeyDown={(event) => {
                  const next =
                    event.key === 'ArrowLeft'
                      ? ratio - 5
                      : event.key === 'ArrowRight'
                        ? ratio + 5
                        : event.key === 'Home'
                          ? 35
                          : event.key === 'End'
                            ? 65
                            : event.key === 'Enter'
                              ? 50
                              : null;
                  if (next === null) return;
                  event.preventDefault();
                  setRatio(clamp(next));
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  resizeOrigin.current = ratio;
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (resizeOrigin.current !== null) resize(event.clientX);
                }}
                onPointerUp={(event) => {
                  if (resizeOrigin.current === null) return;
                  resize(event.clientX);
                  resizeOrigin.current = null;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => {
                  if (resizeOrigin.current !== null) setRatio(resizeOrigin.current);
                  resizeOrigin.current = null;
                }}
                onLostPointerCapture={() => {
                  resizeOrigin.current = null;
                }}
              >
                <GripVertical size={15} aria-hidden="true" />
              </div>
              <section
                className="os-workspace-pane os-companion-pane"
                data-os-pane="companion"
                data-os-active={activePane === 'companion'}
                id={`${id}-companion`}
                ref={companionPane}
                tabIndex={-1}
                aria-label={`${companion.label} companion workspace`}
                hidden={companionHidden}
                inert={companionHidden || hidden}
                onFocusCapture={() => onActivePane('companion')}
              >
                <div className="os-window">
                  <header className="os-titlebar">
                    <AppGlyph app={companion} size="small" />
                    <strong>{companion.label}</strong>
                    <div className="os-window-tools">
                      <button
                        type="button"
                        onClick={(event) => onPickerOpen(event.currentTarget)}
                        aria-label="Change companion app"
                        title="Change companion app"
                      >
                        <Columns2 size={17} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Close ${companion.label} workspace`}
                        title="Close this workspace"
                        onClick={closeCompanion}
                      >
                        <X size={17} />
                      </button>
                    </div>
                  </header>
                  <div className="os-window-body">
                    <div
                      className="os-page os-companion-content"
                      role="main"
                      aria-label={`${companion.label} content`}
                      id={!hidden && activePane === 'companion' ? 'os-content' : undefined}
                      tabIndex={-1}
                    >
                      <UnsavedWorkScope
                        id={COMPANION_SCOPE}
                        survivesNavigation={survivesNavigation}
                      >
                        <OsCompanionApp key={companion.id} appId={companion.id} />
                      </UnsavedWorkScope>
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
        <p id={`${id}-resize-help`} className="sr-only">
          Use left and right arrows to resize. Enter restores equal widths. F6 switches between your
          open workspaces.
        </p>
      </div>
      <Modal
        open={pickerOpen}
        onClose={onPickerClose}
        title="Work side by side"
        subtitle="Keep two apps open together. On a smaller screen, switch between them without closing either."
        returnFocusRef={pickerTrigger}
        size="lg"
      >
        <div className="os-companion-choices">
          {choices.map((app) => (
            <button
              type="button"
              key={app.id}
              onClick={() => choose(app)}
              aria-label={`Open ${app.label} alongside ${primaryName}`}
            >
              <AppGlyph app={app} />
              <span>
                <strong>{app.label}</strong>
                <small>{app.description}</small>
              </span>
              <Columns2 size={18} aria-hidden="true" />
            </button>
          ))}
          {!choices.length && (
            <p>No additional apps are available for side-by-side work with your current access.</p>
          )}
        </div>
      </Modal>
    </ModalPortalProvider>
  );
}
