'use client';
import { useGuardedRouter, useUnsavedWork } from '@/components/workspace/unsaved-work-provider';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  Building2,
  ChartNoAxesCombined,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  House,
  LayoutGrid,
  Menu,
  Minus,
  Search,
  ShoppingBag,
  Users,
  Wallet,
  X,
  Maximize2,
  Plus,
  Columns2,
} from 'lucide-react';
import { NAV, isGroup, type NavLeaf } from '@/components/layout/sidebar';
import { useAuth } from '@/hooks/use-auth';
import { recordVisit } from '@/hooks/use-personalization';
import { useWorkspacePreferences } from '@/hooks/use-workspace-preferences';
import { readWorkspace } from '@/lib/workspace-preferences';
import { useCommandPalette } from '@/components/aurora/command/CommandPaletteProvider';
import { Modal } from '@/components/ui/modal';
import { SettingsWorkspace } from '@/components/settings/settings-workspace';
import { AppsHome } from '@/components/apps/apps-home';
import { MsaidiziTopbarButton } from '@/components/msaidizi/msaidizi-launcher';
import { AppLauncher } from '@/components/apps/app-launcher';
import { PayrollWorkspace } from '@/features/payroll/payroll-workspace';
import {
  APP_REGISTRY,
  appForPath,
  canOpenApp,
  getApp,
  isAppPath,
  type WorkspaceApp,
} from '@/lib/apps';
import { motion } from 'motion/react';
import { OsMotion } from './os-motion';
import { OsNotifications } from './os-notifications';
import { OsDock } from './os-dock';
import { OsAccountMenu } from './os-account-menu';
import { OsAppSwitcher } from './os-app-switcher';
import { PanelsTopLeft } from 'lucide-react';
import { OsSplitWorkspace, type WorkspacePane } from './os-split-workspace';
import './os-shell.css';
import './legacy-workspace.css';
import './os-foundation.css';

const sections = [
  { label: 'Overview', source: 'Dashboard', icon: House },
  { label: 'Companies', source: 'Registry', icon: Building2 },
  { label: 'Operations', source: 'Operations', icon: ShoppingBag },
  { label: 'Finance', source: 'Finance', icon: Wallet },
  { label: 'People', source: 'HR & Payroll', icon: Users },
  { label: 'Approvals', source: 'Approvals', icon: CheckCheck },
  { label: 'Reports', source: 'Reports', icon: ChartNoAxesCombined },
];

export function OsShell({
  children,
  appUrls,
}: {
  children: React.ReactNode;
  appUrls: Record<string, string | null>;
}) {
  const pathname = usePathname();
  const router = useGuardedRouter();
  const { request: protectWork } = useUnsavedWork();
  const { user, hasPermission, logout } = useAuth();
  const { open: openSearch } = useCommandPalette();
  const [desktop, setDesktop] = useState(pathname === '/apps');
  const shellRef = useRef<HTMLDivElement>(null);
  const [overlayId, setOverlayId] = useState<string | null>(null);
  const surfaceKey = desktop ? 'desktop' : `${pathname}:${overlayId ?? ''}`;
  const previousSurface = useRef(surfaceKey);
  const [companionId, setCompanionId] = useState<string | null>(null);
  const [activePane, setActivePane] = useState<WorkspacePane>('primary');
  const [companionPicker, setCompanionPicker] = useState(false);
  const companionTrigger = useRef<HTMLButtonElement>(null);
  const { preferences: workspace, update: updateWorkspace } = useWorkspacePreferences(user?.id);
  const maximized = workspace.maximized;
  const [mobileNav, setMobileNav] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  const navigationTrigger = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [directory, setDirectory] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const [moduleQuery, setModuleQuery] = useState('');
  const [preferences, setPreferences] = useState(false);
  const preferencesTrigger = useRef<HTMLElement>(null);
  const switcherTrigger = useRef<HTMLButtonElement>(null);
  const [date, setDate] = useState('');
  const startupChecked = useRef<string | null>(null);
  const routeApp = appForPath(pathname);
  const overlayApp = overlayId ? getApp(overlayId) : undefined;
  const currentApp = overlayApp ?? routeApp;
  const standalone = !!currentApp;
  const appName = currentApp?.label ?? 'ITEMBA-R';
  const companionCandidate = companionId ? getApp(companionId) : undefined;
  const companion =
    companionCandidate &&
    companionId !== routeApp?.id &&
    canOpenApp(companionCandidate, hasPermission)
      ? companionCandidate
      : null;
  const activeApp = activePane === 'companion' && companion ? companion : currentApp;
  const activeAppId = activeApp?.id ?? 'itemba-r';
  const canSee = (item: { permission?: string; permissionsAny?: string[] }) =>
    (!item.permission || hasPermission(item.permission)) &&
    (!item.permissionsAny?.length || item.permissionsAny.some((p) => hasPermission(p)));
  const groups = NAV.flatMap((item) => {
    if (!isGroup(item))
      return !item.sidebarHidden && item.href !== '/apps' && canSee(item)
        ? [{ label: item.label, links: [item] }]
        : [];
    const links = item.children.filter((child) =>
      canSee({
        permission: child.permission ?? item.permission,
        permissionsAny: child.permissionsAny ?? item.permissionsAny,
      }),
    );
    return links.length ? [{ label: item.label, links }] : [];
  });
  useEffect(() => {
    setDesktop(pathname === '/apps');
    setActivePane('primary');
    // The navigation guard protects both copies before moving a companion into the main route.
    setCompanionId((current) => (appForPath(pathname)?.id === current ? null : current));
    setMobileNav(false);
    setOverlayId(null);
    if (pathname === '/apps') {
      if (new URLSearchParams(window.location.search).get('settings') === '1') setPreferences(true);
      return;
    }
    const app = appForPath(pathname);
    const id = app?.id ?? 'itemba-r';
    updateWorkspace((current) => ({
      ...current,
      ...(app ? {} : { lastErpPath: pathname }),
      lastApp: id,
      recentApps: [id, ...current.recentApps.filter((value) => value !== id)].slice(0, 8),
    }));
  }, [pathname, updateWorkspace]);
  function safeErpPath(saved: string) {
    const permitted = groups
      .flatMap((group) => group.links)
      .filter((link) => link.href !== '/apps' && !isAppPath(link.href));
    const matched = NAV.flatMap((item) =>
      isGroup(item)
        ? item.children.map((child) => ({
            ...child,
            permission: child.permission ?? item.permission,
            permissionsAny: child.permissionsAny ?? item.permissionsAny,
          }))
        : [item],
    )
      .filter(
        (link) =>
          link.href !== '/apps' &&
          !isAppPath(link.href) &&
          (saved === link.href || saved.startsWith(`${link.href}/`)),
      )
      .sort((a, b) => b.href.length - a.href.length)[0];
    return matched && canSee(matched)
      ? saved
      : (permitted.find((link) => link.href === '/dashboard')?.href ??
          permitted[0]?.href ??
          '/dashboard');
  }
  useEffect(() => {
    if (!user?.id || startupChecked.current === user.id) return;
    startupChecked.current = user.id;
    const saved = readWorkspace(user.id);
    if (pathname !== '/apps' || saved.startup !== 'resume') return;
    const app = getApp(saved.lastApp);
    if (app && canOpenApp(app, hasPermission) && app.launch.kind === 'external') {
      setOverlayId(app.id);
      setDesktop(false);
    } else if (app && canOpenApp(app, hasPermission) && app.launch.kind === 'route')
      router.replace(app.href);
    else router.replace(safeErpPath(saved.lastErpPath));
    // The startup decision runs once per authenticated account, not on later navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  useEffect(() => {
    const update = () =>
      setDate(
        new Date().toLocaleString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
      );
    update();
    const interval = window.setInterval(update, 30_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        !event.defaultPrevented &&
        !event.repeat &&
        !event.isComposing &&
        !event.altKey &&
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.code === 'Space'
      ) {
        const dialog =
          (event.target instanceof Element
            ? event.target.closest('[role="dialog"], dialog')
            : null) ??
          document.querySelector(
            '[role="dialog"][aria-modal="true"]:not([aria-hidden="true"]), dialog[open]',
          );
        // A financial review or unsaved-work confirmation keeps ownership of focus.
        if (dialog && !dialog.querySelector('[data-os-switcher]')) return;
        event.preventDefault();
        setSwitcher((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (previousSurface.current === surfaceKey) return;
    previousSurface.current = surfaceKey;
    shellRef.current?.querySelector<HTMLElement>('#os-content')?.focus({ preventScroll: true });
  }, [surfaceKey]);
  function openErp() {
    setOverlayId(null);
    updateWorkspace((current) => ({
      ...current,
      lastApp: 'itemba-r',
      recentApps: ['itemba-r', ...current.recentApps.filter((id) => id !== 'itemba-r')].slice(0, 8),
    }));
    if (pathname === '/apps' || !!routeApp) router.push(safeErpPath(workspace.lastErpPath));
    else setDesktop(false);
  }
  function openPreferences(trigger?: HTMLElement | null) {
    const focused = trigger ?? (document.activeElement as HTMLElement | null);
    preferencesTrigger.current = focused?.closest('[role="dialog"]')
      ? switcherTrigger.current
      : focused;
    setPreferences(true);
  }
  function openApp(app: WorkspaceApp) {
    if (!canOpenApp(app, hasPermission)) return;
    if (companion?.id === app.id) {
      setDesktop(false);
      setActivePane('companion');
      return;
    }
    setActivePane('primary');
    if (app.launch.kind === 'workspace') {
      openErp();
      return;
    }
    updateWorkspace((current) => ({
      ...current,
      lastApp: app.launch.kind === 'settings' ? current.lastApp : app.id,
      recentApps: [app.id, ...current.recentApps.filter((id) => id !== app.id)].slice(0, 8),
    }));
    if (app.launch.kind === 'settings') {
      openPreferences();
      return;
    }
    recordVisit({ href: app.href, label: app.label, iconKey: app.iconKey, group: 'Apps' });
    if (app.launch.kind === 'external') {
      setOverlayId(routeApp?.id === app.id ? null : app.id);
      setDesktop(false);
    } else if (pathname === app.href) {
      // Restoring a local app is a window action; same-route pushes do not
      // trigger the pathname effect that opens a newly navigated workspace.
      setOverlayId(null);
      setDesktop(false);
    } else router.push(app.href);
  }
  function visit(href: string) {
    setDirectory(false);
    setMobileNav(false);
    setDesktop(false);
    router.push(href);
  }
  const initials = (user?.fullName || 'User')
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('');

  return (
    <OsMotion>
      <div
        ref={shellRef}
        className={`itemba-os ${maximized ? 'os-maximized' : ''}`}
        data-density={workspace.density}
        data-backdrop={workspace.backdrop}
        data-transparency={workspace.transparency}
      >
        <a className="os-skip" href="#os-content">
          Skip to workspace
        </a>
        <header className="os-menubar">
          <button
            className="os-brand"
            onClick={() => setDesktop(true)}
            aria-label="ITEMBA OS desktop"
          >
            <span className="os-crest">
              <Image src="/brand/itemba-group-logo.png" alt="" width={92} height={92} />
            </span>
            <strong>ITEMBA OS</strong>
          </button>
          <span className="os-current-app">
            {desktop ? 'Desktop' : (activeApp?.label ?? 'ITEMBA-R')}
          </span>
          <div className="os-system-actions">
            <button
              title="Search workspace (Ctrl K)"
              aria-label="Search workspace"
              onClick={openSearch}
            >
              <Search size={17} />
            </button>
            <OsNotifications onNavigate={visit} />
            <button
              type="button"
              aria-label="Switch apps"
              ref={switcherTrigger}
              title="Switch apps (Ctrl / ⌘ + Shift + Space)"
              onClick={() => setSwitcher(true)}
            >
              <PanelsTopLeft size={18} />
            </button>
            <OsAccountMenu
              initials={initials}
              name={user?.fullName}
              email={user?.email}
              onSettings={openPreferences}
              onSignOut={() => protectWork(() => void logout())}
            />
            <time className="os-clock">{date}</time>
          </div>
        </header>

        <div
          className="os-desktop"
          hidden={!desktop}
          id={desktop ? 'os-content' : undefined}
          tabIndex={-1}
          role="region"
          aria-label="Apps desktop"
        >
          <AppsHome onOpenApp={openApp} onOpenSettings={() => openPreferences()} />
        </div>

        <OsSplitWorkspace
          primaryId={routeApp?.id ?? 'itemba-r'}
          primaryName={appName}
          companion={companion}
          activePane={activePane}
          onActivePane={setActivePane}
          onCompanion={(app) => {
            setCompanionId(app?.id ?? null);
            if (app)
              updateWorkspace((current) => ({
                ...current,
                recentApps: [app.id, ...current.recentApps.filter((id) => id !== app.id)].slice(
                  0,
                  8,
                ),
              }));
          }}
          hidden={desktop}
          pickerOpen={companionPicker}
          onPickerOpen={(trigger) => {
            companionTrigger.current = trigger;
            setCompanionPicker(true);
          }}
          onPickerClose={() => setCompanionPicker(false)}
          pickerTrigger={companionTrigger}
          hasPermission={hasPermission}
        >
          <motion.section
            className="os-window"
            hidden={desktop}
            aria-label={`${appName} workspace`}
            initial={false}
            animate={{ opacity: desktop ? 0 : 1, y: desktop ? 10 : 0 }}
          >
            <header className="os-titlebar">
              <div className="os-window-controls">
                <button
                  className="os-control-close"
                  onClick={() => setDesktop(true)}
                  aria-label="Return to desktop"
                  title="Return to desktop"
                >
                  <X size={10} />
                </button>
                <button
                  className="os-control-minimize"
                  onClick={() => setDesktop(true)}
                  aria-label="Minimize window"
                  title="Minimize"
                >
                  <Minus size={10} />
                </button>
                <button
                  className="os-control-maximize"
                  onClick={() =>
                    updateWorkspace((current) => ({ ...current, maximized: !current.maximized }))
                  }
                  aria-label={maximized ? 'Restore window size' : 'Maximize window'}
                  title={maximized ? 'Restore' : 'Maximize'}
                >
                  <Maximize2 size={8} />
                </button>
              </div>
              {!standalone && (
                <button
                  ref={navigationTrigger}
                  className="os-mobile-menu"
                  aria-label="Toggle navigation"
                  aria-expanded={mobileNav}
                  aria-controls="erp-navigation"
                  onClick={() => {
                    setMobileNav((value) => !value);
                    if (!mobileNav)
                      requestAnimationFrame(() =>
                        navigationRef.current?.querySelector<HTMLElement>('a, button')?.focus(),
                      );
                  }}
                >
                  <Menu size={19} />
                </button>
              )}
              <strong>{appName}</strong>
              <span className="os-window-caption">
                {currentApp?.category ?? 'Business workspace'}
              </span>
              <div className="os-window-tools">
                <MsaidiziTopbarButton />
                <button
                  type="button"
                  ref={companionTrigger}
                  onClick={(event) => {
                    companionTrigger.current = event.currentTarget;
                    setCompanionPicker(true);
                  }}
                  aria-label="Work side by side"
                  title="Work side by side"
                >
                  <Columns2 size={17} />
                </button>
                <button
                  onClick={openSearch}
                  aria-label="Find a page or create a record"
                  title="Find a page or create a record"
                >
                  <Plus size={17} />
                </button>
              </div>
            </header>
            <div className="os-window-body">
              {!standalone && (
                <>
                  {mobileNav && (
                    <button
                      className="os-nav-scrim"
                      aria-label="Close navigation"
                      onClick={() => {
                        setMobileNav(false);
                        navigationTrigger.current?.focus();
                      }}
                    />
                  )}
                  <aside
                    ref={navigationRef}
                    id="erp-navigation"
                    className={`os-sidebar ${mobileNav ? 'os-sidebar-open' : ''}`}
                    aria-label="ERP navigation"
                    onKeyDown={(event) => {
                      if (event.key === 'Escape' && mobileNav) {
                        event.preventDefault();
                        setMobileNav(false);
                        navigationTrigger.current?.focus();
                      }
                    }}
                  >
                    <span className="os-sidebar-label">Workspace</span>
                    <nav>
                      {sections.map((section) => {
                        const group = groups.find((g) => g.label === section.source);
                        if (!group) return null;
                        const primary =
                          section.label === 'Approvals'
                            ? (group.links.find((l) => l.href === '/approvals/pending') ??
                              group.links[0])
                            : section.label === 'Companies'
                              ? (group.links.find((l) => l.href === '/companies') ?? group.links[0])
                              : group.links[0];
                        const active = group.links.some(
                          (l) =>
                            pathname === l.href ||
                            (l.href !== '/dashboard' && pathname.startsWith(`${l.href}/`)),
                        );
                        return (
                          <div key={section.label} className="os-nav-group">
                            <div className={`os-nav-row ${active ? 'is-active' : ''}`}>
                              <Link
                                href={primary.href}
                                onClick={() => setMobileNav(false)}
                                aria-current={active ? 'page' : undefined}
                              >
                                <section.icon size={18} strokeWidth={1.65} />
                                {section.label}
                              </Link>
                              {group.links.length > 1 && (
                                <button
                                  aria-label={`${section.label} pages`}
                                  aria-expanded={expanded === section.label}
                                  onClick={() =>
                                    setExpanded(expanded === section.label ? null : section.label)
                                  }
                                >
                                  {expanded === section.label ? (
                                    <ChevronDown size={14} />
                                  ) : (
                                    <ChevronRight size={14} />
                                  )}
                                </button>
                              )}
                            </div>
                            {expanded === section.label && (
                              <div className="os-subnav">
                                {group.links.map((link) => (
                                  <Link
                                    href={link.href}
                                    key={link.href}
                                    onClick={() => setMobileNav(false)}
                                    aria-current={pathname === link.href ? 'page' : undefined}
                                  >
                                    {link.label}
                                  </Link>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </nav>
                    <button
                      className="os-browse"
                      onClick={() => {
                        setDirectory(true);
                        setMobileNav(false);
                      }}
                    >
                      <LayoutGrid size={17} /> All modules <ChevronRight size={14} />
                    </button>
                    <div className="os-sidebar-bottom">
                      <Building2 size={18} />
                      <div>
                        <strong>{user?.companyId ? 'Company workspace' : 'Group workspace'}</strong>
                        <span>ITEMBA-R</span>
                      </div>
                    </div>
                  </aside>
                </>
              )}
              <main
                className="os-page"
                aria-label={`${appName} content`}
                tabIndex={-1}
                id={!desktop && (activePane === 'primary' || !companion) ? 'os-content' : undefined}
              >
                <div className="os-route-content" hidden={!!overlayApp}>
                  {routeApp?.id === 'payroll' ? (
                    <PayrollWorkspace>{children}</PayrollWorkspace>
                  ) : (
                    children
                  )}
                </div>
                {overlayApp && (
                  <div className="os-route-content">
                    <AppLauncher
                      app={overlayApp}
                      appUrl={appUrls[overlayApp.id] ?? null}
                      onBack={() => setDesktop(true)}
                    />
                  </div>
                )}
              </main>
            </div>
          </motion.section>
        </OsSplitWorkspace>

        <OsDock
          desktop={desktop}
          activeAppId={activeAppId}
          settingsOpen={preferences}
          onDesktop={() => setDesktop((value) => (pathname === '/apps' ? true : !value))}
          onOpen={openApp}
          apps={APP_REGISTRY.filter(
            (app) =>
              canOpenApp(app, hasPermission) &&
              (app.launch.kind === 'settings' ||
                workspace.pinnedApps.includes(app.id) ||
                companion?.id === app.id ||
                (!desktop && activeAppId === app.id)),
          )}
        />
        <OsAppSwitcher
          open={switcher}
          onClose={() => setSwitcher(false)}
          onOpen={openApp}
          apps={APP_REGISTRY.filter((app) => canOpenApp(app, hasPermission))}
          recentIds={workspace.recentApps}
          activeAppId={desktop ? null : activeAppId}
        />

        <Modal
          open={directory}
          onClose={() => setDirectory(false)}
          title="All modules"
          subtitle="Everything in your business workspace."
          size="lg"
        >
          <div className="os-directory">
            <label className="os-directory-search">
              <Search size={18} />
              <input
                autoFocus
                placeholder="Find a module or page…"
                aria-label="Search modules"
                value={moduleQuery}
                onChange={(e) => setModuleQuery(e.target.value)}
              />
            </label>
            <div className="os-directory-grid">
              {groups.flatMap((group) => {
                const links = group.links.filter((l) =>
                  `${group.label} ${l.label}`.toLowerCase().includes(moduleQuery.toLowerCase()),
                );
                return links.length
                  ? [
                      <section key={group.label}>
                        <h3>{group.label}</h3>
                        {links.map((l: NavLeaf) => (
                          <button key={l.href} onClick={() => visit(l.href)}>
                            {l.label}
                            <ChevronRight size={13} />
                          </button>
                        ))}
                      </section>,
                    ]
                  : [];
              })}
              {!groups.some((g) =>
                g.links.some((l) =>
                  `${g.label} ${l.label}`.toLowerCase().includes(moduleQuery.toLowerCase()),
                ),
              ) && <p>No pages match your search.</p>}
            </div>
          </div>
        </Modal>
        <Modal
          open={preferences}
          onClose={() => setPreferences(false)}
          title="System settings"
          returnFocusRef={preferencesTrigger}
          subtitle="Make this workspace feel like yours."
          size="2xl"
        >
          <SettingsWorkspace
            embedded
            onNavigate={(href) => {
              setPreferences(false);
              visit(href);
            }}
          />
        </Modal>
      </div>
    </OsMotion>
  );
}
