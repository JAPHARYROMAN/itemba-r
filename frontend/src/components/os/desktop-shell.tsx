'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { motion, MotionConfig, useReducedMotion } from 'motion/react';
import {
  LayoutGrid,
  Search,
  PanelsTopLeft,
  Monitor,
  SlidersHorizontal,
  Plus,
  Pin,
  ChevronRight,
  Clock3,
  FilePenLine,
  CheckCheck,
  MoreHorizontal,
  Palette,
  RotateCcw,
  CloudOff,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useCommandPalette } from '@/components/aurora/command';
import { Modal, ModalPortalProvider } from '@/components/ui/modal';
import { NAV, isGroup } from '@/components/layout/sidebar';
import { WorkspaceInstanceProvider } from '@/components/workspace/workspace-session';
import { useWorkspaceDrafts } from '@/components/workspace/workspace-drafts';
import { UnsavedWorkScope, useUnsavedWork } from '@/components/workspace/unsaved-work-provider';
import { APP_REGISTRY, appForPath, canOpenApp, getApp, usesStandalonePosShell } from '@/lib/apps';
import {
  accentForeground,
  accentFocus,
  isWindowApp,
  parseDesktopSession,
  type DesktopWindow,
  type DesktopSession,
  type DesktopAppearance,
} from '@/lib/desktop';

import { AppLauncher } from '@/components/apps/app-launcher';
import { SettingsWorkspace } from '@/components/settings/settings-workspace';
import { backendBinaryGet } from '@/lib/api-client';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { MsaidiziTopbarButton } from '@/components/msaidizi/msaidizi-launcher';
import { AppGlyph } from './app-glyph';
import { DockIcon, DockMotionProvider, useDockMotion } from './desktop-dock-motion';
import { OsNotifications } from './os-notifications';
import { OsAccountMenu } from './os-account-menu';
import { DesktopWindowFrame } from './desktop-window';
import { DesktopShortcut } from './desktop-shortcut';
import { DesktopAppHost, desktopAppForPath } from './desktop-app-host';
import { desktopWindowLabel } from '@/lib/desktop-window-label';
import type { DesktopViewState } from '@/lib/desktop-view-state';
import { AppearanceStudio } from './appearance-studio';
import { useDesktopProfile } from './use-desktop-profile';
import { useDesktopSession } from './use-desktop-session';
import { getBuiltInWallpaper } from '@/lib/wallpapers';
import './os-shell.css';
import './legacy-workspace.css';
import './os-foundation.css';
import './desktop.css';
const DesktopRuntimeReview = dynamic(() => import('./desktop-runtime-review'), { ssr: false });

const staysMounted = (href: string) => {
  const url = new URL(href, window.location.origin);
  return (
    url.origin === window.location.origin &&
    !usesStandalonePosShell(url.pathname) &&
    !['/login', '/signup'].includes(url.pathname)
  );
};
function routeForWindow(item: DesktopWindow) {
  const url = new URL(item.href, 'http://desktop.local');
  url.searchParams.set('_osw', item.id);
  return `${url.pathname}${url.search}${url.hash}`;
}
function cleanHref(pathname: string, params: URLSearchParams) {
  const clean = new URLSearchParams(params);
  clean.delete('_osw');
  return `${pathname}${clean.size ? `?${clean}` : ''}${typeof window !== 'undefined' ? window.location.hash : ''}`;
}

function HostedWindow({
  item,
  onNavigate,
}: {
  item: DesktopWindow;
  onNavigate: (id: string, href: string) => void;
}) {
  const changed = useCallback((href: string) => onNavigate(item.id, href), [item.id, onNavigate]);
  return <DesktopAppHost appId={item.appId} href={item.href} onHrefChange={changed} />;
}
export function LegacyNavigation() {
  const { hasPermission } = useAuth();
  return (
    <nav className="desktop-erp-navigation" aria-label="ITEMBA-R modules">
      {NAV.map((entry) => {
        const allowed = (item: { permission?: string; permissionsAny?: string[] }) =>
          (!item.permission || hasPermission(item.permission)) &&
          (!item.permissionsAny?.length ||
            item.permissionsAny.some((permission) => hasPermission(permission)));
        const links = isGroup(entry)
          ? entry.children.filter((child) =>
              allowed({
                permission: child.permission ?? entry.permission,
                permissionsAny: child.permissionsAny ?? entry.permissionsAny,
              }),
            )
          : // OS apps (Invoice Desk, Reports and the rest) carry sidebarHidden in
            // OS mode: they live in the dock and library, not in the ERP's own
            // navigation, exactly as the classic Sidebar already skips them.
            allowed(entry) && entry.href !== '/apps' && !entry.sidebarHidden
            ? [entry]
            : [];
        if (!links.length) return null;
        return (
          // Labels repeat across groups and leaves ("Reports" is both), so the
          // key says which kind of entry it is.
          <details
            key={isGroup(entry) ? `group:${entry.label}` : `leaf:${entry.href}`}
            open={entry.label === 'Dashboard'}
          >
            <summary>{entry.label}</summary>
            {links.map((link) => (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ))}
          </details>
        );
      })}
    </nav>
  );
}
export function DesktopShell({
  children,
  appUrls,
}: {
  children: ReactNode;
  appUrls: Record<string, string | null>;
}) {
  const { user, hasPermission, logout } = useAuth();
  const pathname = usePathname(),
    params = useSearchParams(),
    router = useRouter();
  const { request } = useUnsavedWork();
  const { open: openSearch } = useCommandPalette();
  const {
    appearance,
    update: updateAppearance,
    ready: profileReady,
    status: profileStatus,
    recovery: profileRecovery,
    recovering: profileRecovering,
    recover: recoverProfile,
  } = useDesktopProfile(user!.id);
  const {
    session,
    setSession,
    ready,
    savedSessions,
    status: sessionStatus,
    recovery: sessionRecovery,
    recovering: sessionRecovering,
    recover: recoverSession,
    sessionId,
  } = useDesktopSession(user!.id);
  const workspace = appearance,
    updateWorkspace = updateAppearance;
  const { drafts } = useWorkspaceDrafts();
  const companies = useWorkspaceChoices<{ id: string; name: string }>(
    '/companies',
    {},
    hasPermission('companies.read'),
  );
  const windowLabel = (item: DesktopWindow) => desktopWindowLabel(item, companies.rows);
  const [focusRequest, setFocusRequest] = useState({ id: '', revision: 0 });
  const pendingFocus = useRef<string | null>(null);
  const completeWindowFocus = useCallback(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    setFocusRequest((current) => ({ id, revision: current.revision + 1 }));
  }, []);
  const sessionRef = useRef(session);
  const closedWindowIds = useRef(new Set<string>());
  useEffect(() => {
    // An explicit browser-history visit may reopen a closed canonical link.
    const traversed = () => closedWindowIds.current.clear();
    window.addEventListener('popstate', traversed);
    return () => window.removeEventListener('popstate', traversed);
  }, []);
  useLayoutEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const [launcher, setLauncher] = useState(false),
    [overview, setOverview] = useState(false),
    [control, setControl] = useState(false),
    [showDesktop, setShowDesktop] = useState(false);
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState('All'),
    [contextApp, setContextApp] = useState<string | null>(null);
  const [launcherAll, setLauncherAll] = useState(false);
  const [runtimeReview] = useState(() => params.get('uiReview') === 'performance');
  const [desktopMenu, setDesktopMenu] = useState(false),
    [systemSettings, setSystemSettings] = useState(false),
    [notice, setNotice] = useState('');
  const [clock, setClock] = useState<Date | null>(null),
    [wallpaper, setWallpaper] = useState<string | null>(null);
  const [pageVisible, setPageVisible] = useState(true);
  const [area, setArea] = useState({ width: 1280, height: 760 });
  const areaRef = useRef<HTMLDivElement>(null),
    launcherTrigger = useRef<HTMLButtonElement>(null),
    overviewTrigger = useRef<HTMLButtonElement>(null);
  const narrow = area.width < 1000;
  const prefersReduced = useReducedMotion();
  const reduced = appearance.motion === 'reduced' || !!prefersReduced;
  // Narrow mode always lays the dock out along the bottom (desktop.css).
  const dockMotion = useDockMotion({
    edge: narrow ? 'bottom' : appearance.dock,
    magnify: !narrow,
    still: reduced || !pageVisible,
  });
  // Launch bounces, one counter per app: each increase plays it once.
  const [dockBounces, setDockBounces] = useState<Record<string, number>>({});
  const allowedApps = APP_REGISTRY.filter((app) => canOpenApp(app, hasPermission));
  const pinnedApps = allowedApps.filter((app) => workspace.pinnedApps.includes(app.id));
  const browsingApps = launcherAll || !!query.trim() || !pinnedApps.length;
  const routeId = desktopAppForPath(pathname);
  const routeApp = routeId ? getApp(routeId) : undefined;
  const legacyRoute =
    pathname !== '/desktop' &&
    pathname !== '/apps' &&
    (!routeApp || !isWindowApp(routeApp.id)) &&
    routeApp?.launch.kind !== 'external';
  const initializedRoute = useRef('');
  const approvals = useWorkspaceResource<{ data?: unknown[]; total?: number }>(
    '/approvals/requests/pending/me',
    { limit: 1 },
    appearance.widgets.approvals && hasPermission('approval_requests.view'),
  );

  useEffect(() => {
    const measure = () => {
      const box = areaRef.current?.getBoundingClientRect();
      if (box) setArea({ width: box.width, height: box.height });
    };
    const observer = new ResizeObserver(measure);
    if (areaRef.current) observer.observe(areaRef.current);
    measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'hidden') setClock(new Date());
    };
    const visibility = () => {
      setPageVisible(document.visibilityState !== 'hidden');
      tick();
    };
    tick();
    visibility();
    const timer = setInterval(tick, 30000);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    if (!appearance.wallpaperId || getBuiltInWallpaper(appearance.wallpaperId)) {
      setWallpaper(null);
      return;
    }
    const controller = new AbortController();
    let url: string | null = null;
    backendBinaryGet(`/workspace/wallpapers/${appearance.wallpaperId}/image`, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          url = URL.createObjectURL(result.blob);
          setWallpaper(url);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setWallpaper(null);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [appearance.wallpaperId]);
  const builtInWallpaper = getBuiltInWallpaper(appearance.wallpaperId);
  const wallpaperImage = builtInWallpaper?.src ?? wallpaper;
  useEffect(() => {
    const root = document.documentElement;
    const properties: Record<string, string> = {
      '--desktop-accent': appearance.accent,
      '--desktop-accent-ink': accentForeground(appearance.accent),
      '--desktop-focus-light': accentFocus(appearance.accent, '#f1f3f7'),
      '--desktop-focus-dark': accentFocus(appearance.accent, '#242d3c'),
      '--desktop-blur': `${appearance.transparency === 'reduced' ? 0 : appearance.blur}px`,
      '--desktop-icon-size': `${appearance.iconSize}px`,
    };
    for (const [key, value] of Object.entries(properties)) root.style.setProperty(key, value);
    return () => {
      for (const key of Object.keys(properties)) root.style.removeProperty(key);
    };
  }, [appearance.accent, appearance.blur, appearance.transparency, appearance.iconSize]);

  const changeWindow = useCallback(
    (id: string, changes: Partial<DesktopWindow>) =>
      setSession((current) => ({
        ...current,
        windows: current.windows.map((item) => (item.id === id ? { ...item, ...changes } : item)),
      })),
    [setSession],
  );
  const saveWindowView = useCallback(
    (id: string, viewState: DesktopViewState) => {
      changeWindow(id, { viewState });
    },
    [changeWindow],
  );
  const navigate = useCallback(
    (href: string, replace = false) =>
      request(
        () =>
          replace ? router.replace(href, { scroll: false }) : router.push(href, { scroll: false }),
        undefined,
        'navigate',
        { href },
      ),
    [request, router],
  );
  const navigateWindow = useCallback(
    (id: string, href: string) => {
      const current = sessionRef.current,
        item = current.windows.find((row) => row.id === id);
      if (!item || item.href === href) return;
      changeWindow(id, { href });
      if (current.activeId === id) navigate(routeForWindow({ ...item, href }));
    },
    [changeWindow, navigate],
  );
  function remember(appId: string) {
    updateWorkspace((current) => ({
      ...current,
      recentApps: [appId, ...current.recentApps.filter((id) => id !== appId)].slice(0, 8),
    }));
  }
  function arrangeWindow(id: string, changes: Partial<DesktopWindow>) {
    if (!changes.minimized || sessionRef.current.activeId !== id) {
      changeWindow(id, changes);
      return;
    }
    const current = sessionRef.current;
    const next = current.windows.filter((item) => item.id !== id && !item.minimized).at(-1);
    setSession({
      ...current,
      activeId: next?.id ?? null,
      windows: current.windows.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    });
    pendingFocus.current = next?.id ?? null;
    completeWindowFocus();
    navigate(next && next.appId !== 'settings' ? routeForWindow(next) : '/desktop', true);
  }
  function focusWindow(id: string, syncUrl = true, transferFocus = false) {
    const item = sessionRef.current.windows.find((row) => row.id === id);
    if (!item) return;
    if (transferFocus) {
      pendingFocus.current = id;
      if (!launcher && !overview && !contextApp && !control && !desktopMenu) completeWindowFocus();
    }
    setShowDesktop(false);
    setOverview(false);
    setSession((current) =>
      current.activeId === id && !item.minimized
        ? current
        : {
            ...current,
            activeId: id,
            windows: [
              ...current.windows.filter((row) => row.id !== id),
              { ...item, minimized: false },
            ],
          },
    );
    if (syncUrl && item.appId !== 'settings') navigate(routeForWindow(item), true);
  }
  function openApp(appId: string, newWindow = false) {
    const app = getApp(appId);
    if (!app || !canOpenApp(app, hasPermission)) return;
    setLauncher(false);
    setContextApp(null);
    setDesktopMenu(false);
    setControl(false);
    setShowDesktop(false);
    remember(appId);
    if (app.launch.kind === 'external' && appUrls[app.id]) {
      window.open(appUrls[app.id]!, '_blank', 'noopener,noreferrer');
      return;
    }
    const previous = [...sessionRef.current.windows].reverse().find((item) => item.appId === appId);
    if (previous && (!newWindow || app.hosting.kind !== 'independent')) {
      focusWindow(previous.id, true, true);
      return;
    }
    if (sessionRef.current.windows.length >= 24) {
      setNotice('Close a window before opening another. Your drafts remain available.');
      return;
    }
    const count = sessionRef.current.windows.length;
    const item: DesktopWindow = {
      id: crypto.randomUUID(),
      appId,
      href: app.href,
      minimized: false,
      mode: 'floating',
      bounds: {
        x: 150 + (count % 5) * 32,
        y: 36 + (count % 5) * 28,
        width: appId === 'settings' ? 920 : 1080,
        height: 740,
      },
    };
    pendingFocus.current = item.id;
    if (!launcher && !contextApp && !control && !desktopMenu) completeWindowFocus();
    setSession((current) => ({
      ...current,
      windows: [...current.windows, item],
      activeId: item.id,
    }));
    if (appId !== 'settings') navigate(routeForWindow(item));
  }
  function closeWindow(id: string) {
    request(
      () => {
        closedWindowIds.current.add(id);
        const current = sessionRef.current;
        const windows = current.windows.filter((item) => item.id !== id);
        const next =
          current.activeId === id
            ? windows.filter((item) => !item.minimized).at(-1)
            : windows.find((item) => item.id === current.activeId);
        setSession({ ...current, windows, activeId: next?.id ?? null });
        if (current.activeId === id)
          navigate(next && next.appId !== 'settings' ? routeForWindow(next) : '/desktop', true);
      },
      undefined,
      'close',
      { scope: `window:${id}` },
    );
  }
  useEffect(() => {
    if (!ready) return;
    const routeKey = `${pathname}?${params}`;
    if (initializedRoute.current === routeKey) return;
    initializedRoute.current = routeKey;
    if (closedWindowIds.current.has(params.get('_osw') ?? '')) {
      // A late route commit from focusing a just-closed window must not recreate it.
      const activeWindow = sessionRef.current.windows.find(
        (item) => item.id === sessionRef.current.activeId,
      );
      navigate(
        activeWindow && activeWindow.appId !== 'settings'
          ? routeForWindow(activeWindow)
          : '/desktop',
        true,
      );
      return;
    }
    if (pathname === '/apps') {
      setLauncher(true);
      return;
    }
    if (pathname === '/desktop') return;
    const app = routeApp ?? getApp('itemba-r')!;
    if (!canOpenApp(app, hasPermission)) return;
    const href = cleanHref(pathname, new URLSearchParams(params));
    setSession((current) => {
      const target =
        current.windows.find((w) => w.id === params.get('_osw') && w.appId === app.id) ??
        [...current.windows].reverse().find((w) => w.appId === app.id);
      const item: DesktopWindow = target
        ? { ...target, href, minimized: false }
        : {
            id: crypto.randomUUID(),
            appId: app.id,
            href,
            minimized: false,
            mode: 'floating',
            bounds: { x: 150, y: 40, width: 1080, height: 740 },
          };
      return {
        ...current,
        windows: [...current.windows.filter((w) => w.id !== item.id), item],
        activeId: item.id,
      };
    });
    setShowDesktop(false);
  }, [ready, pathname, params, routeApp, hasPermission, setSession, navigate]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        !(event.ctrlKey || event.metaKey) ||
        !event.shiftKey ||
        event.altKey ||
        document.querySelector(
          '[role="dialog"][aria-modal="true"]:not([aria-hidden="true"]),dialog[open]',
        )
      )
        return;
      if (event.code === 'Space') {
        event.preventDefault();
        setOverview((value) => !value);
      } else if (event.code === 'KeyL') {
        event.preventDefault();
        setLauncher((value) => !value);
      } else if (event.code === 'KeyD') {
        event.preventDefault();
        setShowDesktop((value) => !value);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  const active = session.windows.find((item) => item.id === session.activeId);
  const visibleWindows = session.windows.filter((item) => {
    const app = getApp(item.appId);
    return app && canOpenApp(app, hasPermission);
  });
  const desktopCovered =
    !showDesktop &&
    visibleWindows.some((item) => !item.minimized && (narrow || item.mode === 'maximized'));
  const dockApps = allowedApps.filter(
    (app) =>
      workspace.pinnedApps.includes(app.id) ||
      visibleWindows.some((item) => item.appId === app.id) ||
      app.id === 'settings',
  );
  const recent = workspace.recentApps
    .flatMap((id) => allowedApps.filter((app) => app.id === id))
    .slice(0, 4);
  const togglePin = (id: string) =>
    updateWorkspace((current) => ({
      ...current,
      pinnedApps: current.pinnedApps.includes(id)
        ? current.pinnedApps.filter((value) => value !== id)
        : [...current.pinnedApps, id],
    }));
  const addShortcut = (id: string) =>
    updateAppearance((current) => ({
      ...current,
      shortcuts: current.shortcuts.some((s) => s.appId === id)
        ? current.shortcuts.filter((s) => s.appId !== id)
        : [
            ...current.shortcuts,
            { appId: id, x: 140, y: 32 + (current.shortcuts.length % 5) * 112 },
          ],
    }));
  const filtered = allowedApps.filter(
    (app) =>
      (category === 'All' || app.category === category) &&
      `${app.label} ${app.description} ${app.keywords.join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <MotionConfig
      reducedMotion={reduced ? 'always' : 'never'}
      transition={{ type: 'spring', stiffness: 400, damping: 36 }}
    >
      <ModalPortalProvider>
        <div
          className="itemba-desktop"
          data-theme={appearance.theme}
          data-density={appearance.density}
          data-transparency={appearance.transparency}
          data-dock={appearance.dock}
          data-auto-hide={appearance.autoHide}
          data-reduced-motion={reduced}
          data-wallpaper-tone={builtInWallpaper?.tone}
        >
          <div
            className="desktop-wallpaper"
            data-builtin={!!builtInWallpaper}
            style={
              wallpaperImage
                ? {
                    backgroundImage: `url("${wallpaperImage}")`,
                    backgroundPosition: appearance.wallpaperPosition,
                  }
                : { backgroundPosition: appearance.wallpaperPosition }
            }
          />
          <a className="desktop-skip" href="#desktop-workspace">
            Skip to workspace
          </a>
          <header className="desktop-menubar">
            <button
              className="desktop-brand"
              onClick={() => setShowDesktop((v) => !v)}
              aria-label="Show desktop"
            >
              <Image src="/brand/itemba-group-logo.png" alt="" width={24} height={28} />
              <strong>
                ITEMBA <span>OS</span>
              </strong>
            </button>
            <span className="desktop-bar-divider" aria-hidden="true" />
            <span className="desktop-current-app">
              {showDesktop ? 'Desktop' : (getApp(active?.appId ?? '')?.label ?? 'Desktop')}
            </span>
            <div className="desktop-system-actions">
              {/* Find and ask: the two ways into anything. */}
              <div className="desktop-bar-group">
                <button
                  className="desktop-bar-icon"
                  aria-label="Search workspace"
                  title="Search (Ctrl / ⌘ K)"
                  onClick={openSearch}
                >
                  <Search size={17} />
                </button>
                <MsaidiziTopbarButton className="desktop-bar-assistant" />
              </div>
              <span className="desktop-bar-divider" aria-hidden="true" />
              {/* The workspace itself: windows, what needs attention, settings. */}
              <div className="desktop-bar-group">
                <button
                  ref={overviewTrigger}
                  className="desktop-bar-icon"
                  aria-label="Window overview"
                  title="Windows (Ctrl / ⌘ Shift Space)"
                  onClick={() => setOverview(true)}
                >
                  <PanelsTopLeft size={17} />
                </button>
                <OsNotifications onNavigate={(href) => navigate(href)} />
                <button
                  className="desktop-bar-icon"
                  aria-label="Control centre"
                  title={
                    sessionRecovery || profileRecovery
                      ? 'Desktop settings need attention'
                      : 'Control centre'
                  }
                  data-attention={!!sessionRecovery || !!profileRecovery}
                  onClick={() => setControl(true)}
                >
                  {sessionRecovery || profileRecovery ? (
                    <CloudOff size={17} />
                  ) : (
                    <SlidersHorizontal size={17} />
                  )}
                </button>
              </div>
              <span className="desktop-bar-divider" aria-hidden="true" />
              <OsAccountMenu
                initials={
                  user?.fullName
                    ?.split(' ')
                    .map((v) => v[0])
                    .slice(0, 2)
                    .join('') ?? 'I'
                }
                name={user?.fullName}
                email={user?.email}
                onSettings={() => openApp('settings')}
                onSignOut={() => request(() => void logout())}
              />
              {clock && (
                <time className="desktop-bar-clock" dateTime={clock.toISOString()}>
                  <span>
                    {clock.toLocaleDateString(undefined, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                  <strong>
                    {clock.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </strong>
                </time>
              )}
            </div>
          </header>
          <main
            id="desktop-workspace"
            className="desktop-workspace"
            ref={areaRef}
            tabIndex={-1}
            aria-label="Desktop workspace"
            onContextMenu={(event) => {
              if (
                (event.target as Element).closest(
                  '.desktop-window,.desktop-shortcut,.desktop-widget',
                )
              )
                return;
              event.preventDefault();
              setDesktopMenu(true);
            }}
          >
            <div
              className="desktop-home"
              aria-label="Desktop"
              inert={desktopCovered}
              aria-hidden={desktopCovered}
            >
              <div className="desktop-greeting">
                <span className="desktop-eyebrow">ITEMBA OS</span>
                <h1>Your workspace.</h1>
                <p>Everything you need, in one place.</p>
              </div>
              <div className="desktop-shortcuts" aria-label="Desktop shortcuts">
                {appearance.shortcuts.map((shortcut) => {
                  const app = allowedApps.find((a) => a.id === shortcut.appId);
                  if (!app) return null;
                  return (
                    <DesktopShortcut
                      key={app.id}
                      position={shortcut}
                      area={area}
                      narrow={narrow}
                      onMove={(x, y) =>
                        updateAppearance((current) => ({
                          ...current,
                          shortcuts: current.shortcuts.map((item) =>
                            item.appId === app.id ? { ...item, x, y } : item,
                          ),
                        }))
                      }
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setContextApp(app.id);
                      }}
                    >
                      <button onClick={() => openApp(app.id)}>
                        <AppGlyph app={app} size="large" />
                        <span>{app.label}</span>
                      </button>
                      <button
                        className="desktop-shortcut-options"
                        aria-label={`${app.label} shortcut options`}
                        onClick={() => setContextApp(app.id)}
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    </DesktopShortcut>
                  );
                })}
              </div>
              <aside className="desktop-widgets" aria-label="Desktop widgets">
                {appearance.widgets.recent && (
                  <section className="desktop-widget" data-widget="recent">
                    <header>
                      <Clock3 size={17} />
                      <h2>Recent apps</h2>
                    </header>
                    {recent.length ? (
                      recent.slice(0, 3).map((app) => (
                        <button key={app.id} onClick={() => openApp(app.id)}>
                          <AppGlyph app={app} size="small" />
                          <span>{app.label}</span>
                          <ChevronRight size={15} />
                        </button>
                      ))
                    ) : (
                      <p>Your recent apps will appear here.</p>
                    )}
                  </section>
                )}
                {appearance.widgets.drafts && (
                  <section className="desktop-widget desktop-widget-compact">
                    <header>
                      <FilePenLine size={17} />
                      <h2>Unfinished work</h2>
                      <strong className="desktop-widget-count">{drafts.length}</strong>
                    </header>
                    <p>
                      {drafts.length
                        ? 'Drafts ready when you are.'
                        : 'A clear desk. A fresh start.'}
                    </p>
                    {drafts.slice(0, 2).map((draft) => (
                      <button key={draft.id} onClick={() => openApp(draft.appId)}>
                        <span>{draft.title}</span>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </section>
                )}
                {appearance.widgets.approvals && hasPermission('approval_requests.view') && (
                  <section className="desktop-widget desktop-widget-compact">
                    <header>
                      <CheckCheck size={17} />
                      <h2>Needs your attention</h2>
                      <strong className="desktop-widget-count">
                        {approvals.loading || approvals.error ? '—' : (approvals.data?.total ?? 0)}
                      </strong>
                    </header>
                    <p>
                      {approvals.error
                        ? 'Approvals are temporarily unavailable.'
                        : 'Pending approval requests'}
                    </p>
                    <button onClick={() => navigate('/approvals/pending')}>
                      Review approvals <ChevronRight size={15} />
                    </button>
                  </section>
                )}
              </aside>
              <button className="desktop-personalise" onClick={() => openApp('settings')}>
                <Palette size={16} /> Personalise desktop
              </button>
            </div>
            {ready &&
              visibleWindows.map((item, index) => {
                const app = getApp(item.appId)!;
                const concealed =
                  showDesktop || item.minimized || (narrow && session.activeId !== item.id);
                return (
                  <DesktopWindowFrame
                    key={item.id}
                    window={item}
                    app={app}
                    active={session.activeId === item.id}
                    concealed={concealed}
                    zIndex={10 + index}
                    area={area}
                    narrow={narrow}
                    reduced={reduced}
                    intensity={appearance.intensity}
                    onFocus={() => {
                      if (sessionRef.current.activeId !== item.id) focusWindow(item.id);
                    }}
                    onChange={(change) => arrangeWindow(item.id, change)}
                    onClose={() => closeWindow(item.id)}
                    onNew={
                      app.hosting.kind === 'independent' ? () => openApp(app.id, true) : undefined
                    }
                    contextLabel={windowLabel(item)}
                    focusRequest={focusRequest.id === item.id ? focusRequest.revision : 0}
                  >
                    <WorkspaceInstanceProvider
                      id={item.id}
                      appId={item.appId}
                      viewState={item.viewState}
                      onViewChange={saveWindowView}
                    >
                      <UnsavedWorkScope
                        id={`window:${item.id}`}
                        survivesNavigation={
                          isWindowApp(app.id) || app.id === 'settings' ? staysMounted : undefined
                        }
                      >
                        {isWindowApp(app.id) ? (
                          <HostedWindow item={item} onNavigate={navigateWindow} />
                        ) : app.id === 'settings' ? (
                          <>
                            <nav className="desktop-settings-tabs">
                              <button
                                aria-pressed={!systemSettings}
                                onClick={() => setSystemSettings(false)}
                              >
                                Appearance Studio
                              </button>
                              <button
                                aria-pressed={systemSettings}
                                onClick={() => setSystemSettings(true)}
                              >
                                System settings
                              </button>
                            </nav>
                            {systemSettings ? (
                              <SettingsWorkspace embedded onNavigate={(href) => navigate(href)} />
                            ) : (
                              <AppearanceStudio
                                value={appearance}
                                onChange={updateAppearance}
                                status={profileStatus}
                                recovery={profileRecovery}
                                recovering={profileRecovering}
                                onRecover={(choice) => void recoverProfile(choice)}
                              />
                            )}
                          </>
                        ) : app.launch.kind === 'external' ? (
                          <AppLauncher app={app} appUrl={appUrls[app.id]} />
                        ) : legacyRoute ? (
                          <div className="desktop-erp">
                            <LegacyNavigation />
                            <div className="desktop-erp-content">{children}</div>
                          </div>
                        ) : (
                          <div className="desktop-app-error">
                            <h2>ITEMBA-R</h2>
                            <p>Continue your business workspace.</p>
                            <button onClick={() => navigate(routeForWindow(item))}>
                              Resume ITEMBA-R
                            </button>
                          </div>
                        )}
                      </UnsavedWorkScope>
                    </WorkspaceInstanceProvider>
                  </DesktopWindowFrame>
                );
              })}
            {(!ready || !profileReady) && (
              <div className="desktop-loading" role="status">
                Getting your desktop ready…
              </div>
            )}
            {notice && (
              <div className="desktop-notice" role="status">
                {notice}
                <button onClick={() => setNotice('')}>Dismiss</button>
              </div>
            )}
          </main>
          <nav
            className="desktop-dock"
            aria-label="Desktop dock"
            {...dockMotion.handlers}
            onKeyDown={(event) => {
              if (
                !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
                  event.key,
                )
              )
                return;
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  ':scope > button, :scope > .desktop-dock-item > button',
                ),
              );
              const i = buttons.indexOf(event.target as HTMLButtonElement);
              if (i < 0) return;
              event.preventDefault();
              const n =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (i +
                        (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) +
                        buttons.length) %
                      buttons.length;
              buttons[n]?.focus();
            }}
          >
            <DockMotionProvider value={dockMotion.value}>
              <motion.button
                ref={launcherTrigger}
                className="desktop-apps-button"
                aria-label="Apps"
                aria-expanded={launcher}
                whileTap={{ scale: 0.94 }}
                onClick={() => setLauncher(!launcher)}
              >
                <DockIcon>
                  <span className="desktop-apps-tile">
                    <LayoutGrid size={27} />
                  </span>
                </DockIcon>
                <strong>Apps</strong>
              </motion.button>
              <i className="desktop-dock-divider" />
              {dockApps.map((app) => {
                const windows = visibleWindows.filter((w) => w.appId === app.id);
                return (
                  <div
                    key={app.id}
                    className="desktop-dock-item"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextApp(app.id);
                    }}
                  >
                    <motion.button
                      // Magnification replaces the hover lift where it runs.
                      whileHover={reduced || !narrow ? undefined : { y: -4 }}
                      whileTap={{ scale: 0.94 }}
                      aria-label={`Open ${app.label}${windows.length ? `, ${windows.length} open ${windows.length === 1 ? 'window' : 'windows'}` : ''}`}
                      data-dock-app={app.id}
                      aria-pressed={!showDesktop && active?.appId === app.id}
                      onClick={() => {
                        // Only a real launch bounces, not a switch to an open window.
                        if (windows.length === 0)
                          setDockBounces((current) => ({
                            ...current,
                            [app.id]: (current[app.id] ?? 0) + 1,
                          }));
                        openApp(app.id);
                      }}
                    >
                      <DockIcon bounce={dockBounces[app.id] ?? 0}>
                        <AppGlyph app={app} />
                      </DockIcon>
                      <span className="desktop-dock-tooltip">{app.label}</span>
                      <span className="desktop-running" aria-hidden="true">
                        {windows.slice(0, 3).map((w) => (
                          <i key={w.id} data-active={w.id === session.activeId && !w.minimized} />
                        ))}
                      </span>
                    </motion.button>
                    {windows.length > 0 && (
                      <button
                        className="desktop-dock-windows"
                        aria-label={`${app.label} windows and options`}
                        onClick={() => setContextApp(app.id)}
                      >
                        {windows.length}
                      </button>
                    )}
                  </div>
                );
              })}
              <i className="desktop-dock-divider" />
              <button
                className="desktop-show-button"
                aria-label={showDesktop ? 'Restore desktop windows' : 'Show desktop'}
                aria-pressed={showDesktop}
                onClick={() => setShowDesktop((v) => !v)}
              >
                <DockIcon>
                  <Monitor size={23} />
                </DockIcon>
                <span className="desktop-dock-tooltip">Show desktop</span>
              </button>
            </DockMotionProvider>
          </nav>
          <Modal
            open={launcher}
            onClose={() => setLauncher(false)}
            title="Your apps"
            subtitle="Open an app or pick up where you left off."
            size="2xl"
            returnFocusRef={launcherTrigger}
            onAfterClose={completeWindowFocus}
          >
            <div className="desktop-launcher">
              <label className="desktop-launcher-search">
                <Search size={20} />
                <input
                  autoFocus
                  type="search"
                  placeholder="Find an app…"
                  aria-label="Search apps"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="desktop-launcher-views" aria-label="App library views">
                <button
                  aria-pressed={!browsingApps}
                  onClick={() => {
                    setLauncherAll(false);
                    setQuery('');
                    setCategory('All');
                  }}
                >
                  Pinned & recent
                </button>
                <button
                  aria-pressed={browsingApps}
                  onClick={() => {
                    setLauncherAll(true);
                    setCategory('All');
                  }}
                >
                  All apps <span>{allowedApps.length}</span>
                </button>
              </div>
              {browsingApps && (
                <div className="desktop-launcher-categories">
                  {['All', ...new Set(allowedApps.map((app) => app.category))].map((name) => (
                    <button
                      key={name}
                      aria-pressed={category === name}
                      onClick={() => setCategory(name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
              {!browsingApps && (
                <>
                  <h3>Pinned</h3>
                  <div className="desktop-launcher-grid">
                    {pinnedApps.map((app) => (
                      <button
                        key={app.id}
                        onClick={() => openApp(app.id)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setLauncher(false);
                          setContextApp(app.id);
                        }}
                      >
                        <AppGlyph app={app} />
                        <span>{app.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {browsingApps && (
                <>
                  <h3>
                    {query ? 'Search results' : 'All apps'} <span>{filtered.length}</span>
                  </h3>
                  <div className="desktop-all-apps">
                    {filtered.map((app) => (
                      <div key={app.id}>
                        <button onClick={() => openApp(app.id)}>
                          <AppGlyph app={app} size="small" />
                          <span>
                            <strong>{app.label}</strong>
                            <small>{app.category}</small>
                          </span>
                        </button>
                        <button
                          aria-label={`${app.label} options`}
                          onClick={() => {
                            setLauncher(false);
                            setContextApp(app.id);
                          }}
                        >
                          <MoreHorizontal size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                  {!filtered.length && <p>No apps match your search.</p>}
                </>
              )}
              {!!recent.length && !browsingApps && (
                <>
                  <h3>Recently used</h3>
                  <div className="desktop-launcher-recent">
                    {recent.map((app) => (
                      <button key={app.id} onClick={() => openApp(app.id)}>
                        <AppGlyph app={app} size="small" />
                        {app.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <footer>
                <span>{user?.fullName}</span>
                <button onClick={() => openApp('settings')}>
                  <Palette size={16} /> Personalise
                </button>
              </footer>
            </div>
          </Modal>
          <Modal
            open={overview}
            onClose={() => setOverview(false)}
            title="Your open windows"
            subtitle="Everything in its place. Pick a window to continue."
            size="3xl"
            returnFocusRef={overviewTrigger}
            onAfterClose={completeWindowFocus}
          >
            <div className="desktop-overview">
              {visibleWindows.map((item) => {
                const app = getApp(item.appId)!;
                return (
                  <div key={item.id} className="desktop-overview-card">
                    <button onClick={() => focusWindow(item.id, true, true)}>
                      <div className="desktop-window-preview">
                        <AppGlyph app={app} size="large" />
                        <span>{windowLabel(item)}</span>
                      </div>
                      <strong>{app.label}</strong>
                      <small>
                        {item.minimized ? 'Minimised' : 'Open'}
                        {drafts.some((d) => d.appId === item.appId) ? ' · Drafts available' : ''}
                      </small>
                    </button>
                    <button
                      aria-label={`Close ${app.label} from overview`}
                      onClick={() => closeWindow(item.id)}
                    >
                      Close
                    </button>
                  </div>
                );
              })}
              {!visibleWindows.length && <p>Your open apps will appear here.</p>}
            </div>
          </Modal>
          <Modal
            open={!!contextApp}
            onClose={() => setContextApp(null)}
            title={getApp(contextApp ?? '')?.label ?? 'App options'}
            size="sm"
            onAfterClose={completeWindowFocus}
          >
            <div className="desktop-context-actions">
              <button onClick={() => contextApp && openApp(contextApp)}>Open app</button>
              {contextApp && getApp(contextApp)?.hosting.kind === 'independent' && (
                <button onClick={() => openApp(contextApp, true)}>
                  <Plus size={16} />
                  New window
                </button>
              )}
              <button
                onClick={() => {
                  if (contextApp) togglePin(contextApp);
                  setContextApp(null);
                }}
              >
                <Pin size={16} />
                {workspace.pinnedApps.includes(contextApp ?? '')
                  ? 'Unpin from dock'
                  : 'Pin to dock'}
              </button>
              <button
                onClick={() => {
                  if (contextApp) addShortcut(contextApp);
                  setContextApp(null);
                }}
              >
                {appearance.shortcuts.some((s) => s.appId === contextApp)
                  ? 'Remove desktop shortcut'
                  : 'Add desktop shortcut'}
              </button>
              {visibleWindows
                .filter((w) => w.appId === contextApp)
                .map((w) => (
                  <button
                    key={w.id}
                    onClick={() => {
                      setContextApp(null);
                      focusWindow(w.id, true, true);
                    }}
                  >
                    {windowLabel(w)} {w.minimized ? '· minimised' : ''}
                  </button>
                ))}
            </div>
          </Modal>
          <Modal
            open={desktopMenu}
            onClose={() => setDesktopMenu(false)}
            title="Desktop"
            size="sm"
            onAfterClose={completeWindowFocus}
          >
            <div className="desktop-context-actions">
              <button
                onClick={() => {
                  setDesktopMenu(false);
                  setLauncher(true);
                }}
              >
                <LayoutGrid size={17} />
                Open Apps
              </button>
              <button onClick={() => openApp('settings')}>
                <Palette size={17} />
                Personalise desktop
              </button>
              <button
                onClick={() => {
                  updateAppearance((current) => ({
                    ...current,
                    shortcuts: current.shortcuts.map((s, i) => ({
                      ...s,
                      x: 24 + Math.floor(i / 5) * 112,
                      y: 24 + (i % 5) * 112,
                    })),
                  }));
                  setDesktopMenu(false);
                }}
              >
                Arrange shortcuts
              </button>
            </div>
          </Modal>
          <Modal
            open={control}
            onClose={() => setControl(false)}
            title="Control centre"
            size="sm"
            onAfterClose={completeWindowFocus}
          >
            <div className="desktop-control-centre">
              <label>
                Appearance
                <select
                  value={appearance.mode}
                  onChange={(e) =>
                    updateAppearance((current) => ({
                      ...current,
                      mode: e.target.value as DesktopAppearance['mode'],
                    }))
                  }
                >
                  <option value="system">Automatic</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={appearance.transparency === 'reduced'}
                  onChange={(e) =>
                    updateAppearance((current) => ({
                      ...current,
                      transparency: e.target.checked ? 'reduced' : 'full',
                    }))
                  }
                />
                Reduce transparency
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={appearance.motion === 'reduced'}
                  onChange={(e) =>
                    updateAppearance((current) => ({
                      ...current,
                      motion: e.target.checked ? 'reduced' : 'system',
                    }))
                  }
                />
                Reduce motion
              </label>
              <button onClick={() => openApp('settings')}>
                <Palette size={17} />
                Open Appearance Studio
              </button>
              {profileRecovery && (
                <p role="status">
                  Appearance needs attention. Open Appearance Studio to choose which settings to
                  keep.
                </p>
              )}
              <section
                className="desktop-session-status"
                data-attention={!!sessionRecovery}
                aria-label="Workspace sync"
              >
                <p role="status">{sessionStatus}</p>
                {sessionRecovery && (
                  <div className="desktop-recovery-actions">
                    {sessionRecovery === 'conflict' ? (
                      <>
                        <button
                          disabled={sessionRecovering}
                          onClick={() =>
                            request(() => void recoverSession('saved'), undefined, 'exit')
                          }
                        >
                          Use saved layout
                        </button>
                        <button
                          disabled={sessionRecovering}
                          onClick={() => void recoverSession('keep')}
                        >
                          Keep current layout
                        </button>
                      </>
                    ) : (
                      <button
                        disabled={sessionRecovering}
                        onClick={() => void recoverSession('retry')}
                      >
                        Try syncing again
                      </button>
                    )}
                  </div>
                )}
              </section>
              <details className="desktop-keyboard-help">
                <summary>Keyboard shortcuts</summary>
                <dl>
                  <div>
                    <dt>Apps</dt>
                    <dd>
                      <kbd>Ctrl / ⌘</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd>
                    </dd>
                  </div>
                  <div>
                    <dt>Window overview</dt>
                    <dd>
                      <kbd>Ctrl / ⌘</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd>
                    </dd>
                  </div>
                  <div>
                    <dt>Show desktop</dt>
                    <dd>
                      <kbd>Ctrl / ⌘</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd>
                    </dd>
                  </div>
                  <div>
                    <dt>Move through dock</dt>
                    <dd>
                      <kbd>←</kbd> <kbd>→</kbd>
                    </dd>
                  </div>
                  <div>
                    <dt>Close a panel</dt>
                    <dd>
                      <kbd>Esc</kbd>
                    </dd>
                  </div>
                </dl>
              </details>
              {savedSessions.some((s) => s.id !== sessionId && s.layout.windows.length > 0) && (
                <h3>Continue another session</h3>
              )}
              {savedSessions
                .filter((s) => s.id !== sessionId && s.layout.windows.length)
                .slice(0, 5)
                .map((saved) => (
                  <button
                    key={saved.id}
                    onClick={() =>
                      request(
                        () => {
                          setSession(parseDesktopSession(saved.layout));
                          setControl(false);
                          setShowDesktop(false);
                        },
                        undefined,
                        'exit',
                      )
                    }
                  >
                    <RotateCcw size={16} />
                    <span>
                      Continue {saved.name}
                      <small>
                        {[
                          ...new Set(
                            saved.layout.windows.map((w) => getApp(w.appId)?.label).filter(Boolean),
                          ),
                        ]
                          .slice(0, 3)
                          .join(' · ')}
                      </small>
                      <small>
                        {saved.layout.windows.length}{' '}
                        {saved.layout.windows.length === 1 ? 'window' : 'windows'} ·{' '}
                        {new Date(saved.updatedAt).toLocaleString()}
                      </small>
                    </span>
                  </button>
                ))}
            </div>
          </Modal>
          {runtimeReview && <DesktopRuntimeReview />}
        </div>
      </ModalPortalProvider>
    </MotionConfig>
  );
}
