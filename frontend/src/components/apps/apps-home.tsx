'use client';

import Link from 'next/link';
import { useState, type MouseEvent } from 'react';
import { ArrowUpRight, Clock3, LayoutGrid, Search, Star, X, SlidersHorizontal } from 'lucide-react';
import { AppIcon } from '@/components/ui/icon-set';
import { AppGlyph } from '@/components/os/app-glyph';
import { motion } from 'motion/react';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspacePreferences } from '@/hooks/use-workspace-preferences';
import { APP_REGISTRY, canOpenApp, type WorkspaceApp } from '@/lib/apps';
import styles from './apps-desktop.module.css';

type Props = {
  onOpenApp?: (app: WorkspaceApp) => void;
  onOpenErp?: () => void;
  onOpenSettings?: () => void;
  onOpenFuel?: () => void;
};

export function AppsHome({ onOpenApp, onOpenErp, onOpenSettings, onOpenFuel }: Props = {}) {
  const { user, hasPermission, loading } = useAuth();
  const { preferences: workspace, update } = useWorkspacePreferences(user?.id);
  const [query, setQuery] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [category, setCategory] = useState('All categories');
  const handler = (app: WorkspaceApp) =>
    onOpenApp
      ? () => onOpenApp(app)
      : app.launch.kind === 'workspace'
        ? onOpenErp
        : app.launch.kind === 'settings'
          ? onOpenSettings
          : app.launch.kind === 'external'
            ? onOpenFuel
            : undefined;
  const available = loading
    ? []
    : APP_REGISTRY.filter(
        (app) =>
          canOpenApp(app, hasPermission) &&
          (app.launch.kind === 'route' || app.launch.kind === 'external' || handler(app)),
      );
  const pinned = new Set(workspace.pinnedApps);
  const togglePin = (id: string) =>
    update((current) => ({
      ...current,
      pinnedApps: current.pinnedApps.includes(id)
        ? current.pinnedApps.filter((value) => value !== id)
        : [...current.pinnedApps, id],
    }));
  const search = query.trim().toLowerCase();
  const visible = available.filter(
    (app) =>
      (!pinnedOnly || pinned.has(app.id)) &&
      (category === 'All categories' || app.category === category) &&
      [app.label, app.description, app.category, ...app.keywords].some((value) =>
        value.toLowerCase().includes(search),
      ),
  );
  const recentApps = workspace.recentApps
    .flatMap((id) => available.filter((app) => app.id === id))
    .slice(0, 4);
  const onLink = (event: MouseEvent<HTMLAnchorElement>, app: WorkspaceApp) => {
    const open = handler(app);
    if (open && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      open();
    }
  };
  return (
    <div className={styles.home}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>ITEMBA OS</div>
          <h1>Your workspace.</h1>
          <p>Everything you need. A little more room to think.</p>
        </div>
        <div className={styles.headerTools}>
          {onOpenSettings && (
            <button type="button" className={styles.personalize} onClick={onOpenSettings}>
              <SlidersHorizontal size={16} aria-hidden="true" /> Personalise
            </button>
          )}
          <div className={styles.search}>
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search apps"
              placeholder="Find an app…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      </header>
      <section className={styles.desktop} aria-label="App library" aria-busy={loading}>
        <div className={styles.toolbar}>
          <div className={styles.filters} role="group" aria-label="Filter apps">
            <button type="button" aria-pressed={!pinnedOnly} onClick={() => setPinnedOnly(false)}>
              <LayoutGrid size={15} aria-hidden="true" /> All apps
            </button>
            <button type="button" aria-pressed={pinnedOnly} onClick={() => setPinnedOnly(true)}>
              <Star size={15} aria-hidden="true" /> Pinned
            </button>
          </div>
          <div className={styles.catalogTools}>
            <select
              aria-label="App category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option>All categories</option>
              {[...new Set(available.map((app) => app.category))].map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
            <span className={styles.count} role="status">
              {loading
                ? 'Loading apps…'
                : `${visible.length} ${visible.length === 1 ? 'app' : 'apps'}`}
            </span>
          </div>
        </div>
        {loading ? (
          <div className={styles.empty}>
            <LayoutGrid size={30} aria-hidden="true" />
            <h2>Getting your apps ready</h2>
          </div>
        ) : !available.length ? (
          <div className={styles.empty}>
            <LayoutGrid size={30} aria-hidden="true" />
            <h2>Your workspace starts here</h2>
            <p>Apps will appear here when they’re available to your account.</p>
          </div>
        ) : !visible.length ? (
          <div className={styles.empty}>
            {search ? (
              <Search size={30} aria-hidden="true" />
            ) : (
              <Star size={30} aria-hidden="true" />
            )}
            <h2>{search ? 'No matching apps' : 'Keep your go-to apps close'}</h2>
            <p>
              {search
                ? 'Try a different name or keyword.'
                : 'Use the star on an app to keep it here.'}
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setPinnedOnly(false);
                setCategory('All categories');
              }}
            >
              Show all apps
            </button>
          </div>
        ) : (
          <ul className={styles.grid}>
            {visible.map((app) => {
              const system = app.launch.kind === 'workspace' || app.launch.kind === 'settings';
              const contents = (
                <>
                  <AppGlyph app={app} size="large" />
                  <span className={styles.appName}>
                    {app.label}
                    {!system && <ArrowUpRight size={14} aria-hidden="true" />}
                  </span>
                  <span className={styles.description}>{app.description}</span>
                  {!system && <span className={styles.category}>{app.category}</span>}
                </>
              );
              return (
                <motion.li
                  layout="position"
                  key={app.id}
                  className={styles.tile}
                  whileTap={{ scale: 0.985 }}
                >
                  <button
                    className={styles.pin}
                    type="button"
                    aria-label={`${pinned.has(app.id) ? 'Unpin' : 'Pin'} ${app.label}`}
                    aria-pressed={pinned.has(app.id)}
                    onClick={() => togglePin(app.id)}
                  >
                    <Star size={16} fill={pinned.has(app.id) ? 'currentColor' : 'none'} />
                  </button>
                  {system ? (
                    <button
                      className={`${styles.appLink} w-full`}
                      onClick={handler(app)}
                      aria-label={`Launch ${app.label}`}
                    >
                      {contents}
                    </button>
                  ) : (
                    <Link
                      href={app.href}
                      className={styles.appLink}
                      aria-label={`Open ${app.label}`}
                      data-preserve-workspace={handler(app) ? '' : undefined}
                      onClick={(event) => onLink(event, app)}
                    >
                      {contents}
                    </Link>
                  )}
                </motion.li>
              );
            })}
          </ul>
        )}
        <div className={styles.desktopFooter}>
          <LayoutGrid size={14} aria-hidden="true" />
          <span>One workspace. Your apps, your organisation, your way.</span>
        </div>
      </section>
      {recentApps.length > 0 && (
        <section className={styles.recents} aria-label="Recently opened apps">
          <h2>
            <Clock3 size={16} aria-hidden="true" /> Recently opened
          </h2>
          <div>
            {recentApps.map((app) => (
              <Link
                key={app.id}
                href={app.href}
                data-preserve-workspace={handler(app) ? '' : undefined}
                onClick={(event) => onLink(event, app)}
              >
                <AppIcon name={app.icon} size={17} />
                {app.label}
                <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
