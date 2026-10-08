'use client';
import { Children, useEffect, useRef, useState, type ReactNode } from 'react';
import { useWorkspaceExpansion, WorkspaceExpandButton } from './use-workspace-expansion';
import './workspace-split.css';

/** Keep the inspector beside the list on large screens and open it as a focused view on phones. */
export function WorkspaceSplit({
  children,
  selectedKey,
  onClose,
}: {
  children: ReactNode;
  selectedKey?: string | null;
  onClose: () => void;
}) {
  const [list, details] = Children.toArray(children);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const { expanded, toggle, exitForAction } = useWorkspaceExpansion(surface);
  function close() {
    setDetailsExpanded(false);
    onClose();
    requestAnimationFrame(() => opener.current?.focus());
  }
  useEffect(() => {
    if (!selectedKey) return;
    opener.current = document.activeElement as HTMLElement | null;
    heading.current?.focus();
  }, [selectedKey]);
  return (
    <div
      ref={surface}
      className={`os-workspace-split ${selectedKey ? 'has-selection' : ''} ${selectedKey && detailsExpanded ? 'split-details-expanded' : ''} ${expanded ? 'workspace-expanded' : ''}`}
      onClickCapture={(event) => {
        const target = event.target as HTMLElement;
        if (
          target.closest('a, button[type="submit"], .os-split-detail button') &&
          !target.closest('.os-split-detail > header')
        )
          exitForAction();
      }}
    >
      <div className="os-split-view-controls">
        <WorkspaceExpandButton expanded={expanded} onToggle={toggle} />
      </div>
      <section className="os-split-list" aria-label="Records">
        {list}
      </section>
      <aside
        className="os-split-detail"
        aria-label="Record details"
        hidden={!selectedKey}
        onKeyDown={(event) => {
          if (
            event.key === 'Escape' &&
            !event.defaultPrevented &&
            document.fullscreenElement !== surface.current
          ) {
            event.stopPropagation();
            close();
          }
        }}
      >
        {selectedKey && (
          <header>
            <h2 ref={heading} tabIndex={-1}>
              Record details
            </h2>
            <button
              type="button"
              aria-pressed={detailsExpanded}
              onClick={() => setDetailsExpanded(!detailsExpanded)}
            >
              {detailsExpanded ? 'Show list beside details' : 'Expand record details'}
            </button>
            <button type="button" onClick={close}>
              Back to list
            </button>
          </header>
        )}
        {details}
      </aside>
    </div>
  );
}
