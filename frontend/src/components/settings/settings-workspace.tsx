'use client';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronRight, Search, Settings2, UserRound, X } from 'lucide-react';
import {
  AppIcon,
  Btn,
  ConfirmDialog,
  PageHeader,
  SkeletonCardGrid,
  showToast,
  type AppIconName,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { useMotionPreference } from '@/hooks/use-motion-preference';
import { useRequestGuard } from '@/hooks/use-request-guard';
import { WorkspaceControls } from './workspace-controls';
import './settings-workspace.css';

export interface SettingEntry {
  id: string;
  category: string;
  name: string;
  description: string;
  href: string;
  permission?: string;
  scope: 'GROUP' | 'COMPANY' | 'USER';
  status: 'BUILT_IN' | 'PLANNED';
}
const AREAS: Record<string, { label: string; icon: AppIconName; description: string }> = {
  ORGANIZATION: {
    label: 'Organization',
    icon: 'company',
    description: 'Your companies and business identity.',
  },
  USERS_ACCESS: {
    label: 'People & access',
    icon: 'customers',
    description: 'Accounts, roles and access to your workspace.',
  },
  ACCOUNTING: {
    label: 'Finance',
    icon: 'finance',
    description: 'Accounts, periods and financial controls.',
  },
  HR: { label: 'People & payroll', icon: 'hr', description: 'Set up your people operations.' },
  COMPLIANCE: {
    label: 'Compliance & tax',
    icon: 'tax',
    description: 'Tax authorities, rules and obligations.',
  },
  OPERATIONS: {
    label: 'Operations',
    icon: 'inventory',
    description: 'The reference data behind daily operations.',
  },
  TEMPLATES: {
    label: 'Documents',
    icon: 'document',
    description: 'Templates for your business documents.',
  },
  NOTIFICATIONS: {
    label: 'Notifications',
    icon: 'bell',
    description: 'Your messages and delivery preferences.',
  },
  INTEGRATIONS: {
    label: 'Connections',
    icon: 'transfer',
    description: 'Services connected to your business.',
  },
  APPROVALS: {
    label: 'Approvals',
    icon: 'approved',
    description: 'How requests move through your organization.',
  },
  LOCALIZATION: {
    label: 'Language & region',
    icon: 'settings',
    description: 'Regional formats and localization.',
  },
  PREFERENCES: {
    label: 'My preferences',
    icon: 'settings',
    description: 'Formatting and default company scope.',
  },
  SYSTEM: {
    label: 'System',
    icon: 'settings',
    description: 'Administration and system configuration.',
  },
};
const SCOPE = { GROUP: 'Group-wide', COMPANY: 'Company', USER: 'Personal' };

export function SettingsWorkspace({
  embedded = false,
  onNavigate,
}: {
  embedded?: boolean;
  onNavigate?: (href: string) => void;
}) {
  const { user, hasPermission } = useAuth();
  const theme = useTheme();
  const motion = useMotionPreference();
  const startRequest = useRequestGuard();
  const [entries, setEntries] = useState<SettingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [area, setArea] = useState('WORKSPACE');
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('ALL');
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const contentId = useId();
  const load = useCallback(async () => {
    const request = startRequest();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/backend/settings/catalog', { signal: request.signal });
      if (!response.ok)
        throw new Error(
          'Business settings could not be loaded. Your personal controls are still available.',
        );
      const json = await response.json();
      const data = json.data ?? json;
      if (!Array.isArray(data.entries))
        throw new Error('The settings catalog returned an unexpected response.');
      if (request.current()) setEntries(data.entries);
    } catch (reason) {
      if (request.current())
        setError(
          reason instanceof Error ? reason.message : 'Settings are unavailable. Please try again.',
        );
    } finally {
      if (request.current()) setLoading(false);
    }
  }, [startRequest]);
  useEffect(() => {
    void load();
  }, [load]);
  const allowed = useMemo(
    () => entries.filter((entry) => !entry.permission || hasPermission(entry.permission)),
    [entries, hasPermission],
  );
  const categories = Object.keys(AREAS).filter((key) =>
    allowed.some((entry) => entry.category === key),
  );
  const query = search.trim().toLowerCase();
  const personal = area === 'WORKSPACE' && !query;
  const filtered = allowed.filter((entry) => {
    const matchesArea = query || area === 'ALL' || area === 'WORKSPACE' || entry.category === area;
    return (
      matchesArea &&
      (scope === 'ALL' || scope === entry.scope) &&
      (!query ||
        [entry.name, entry.description, AREAS[entry.category]?.label, SCOPE[entry.scope]].some(
          (value) => value?.toLowerCase().includes(query),
        ))
    );
  });
  function selectArea(next: string) {
    setArea(next);
    setSearch('');
    setScope('ALL');
    heading.current?.focus();
  }
  function settingLink(entry: SettingEntry) {
    const contents = (
      <>
        <span className="settings-row-icon">
          <AppIcon name={AREAS[entry.category]?.icon ?? 'settings'} size={19} />
        </span>
        <span className="settings-row-copy">
          <strong>{entry.name}</strong>
          <small>{entry.description}</small>
        </span>
        <span className="settings-scope">
          {entry.status === 'PLANNED' ? 'Planned' : SCOPE[entry.scope]}
        </span>
        {entry.status !== 'PLANNED' && <ChevronRight size={16} aria-hidden />}
      </>
    );
    return entry.status === 'PLANNED' ? (
      <div key={entry.id} className="settings-link settings-planned" aria-disabled="true">
        {contents}
      </div>
    ) : (
      <Link
        key={entry.id}
        className="settings-link"
        href={entry.href}
        onClick={(event) => {
          if (onNavigate && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
            event.preventDefault();
            onNavigate(entry.href);
          }
        }}
      >
        {contents}
      </Link>
    );
  }
  async function reset() {
    setConfirmReset(false);
    setResetting(true);
    setNotice('');
    try {
      const response = await fetch('/api/backend/user-preferences/me', { method: 'DELETE' });
      if (!response.ok) throw new Error('Your preferences could not be reset. Please try again.');
      theme.setMode('system');
      motion.setMode('system');
      setNotice('Personal display, formatting and default scope restored.');
      showToast('success', 'Preferences reset', 'Your personal preferences are back to defaults.');
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Reset failed.');
    } finally {
      setResetting(false);
    }
  }
  return (
    <div className={`settings-workspace ${embedded ? 'settings-embedded' : ''}`}>
      {!embedded && <PageHeader title="Settings" subtitle="A workspace that feels like yours." />}
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-account">
            <span>
              <UserRound size={22} />
            </span>
            <div>
              <strong>{user?.fullName || 'Your account'}</strong>
              <small>{user?.email || 'Personal workspace'}</small>
            </div>
          </div>
          <label className="settings-search">
            <Search size={16} aria-hidden />
            <input
              type="search"
              placeholder="Search settings"
              aria-label="Search settings"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Clear settings search">
                <X size={15} />
              </button>
            )}
          </label>
          <nav aria-label="Settings categories">
            <button
              aria-current={personal ? 'page' : undefined}
              aria-controls={contentId}
              onClick={() => selectArea('WORKSPACE')}
            >
              <Settings2 size={17} />
              My workspace
            </button>
            <p>Business settings</p>
            {categories.map((key) => (
              <button
                key={key}
                aria-current={!query && area === key ? 'page' : undefined}
                aria-controls={contentId}
                onClick={() => selectArea(key)}
              >
                <AppIcon name={AREAS[key].icon} size={17} />
                {AREAS[key].label}
              </button>
            ))}
            <button
              aria-current={!query && area === 'ALL' ? 'page' : undefined}
              aria-controls={contentId}
              onClick={() => selectArea('ALL')}
            >
              <Settings2 size={17} />
              All settings
            </button>
          </nav>
        </aside>
        <section className="settings-content" id={contentId}>
          <header className="settings-section-heading">
            <h2 ref={heading} tabIndex={-1}>
              {query
                ? 'Search results'
                : personal
                  ? 'My workspace'
                  : (AREAS[area]?.label ?? 'All settings')}
            </h2>
            <p>
              {query
                ? `Settings matching “${search.trim()}”`
                : personal
                  ? 'Small details. A more comfortable day.'
                  : (AREAS[area]?.description ?? 'Everything you can configure in one place.')}
            </p>
          </header>
          {personal && (
            <>
              <WorkspaceControls />
              {allowed.some((entry) => entry.scope === 'USER') && (
                <section className="settings-personal-links">
                  <h3>Account preferences</h3>
                  <div className="settings-group">
                    {allowed.filter((entry) => entry.scope === 'USER').map(settingLink)}
                  </div>
                </section>
              )}
            </>
          )}
          {error && (
            <div className="settings-error" role="alert">
              <p>{error}</p>
              <Btn variant="secondary" onClick={load}>
                Try again
              </Btn>
            </div>
          )}
          {loading && (
            <div role="status" aria-label="Loading business settings">
              <SkeletonCardGrid count={2} />
            </div>
          )}
          {!personal && !loading && !error && (
            <>
              <div className="settings-results-bar">
                <span role="status">
                  {filtered.length} {filtered.length === 1 ? 'setting' : 'settings'}
                </span>
                <label>
                  Scope
                  <select value={scope} onChange={(event) => setScope(event.target.value)}>
                    <option value="ALL">All scopes</option>
                    {Object.entries(SCOPE).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {filtered.length ? (
                <div className="settings-group">{filtered.map(settingLink)}</div>
              ) : (
                <div className="settings-empty">
                  <Search size={25} aria-hidden />
                  <h3>No settings found</h3>
                  <p>Try a different word or clear the filters.</p>
                  <Btn
                    variant="secondary"
                    onClick={() => {
                      setSearch('');
                      setScope('ALL');
                      setArea('ALL');
                    }}
                  >
                    Clear filters
                  </Btn>
                </div>
              )}
            </>
          )}
          {personal && (
            <section className="settings-reset">
              <div>
                <h3>Restore personal defaults</h3>
                <p>
                  Reset display, formatting and default company scope. App pins and business records
                  stay as they are.
                </p>
              </div>
              <Btn variant="secondary" loading={resetting} onClick={() => setConfirmReset(true)}>
                Restore defaults
              </Btn>
            </section>
          )}
          {notice && (
            <p className="settings-notice" role="status">
              {notice}
            </p>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={confirmReset}
        title="Restore personal defaults?"
        message="This resets your personal display, formatting and default company scope. It does not change app pins or business records."
        confirmLabel="Restore defaults"
        variant="warning"
        onConfirm={reset}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
