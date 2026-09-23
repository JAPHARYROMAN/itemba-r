'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Search, X } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { AppGlyph } from './app-glyph';
import type { WorkspaceApp } from '@/lib/apps';

export function OsAppSwitcher({
  open,
  onClose,
  apps,
  recentIds,
  activeAppId,
  onOpen,
}: {
  open: boolean;
  onClose: () => void;
  apps: readonly WorkspaceApp[];
  recentIds: readonly string[];
  activeAppId: string | null;
  onOpen: (app: WorkspaceApp) => void;
}) {
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const helpId = useId();
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);
  function choose(app: WorkspaceApp) {
    onClose();
    onOpen(app);
  }
  function clearSearch() {
    setQuery('');
    search.current?.focus();
  }
  const sorted = [...apps].sort((a, b) => {
    const rank = (id: string) =>
      recentIds.includes(id) ? recentIds.indexOf(id) : recentIds.length;
    return rank(a.id) - rank(b.id);
  });
  const visible = sorted.filter((app) =>
    [app.label, app.description, ...app.keywords]
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Switch apps"
      subtitle="Find an app and pick up your work. Ctrl / ⌘ + Shift + Space"
      size="lg"
    >
      <div className="os-switcher" data-os-switcher>
        <div className="os-switcher-search">
          <Search size={19} aria-hidden="true" />
          <input
            autoFocus
            ref={search}
            type="search"
            aria-label="Find an app to switch to"
            aria-describedby={helpId}
            placeholder="Find an app…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.repeat) return;
              if (event.key === 'Enter' && visible[0]) {
                event.preventDefault();
                choose(visible[0]);
              } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const buttons = results.current?.querySelectorAll('button');
                buttons?.[event.key === 'ArrowDown' ? 0 : buttons.length - 1]?.focus();
              }
            }}
          />
          {query && (
            <button type="button" onClick={clearSearch} aria-label="Clear app search">
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="os-switcher-summary" role="status" aria-live="polite">
          {visible.length} {visible.length === 1 ? 'app' : 'apps'}
          <span>{query.trim() ? 'Matching your search' : 'Recently used first'}</span>
        </div>
        <div
          className="os-switcher-results"
          ref={results}
          onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            const buttons = Array.from(results.current?.querySelectorAll('button') ?? []);
            const index = buttons.indexOf(event.target as HTMLButtonElement);
            if (index < 0) return;
            event.preventDefault();
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                    buttons.length;
            buttons[next]?.focus();
            buttons[next]?.scrollIntoView?.({ block: 'nearest' });
          }}
        >
          {visible.map((app) => (
            <button key={app.id} type="button" onClick={() => choose(app)}>
              <AppGlyph app={app} />
              <span>
                <strong>{app.label}</strong>
                <small>{app.description}</small>
              </span>
              {app.id === activeAppId ? (
                <em>Current</em>
              ) : (
                <ArrowUpRight size={16} aria-hidden="true" />
              )}
            </button>
          ))}
          {!visible.length && (
            <div className="os-switcher-empty">
              <Search size={24} aria-hidden="true" />
              <p>No apps match “{query}”.</p>
              <button type="button" onClick={clearSearch}>
                Show all apps
              </button>
            </div>
          )}
        </div>
        <p className="os-switcher-help" id={helpId}>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Browse
          </span>
          <span>
            <kbd>Enter</kbd> Open
          </span>
          <span>
            <kbd>Esc</kbd> Close
          </span>
        </p>
      </div>
    </Modal>
  );
}
