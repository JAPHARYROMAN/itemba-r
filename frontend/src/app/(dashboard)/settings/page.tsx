'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppIcon,
  type AppIconName,
  Btn,
  Card,
  PageHeader,
  SkeletonCardGrid,
  showToast,
} from '@/components/ui';
import { useMotionPreference } from '@/hooks/use-motion-preference';
import { useTheme } from '@/hooks/use-theme';

type SettingCategory =
  | 'ORGANIZATION'
  | 'USERS_ACCESS'
  | 'ACCOUNTING'
  | 'HR'
  | 'COMPLIANCE'
  | 'OPERATIONS'
  | 'TEMPLATES'
  | 'NOTIFICATIONS'
  | 'INTEGRATIONS'
  | 'APPROVALS'
  | 'LOCALIZATION'
  | 'PREFERENCES'
  | 'SYSTEM';
type SettingScope = 'GROUP' | 'COMPANY' | 'USER';
type SettingStatus = 'BUILT_IN' | 'PLANNED';

interface SettingEntry {
  id: string;
  category: SettingCategory;
  name: string;
  description: string;
  href: string;
  permission?: string;
  scope: SettingScope;
  status: SettingStatus;
}

interface CatalogResponse {
  total: number;
  filtered: number;
  categories: SettingCategory[];
  categoryCounts: Record<string, number>;
  entries: SettingEntry[];
}

interface SettingShortcut {
  id: string;
  title: string;
  description: string;
  href: string;
  icon: AppIconName;
  badge: string;
}

const CATEGORY_META: Record<SettingCategory, { label: string; icon: AppIconName }> = {
  ORGANIZATION: { label: 'Organization', icon: 'company' },
  USERS_ACCESS: { label: 'Users and access', icon: 'customers' },
  ACCOUNTING: { label: 'Finance setup', icon: 'finance' },
  HR: { label: 'HR setup', icon: 'hr' },
  COMPLIANCE: { label: 'Compliance and tax', icon: 'tax' },
  OPERATIONS: { label: 'Operations setup', icon: 'inventory' },
  TEMPLATES: { label: 'Templates', icon: 'document' },
  NOTIFICATIONS: { label: 'Notifications', icon: 'bell' },
  INTEGRATIONS: { label: 'Integrations', icon: 'transfer' },
  APPROVALS: { label: 'Approvals', icon: 'approved' },
  LOCALIZATION: { label: 'Localization', icon: 'settings' },
  PREFERENCES: { label: 'My workspace', icon: 'settings' },
  SYSTEM: { label: 'System', icon: 'settings' },
};

const SCOPE_META: Record<SettingScope, { label: string; tone: string }> = {
  GROUP: { label: 'Group-wide', tone: 'bg-violet-50 text-violet-700 border-violet-200' },
  COMPANY: { label: 'Company', tone: 'bg-blue-50 text-blue-700 border-blue-200' },
  USER: { label: 'Personal', tone: 'bg-zinc-100 text-zinc-700 border-zinc-200' },
};

const START_HERE: SettingShortcut[] = [
  {
    id: 'access.preferences',
    title: 'My workspace',
    description: 'Theme, screen density, language, date format, and default company scope.',
    href: '/settings/preferences',
    icon: 'settings',
    badge: 'Personal',
  },
  {
    id: 'org.company-profile',
    title: 'Company letterhead',
    description: 'Logo, legal identity, address, tax details, and document letterhead.',
    href: '/settings/company-profile',
    icon: 'company',
    badge: 'Company',
  },
  {
    id: 'acct.number-sequences',
    title: 'Document numbers',
    description: 'Prefixes and counters for invoices, sales orders, purchases, receipts, and more.',
    href: '/settings/number-sequences',
    icon: 'sequence',
    badge: 'Finance',
  },
  {
    id: 'acct.cash-accounts',
    title: 'Cash and bank accounts',
    description: 'Cash drawers, bank accounts, mobile money accounts, and GL links.',
    href: '/finance/cash-accounts',
    icon: 'cash',
    badge: 'Finance',
  },
];

const SETUP_SECTIONS: Array<{
  title: string;
  description: string;
  items: SettingShortcut[];
}> = [
  {
    title: 'Organization and access',
    description: 'Who can use the system and which entities they work with.',
    items: [
      {
        id: 'org.companies',
        title: 'Companies',
        description: 'Create or update group companies.',
        href: '/companies',
        icon: 'company',
        badge: 'Group',
      },
      {
        id: 'access.users',
        title: 'Users',
        description: 'Add, disable, or review user accounts.',
        href: '/users',
        icon: 'customers',
        badge: 'Access',
      },
      {
        id: 'access.roles',
        title: 'Roles and permissions',
        description: 'Control what each user role can see or change.',
        href: '/roles',
        icon: 'security',
        badge: 'Access',
      },
    ],
  },
  {
    title: 'Finance controls',
    description: 'Accounting structure and period controls used by transactions.',
    items: [
      {
        id: 'acct.chart-of-accounts',
        title: 'Chart of accounts',
        description: 'GL accounts used by postings and reports.',
        href: '/finance/chart-of-accounts',
        icon: 'ledger',
        badge: 'Finance',
      },
      {
        id: 'acct.accounting-periods',
        title: 'Accounting periods',
        description: 'Open, close, and control posting periods.',
        href: '/finance/accounting-periods',
        icon: 'calendar',
        badge: 'Finance',
      },
      {
        id: 'acct.fiscal-years',
        title: 'Fiscal years',
        description: 'Manage financial years for each company.',
        href: '/finance/fiscal-years',
        icon: 'calendar',
        badge: 'Finance',
      },
    ],
  },
  {
    title: 'Operations setup',
    description: 'Product structure and operational reference data.',
    items: [
      {
        id: 'ops.units',
        title: 'Units of measure',
        description: 'Pieces, litres, kilograms, service units, and custom units.',
        href: '/operations/units',
        icon: 'calculator',
        badge: 'Operations',
      },
      {
        id: 'ops.product-categories',
        title: 'Product categories',
        description: 'Categories and families used to organize inventory.',
        href: '/operations/product-categories',
        icon: 'inventory',
        badge: 'Operations',
      },
      {
        id: 'tpl.document-templates',
        title: 'Document templates',
        description: 'Templates for printable business documents.',
        href: '/document-templates',
        icon: 'document',
        badge: 'Templates',
      },
    ],
  },
  {
    title: 'Controls and integrations',
    description: 'Workflow, notifications, tax setup, and connected systems.',
    items: [
      {
        id: 'approvals.workflows',
        title: 'Approval workflows',
        description: 'Set who approves transactions and documents.',
        href: '/approvals/workflows',
        icon: 'approved',
        badge: 'Workflow',
      },
      {
        id: 'notif.notifications',
        title: 'Notifications',
        description: 'Manage alerts and delivery channels.',
        href: '/notifications',
        icon: 'bell',
        badge: 'System',
      },
      {
        id: 'tax.authorities',
        title: 'Tax setup',
        description: 'Tax authorities, tax types, rates, and registrations.',
        href: '/compliance/tax-authorities',
        icon: 'tax',
        badge: 'Compliance',
      },
    ],
  },
];

export default function MasterSettingsPage() {
  const { setMode: setThemeMode } = useTheme();
  const { setMode: setMotionMode } = useMotionPreference();
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resetting, setResetting] = useState(false);

  const [scope, setScope] = useState<SettingScope | 'ALL'>('ALL');
  const [category, setCategory] = useState<SettingCategory | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [showDirectory, setShowDirectory] = useState(false);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/backend/settings/catalog');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const data: CatalogResponse = json.data ?? json;
      setCatalog(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load catalog';
      setError(message);
      showToast('error', 'Settings catalog unavailable', message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const entryById = useMemo(() => {
    const map = new Map<string, SettingEntry>();
    for (const entry of catalog?.entries ?? []) map.set(entry.id, entry);
    return map;
  }, [catalog]);

  const filteredEntries = useMemo(() => {
    let list = catalog?.entries ?? [];
    if (scope !== 'ALL') list = list.filter((entry) => entry.scope === scope);
    if (category !== 'ALL') list = list.filter((entry) => entry.category === category);

    const q = search.trim().toLowerCase();
    if (!q) return list;

    return list.filter((entry) => {
      const categoryLabel = CATEGORY_META[entry.category]?.label ?? entry.category;
      return [
        entry.name,
        entry.description,
        entry.href,
        categoryLabel,
        SCOPE_META[entry.scope].label,
      ].some((value) => value.toLowerCase().includes(q));
    });
  }, [catalog, category, scope, search]);

  const availableCategoryOptions = useMemo(() => {
    const categories = catalog?.categories ?? [];
    return [...categories].sort((a, b) => CATEGORY_META[a].label.localeCompare(CATEGORY_META[b].label));
  }, [catalog]);

  const builtInCount = useMemo(
    () => (catalog?.entries ?? []).filter((entry) => entry.status !== 'PLANNED').length,
    [catalog],
  );

  const resetDirectoryFilters = () => {
    setSearch('');
    setScope('ALL');
    setCategory('ALL');
  };

  const resetMyWorkspace = async () => {
    const confirmed = window.confirm(
      'Reset your personal workspace settings to defaults? This affects theme, density, formatting, and default scope only.',
    );
    if (!confirmed) return;

    setResetting(true);
    setNotice('');
    try {
      const res = await fetch('/api/backend/user-preferences/me', { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      setThemeMode('system');
      setMotionMode('system');
      setNotice('Your personal workspace settings were reset to defaults.');
      showToast('success', 'Settings reset', 'Your personal workspace settings are back to defaults.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reset settings';
      showToast('error', 'Settings were not reset', message);
      setNotice(`Reset failed: ${message}`);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Settings"
        subtitle="Plain setup tasks for your workspace, companies, finance controls, operations, and system rules."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="secondary" onClick={() => setShowDirectory((value) => !value)}>
              {showDirectory ? 'Hide directory' : 'Show all settings'}
            </Btn>
            <Btn variant="warning" onClick={resetMyWorkspace} loading={resetting}>
              Reset my workspace
            </Btn>
          </div>
        }
      />

      {notice && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{
            background: notice.startsWith('Reset failed')
              ? 'var(--aurora-danger-bg)'
              : 'var(--aurora-success-bg)',
            borderColor: notice.startsWith('Reset failed')
              ? 'var(--aurora-danger)'
              : 'var(--aurora-success)',
            color: notice.startsWith('Reset failed')
              ? 'var(--aurora-danger-text)'
              : 'var(--aurora-success-text)',
          }}
        >
          {notice}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <SectionHeader
            eyebrow="Start here"
            title="Most-used settings"
            description="These are the setup screens people usually need first."
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {START_HERE.map((item) => (
              <ShortcutCard key={item.id} item={item} catalogEntry={entryById.get(item.id)} emphasis />
            ))}
          </div>
        </div>

        <Card className="p-5">
          <div className="flex items-start gap-3">
            <span
              className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
              style={{ background: 'var(--aurora-primary-subtle)', color: 'var(--aurora-primary)' }}
            >
              <AppIcon name="settings" size={18} />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Reset only affects you
              </div>
              <p className="mt-1 text-sm leading-6" style={{ color: 'var(--aurora-text-secondary)' }}>
                The reset button restores your personal display settings and default company scope.
                It does not erase companies, products, transactions, finance setup, or other users.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <Metric label="Available" value={builtInCount || '-'} />
                <Metric label="Shown now" value={filteredEntries.length || '-'} />
              </div>
            </div>
          </div>
        </Card>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && <SkeletonCardGrid count={4} className="grid grid-cols-1 gap-3 md:grid-cols-2" />}

      {!loading && (
        <section className="space-y-5">
          <SectionHeader
            eyebrow="Setup areas"
            title="Choose what you want to configure"
            description="Each group uses business language first, with advanced catalog details available below."
          />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {SETUP_SECTIONS.map((section) => (
              <Card key={section.title} className="overflow-hidden">
                <div className="border-b px-5 py-4" style={{ borderColor: 'var(--aurora-border)' }}>
                  <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
                    {section.title}
                  </h2>
                  <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                    {section.description}
                  </p>
                </div>
                <div className="divide-y" style={{ borderColor: 'var(--aurora-border)' }}>
                  {section.items.map((item) => (
                    <ShortcutRow key={item.id} item={item} catalogEntry={entryById.get(item.id)} />
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {showDirectory && (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <SectionHeader
              eyebrow="Advanced"
              title="All settings directory"
              description="Use this when you know the exact setup screen you need."
            />
            <Btn variant="secondary" onClick={resetDirectoryFilters}>
              Clear filters
            </Btn>
          </div>

          <Card className="p-4">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,1fr)_220px_220px_auto]">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                  Search
                </span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search users, tax, products, cash accounts..."
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
                  style={{
                    borderColor: 'var(--aurora-border)',
                    background: 'var(--aurora-card)',
                    color: 'var(--aurora-text)',
                  }}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                  Area
                </span>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value as SettingCategory | 'ALL')}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
                  style={{
                    borderColor: 'var(--aurora-border)',
                    background: 'var(--aurora-card)',
                    color: 'var(--aurora-text)',
                  }}
                >
                  <option value="ALL">All areas</option>
                  {availableCategoryOptions.map((item) => (
                    <option key={item} value={item}>
                      {CATEGORY_META[item].label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                  Scope
                </span>
                <select
                  value={scope}
                  onChange={(event) => setScope(event.target.value as SettingScope | 'ALL')}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
                  style={{
                    borderColor: 'var(--aurora-border)',
                    background: 'var(--aurora-card)',
                    color: 'var(--aurora-text)',
                  }}
                >
                  <option value="ALL">All scopes</option>
                  {(['GROUP', 'COMPANY', 'USER'] as const).map((item) => (
                    <option key={item} value={item}>
                      {SCOPE_META[item].label}
                    </option>
                  ))}
                </select>
              </label>

            </div>
          </Card>

          <Card className="overflow-hidden">
            {filteredEntries.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                No settings match those filters.
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--aurora-border)' }}>
                {filteredEntries.map((entry) => (
                  <DirectoryRow key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </Card>
        </section>
      )}
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase" style={{ color: 'var(--aurora-primary-text)' }}>
        {eyebrow}
      </div>
      <h2 className="mt-1 text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>
        {title}
      </h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
        {description}
      </p>
    </div>
  );
}

function ShortcutCard({
  item,
  catalogEntry,
  emphasis = false,
}: {
  item: SettingShortcut;
  catalogEntry?: SettingEntry;
  emphasis?: boolean;
}) {
  const disabled = catalogEntry?.status === 'PLANNED';
  return (
    <Link
      href={disabled ? '#' : item.href}
      onClick={(event) => {
        if (disabled) event.preventDefault();
      }}
      className={`group block rounded-lg border p-4 transition ${
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:-translate-y-px hover:shadow-md'
      }`}
      style={{
        borderColor: emphasis ? 'var(--aurora-border-strong)' : 'var(--aurora-border)',
        background: 'var(--aurora-card)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'var(--aurora-primary-subtle)', color: 'var(--aurora-primary)' }}
        >
          <AppIcon name={item.icon} size={18} />
        </span>
        <span className="rounded-full border px-2 py-0.5 text-xs font-semibold" style={{
          borderColor: 'var(--aurora-border)',
          color: 'var(--aurora-text-secondary)',
        }}>
          {catalogEntry ? SCOPE_META[catalogEntry.scope].label : item.badge}
        </span>
      </div>
      <div className="mt-4 text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
        {item.title}
      </div>
      <p className="mt-2 text-sm leading-6" style={{ color: 'var(--aurora-text-secondary)' }}>
        {catalogEntry?.description ?? item.description}
      </p>
      <div className="mt-4 text-sm font-semibold" style={{ color: 'var(--aurora-primary-text)' }}>
        Open setting
      </div>
    </Link>
  );
}

function ShortcutRow({ item, catalogEntry }: { item: SettingShortcut; catalogEntry?: SettingEntry }) {
  const disabled = catalogEntry?.status === 'PLANNED';
  return (
    <Link
      href={disabled ? '#' : item.href}
      onClick={(event) => {
        if (disabled) event.preventDefault();
      }}
      className={`flex items-start gap-3 px-5 py-4 transition ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-slate-50 dark:hover:bg-white/5'}`}
    >
      <span
        className="mt-0.5 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
        style={{ background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-primary)' }}
      >
        <AppIcon name={item.icon} size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
          {item.title}
        </span>
        <span className="mt-1 block text-sm leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
          {catalogEntry?.description ?? item.description}
        </span>
      </span>
      <span className="mt-1 flex-shrink-0 text-xs font-semibold" style={{ color: 'var(--aurora-primary-text)' }}>
        Open
      </span>
    </Link>
  );
}

function DirectoryRow({ entry }: { entry: SettingEntry }) {
  const planned = entry.status === 'PLANNED';
  const category = CATEGORY_META[entry.category];

  return (
    <Link
      href={planned ? '#' : entry.href}
      onClick={(event) => {
        if (planned) event.preventDefault();
      }}
      className={`grid grid-cols-1 gap-3 px-5 py-4 transition md:grid-cols-[minmax(220px,1fr)_180px_140px_80px] md:items-center ${
        planned ? 'cursor-not-allowed opacity-60' : 'hover:bg-slate-50 dark:hover:bg-white/5'
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <AppIcon name={category.icon} size={15} className="flex-shrink-0" />
          <span className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
            {entry.name}
          </span>
        </div>
        <p className="mt-1 text-sm leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
          {entry.description}
        </p>
      </div>
      <div className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
        {category.label}
      </div>
      <div>
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${SCOPE_META[entry.scope].tone}`}>
          {SCOPE_META[entry.scope].label}
        </span>
      </div>
      <div className="text-sm font-semibold" style={{ color: planned ? 'var(--aurora-text-muted)' : 'var(--aurora-primary-text)' }}>
        {planned ? 'Planned' : 'Open'}
      </div>
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
      <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>
        {value}
      </div>
    </div>
  );
}
