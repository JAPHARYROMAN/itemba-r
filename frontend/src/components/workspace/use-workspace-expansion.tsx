'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import './workspace.css';

/** Expand the existing DOM so selection, scroll positions and form drafts survive. */
export function useWorkspaceExpansion(surface: RefObject<HTMLElement | null>) {
  const [expanded, setExpanded] = useState(false);
  const ownedFullscreen = useRef(false);
  const restoreFocus = useRef(true);
  const trigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function changed() {
      if (document.fullscreenElement === surface.current) {
        ownedFullscreen.current = true;
        setExpanded(true);
      } else if (ownedFullscreen.current) {
        ownedFullscreen.current = false;
        setExpanded(false);
        if (restoreFocus.current) trigger.current?.focus();
      }
    }
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, [surface]);

  async function toggle(opener: HTMLElement) {
    restoreFocus.current = true;
    if (expanded) {
      if (document.fullscreenElement === surface.current) await document.exitFullscreen();
      else setExpanded(false);
      opener.focus();
      return;
    }
    trigger.current = opener;
    // Embedded browsers can deny fullscreen. The in-page expanded layout still works.
    setExpanded(true);
    try {
      await surface.current?.requestFullscreen?.();
    } catch {
      // Keep the expanded layout in the current app window.
      setExpanded(true);
    }
  }

  function exitForAction() {
    if (document.fullscreenElement === surface.current) {
      // Page-level dialogs and navigation must be visible outside the fullscreen element.
      restoreFocus.current = false;
      void document.exitFullscreen().catch(() => undefined);
    }
  }

  return { expanded, toggle, exitForAction };
}

export function WorkspaceExpandButton({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: (opener: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      className="workspace-expand-button"
      aria-pressed={expanded}
      onClick={(event) => onToggle(event.currentTarget)}
    >
      {expanded ? <Minimize2 size={15} aria-hidden /> : <Maximize2 size={15} aria-hidden />}
      {expanded ? 'Restore view' : 'Expand view'}
    </button>
  );
}
