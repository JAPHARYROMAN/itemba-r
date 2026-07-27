'use client';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { backendGet } from '@/lib/api-client';
import { NAV, isGroup, type NavItem, type NavLeaf } from '@/components/layout/sidebar';
import { AppIcon, type AppIconName } from '@/components/ui/icon-set';
import { usePersonalization, type PersonalizationEntry } from '@/hooks/use-personalization';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  href?: string;
  action?: () => void;
  group?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  permission?: string;
  anyPermission?: string[];
  source?: 'navigation' | 'record';
  badge?: string;
  date?: string;
  keywords?: string[];
  /** Sidebar icon key, carried so favoriting keeps a consistent icon everywhere. */
  iconKey?: string;
}

interface GlobalSearchApiResult {
  id: string;
  type: string;
  module: string;
  title: string;
  subtitle?: string;
  href: string;
  badge?: string;
  date?: string;
}

interface GlobalSearchApiGroup {
  key: string;
  label: string;
  results: GlobalSearchApiResult[];
}

interface GlobalSearchApiResponse {
  query: string;
  total: number;
  groups: GlobalSearchApiGroup[];
}

const NAV_ICON_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  lock: 'Security',
  bank: 'Banking',
  creditCard: 'Payments',
  fileText: 'Document',
  box: 'Inventory',
  document: 'Document',
  clipboardList: 'List',
  building: 'Company',
  users: 'People',
  shield: 'Security',
  barChart: 'Reports',
  settings: 'Settings',
  scale: 'Finance',
  checkCircle: 'Approvals',
  bell: 'Notifications',
  exclamationTriangle: 'Alerts',
  shieldCheck: 'Controls',
  trendingUp: 'Analytics',
  pieChart: 'Dashboard',
  wrench: 'Operations',
  lightBulb: 'Insights',
  grid: 'Grid',
  server: 'Server',
  bookmark: 'Saved',
  clock: 'Schedule',
  play: 'Run',
  integration: 'Integration',
  apiGateway: 'API',
  mobile: 'Mobile',
  webhook: 'Webhook',
  device: 'Device',
  sync: 'Sync',
  ShieldCheck: 'Security',
  qa: 'QA',
  launch: 'Launch',
  help2: 'Help',
  support2: 'Support',
  accountingEngine: 'Accounting',
  procurement: 'Procurement',
  crm: 'CRM',
  docTemplate: 'Templates',
  automation: 'Automation',
  performance: 'Performance',
  jobs: 'Jobs',
  isolation: 'Isolation',
  deploy: 'Deployment',
  Database: 'Backup',
  Activity: 'Monitoring',
  Archive: 'Archive',
  CheckBadge: 'Certified',
};

const EXTRA_ROUTE_COMMANDS: CommandItem[] = [
  {
    id: 'route:supplier-360-reports',
    label: 'Supplier 360 Reports',
    href: '/operations/reports/suppliers',
    group: 'Reports',
    icon: <AppIcon name="report" size={16} />,
    permission: 'operations.reports.view',
    keywords: ['supplier purchases', 'supplier invoices', 'products bought', 'payables'],
  },
  {
    id: 'route:supplier-order-drafts',
    label: 'Supplier Order Drafts',
    href: '/operations/purchase-orders/order-drafts',
    group: 'Operations',
    icon: <AppIcon name="purchase" size={16} />,
    permission: 'supplier_order_drafts.view',
    keywords: ['supplier request', 'order planning', 'draft purchase', 'manual items'],
  },
  {
    id: 'route:home',
    label: 'Public Home',
    href: '/',
    group: 'Public',
    icon: <AppIcon name="home" size={16} />,
    keywords: ['landing', 'website'],
  },
  {
    id: 'route:login',
    label: 'Login',
    href: '/login',
    group: 'Public',
    icon: <AppIcon name="login" size={16} />,
    keywords: ['sign in', 'authentication'],
  },
  {
    id: 'route:signup',
    label: 'Signup',
    href: '/signup',
    group: 'Public',
    icon: <AppIcon name="signup" size={16} />,
    keywords: ['create account', 'registration'],
  },
  {
    id: 'route:reports-run',
    label: 'Run Report',
    href: '/reports/run',
    group: 'Reports',
    icon: <AppIcon name="run" size={16} />,
    permission: 'report_runs.create',
    keywords: ['execute report', 'report viewer'],
  },
  {
    id: 'route:companies-new',
    label: 'New Company',
    href: '/companies/new',
    group: 'Registry',
    icon: <AppIcon name="company" size={16} />,
    permission: 'companies.create',
    keywords: ['create company', 'registry'],
  },
  {
    id: 'route:settings-company-profile',
    label: 'Company Profile Settings',
    href: '/settings/company-profile',
    group: 'Settings',
    icon: <AppIcon name="settings" size={16} />,
    keywords: ['company profile', 'letterhead', 'logo'],
  },
  {
    id: 'route:settings-number-sequences',
    label: 'Number Sequences',
    href: '/settings/number-sequences',
    group: 'Settings',
    icon: <AppIcon name="sequence" size={16} />,
    keywords: ['document numbers', 'sequence setup'],
  },
  {
    id: 'route:settings-preferences',
    label: 'Preferences',
    href: '/settings/preferences',
    group: 'Settings',
    icon: <AppIcon name="settings" size={16} />,
    keywords: ['user preferences'],
  },
  {
    id: 'route:api-gateway-logs',
    label: 'API Request Logs',
    href: '/api-gateway/logs',
    group: 'API Gateway',
    icon: <AppIcon name="transfer" size={16} />,
    permission: 'api_gateway.logs.view',
    keywords: ['api logs', 'requests', 'gateway'],
  },
  {
    id: 'route:background-jobs',
    label: 'Background Jobs',
    href: '/background-jobs',
    group: 'Performance & Ops',
    icon: <AppIcon name="inventory" size={16} />,
    permission: 'background_jobs.view',
    keywords: ['queue', 'worker', 'jobs'],
  },
  {
    id: 'route:background-job-queues',
    label: 'Background Job Queues',
    href: '/background-jobs/queues',
    group: 'Performance & Ops',
    icon: <AppIcon name="inventory" size={16} />,
    permission: 'background_jobs.view',
    keywords: ['queue health', 'workers'],
  },
  {
    id: 'route:automation',
    label: 'Business Automation',
    href: '/automation',
    group: 'Business Automation',
    icon: <AppIcon name="automation" size={16} />,
    permission: 'automation.dashboard.view',
    keywords: ['rules', 'workflow automation'],
  },
  {
    id: 'route:automation-rules',
    label: 'Automation Rules',
    href: '/automation/rules',
    group: 'Business Automation',
    icon: <AppIcon name="automation" size={16} />,
    permission: 'automation_rules.view',
    keywords: ['business rules'],
  },
  {
    id: 'route:automation-runs',
    label: 'Automation Runs',
    href: '/automation/runs',
    group: 'Business Automation',
    icon: <AppIcon name="run" size={16} />,
    permission: 'automation_runs.view',
    keywords: ['run history'],
  },
  {
    id: 'route:data-isolation',
    label: 'Data Isolation',
    href: '/data-isolation',
    group: 'Security & Audit',
    icon: <AppIcon name="security" size={16} />,
    permission: 'data_isolation.view',
    keywords: ['tenant isolation', 'multi company safety'],
  },
  {
    id: 'route:data-isolation-issues',
    label: 'Data Isolation Issues',
    href: '/data-isolation/issues',
    group: 'Security & Audit',
    icon: <AppIcon name="error" size={16} />,
    permission: 'data_isolation.view',
    keywords: ['tenant issues', 'violations'],
  },
  {
    id: 'route:data-isolation-test-runs',
    label: 'Data Isolation Test Runs',
    href: '/data-isolation/test-runs',
    group: 'Security & Audit',
    icon: <AppIcon name="done" size={16} />,
    permission: 'data_isolation.view',
    keywords: ['tenant tests'],
  },
  {
    id: 'route:compliance-cockpit',
    label: 'Compliance Cockpit',
    href: '/compliance/cockpit',
    group: 'Compliance & Tax',
    icon: <AppIcon name="approved" size={16} />,
    permission: 'compliance.dashboard.view',
    keywords: ['compliance dashboard'],
  },
  {
    id: 'route:compliance-osha',
    label: 'OSHA Registrations',
    href: '/compliance/osha-registrations',
    group: 'Compliance & Tax',
    icon: <AppIcon name="approved" size={16} />,
    permission: 'compliance_obligations.view',
    keywords: ['osha', 'statutory registrations'],
  },
  {
    id: 'route:hr-medical-exams',
    label: 'Medical Exams',
    href: '/hr/medical-exams',
    group: 'HR & Payroll',
    icon: <AppIcon name="medical" size={16} />,
    permission: 'hr.employees.view',
    keywords: ['employee medical'],
  },
  {
    id: 'route:hr-disputes',
    label: 'Employment Disputes',
    href: '/hr/disputes',
    group: 'HR & Payroll',
    icon: <AppIcon name="alert" size={16} />,
    permission: 'hr.employees.view',
    keywords: ['labor disputes'],
  },
  {
    id: 'route:hr-disciplinary-actions',
    label: 'Disciplinary Actions',
    href: '/hr/disciplinary-actions',
    group: 'HR & Payroll',
    icon: <AppIcon name="alert" size={16} />,
    permission: 'hr.employees.view',
    keywords: ['employee discipline'],
  },
  {
    id: 'route:hr-statutory-reports',
    label: 'HR Statutory Reports',
    href: '/hr/reports/statutory',
    group: 'HR & Payroll',
    icon: <AppIcon name="statement" size={16} />,
    permission: 'hr.reports.view',
    keywords: ['paye nssf wcf statutory'],
  },
  {
    id: 'route:hr-wcf-exposure',
    label: 'WCF Exposure Report',
    href: '/hr/reports/wcf-exposure',
    group: 'HR & Payroll',
    icon: <AppIcon name="statement" size={16} />,
    permission: 'hr.reports.view',
    keywords: ['workers compensation'],
  },
  {
    id: 'route:sales-commissions',
    label: 'Sales Commissions',
    href: '/sales/commissions',
    group: 'Sales',
    icon: <AppIcon name="commission" size={16} />,
    permission: 'sales.view',
    keywords: ['salesperson commission'],
  },
  {
    id: 'route:westsides-mobile-pos',
    label: 'Westsides Mobile POS',
    href: '/westsides/mobile-pos',
    group: 'Westsides',
    icon: <AppIcon name="pos" size={16} />,
    permission: 'sales.create',
    keywords: ['mobile sales', 'phone pos'],
  },
  {
    id: 'route:westsides-mobile-pos-install',
    label: 'Mobile POS Install',
    href: '/westsides/mobile-pos/install',
    group: 'Westsides',
    icon: <AppIcon name="pos" size={16} />,
    permission: 'sales.create',
    keywords: ['qr install', 'phone app'],
  },
];

function routeId(href: string) {
  return `nav:${
    href
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'home'
  }`;
}

function labelForLeaf(leaf: NavLeaf, parentLabel?: string) {
  if (!parentLabel) return leaf.label;
  if (leaf.label === 'Dashboard') return `${parentLabel} Dashboard`;
  if (leaf.label === 'Reports') return `${parentLabel} Reports`;
  return leaf.label;
}

// Map sidebar iconKeys to the shared Lucide icon set (one icon language across
// the app — replaces the old first-letter text glyphs).
const NAV_ICON_KEY_TO_APP_ICON: Record<string, AppIconName> = {
  dashboard: 'dashboard',
  lock: 'lock',
  bank: 'bank',
  creditCard: 'pos',
  fileText: 'document',
  box: 'product',
  document: 'document',
  clipboardList: 'quotation',
  building: 'company',
  users: 'customers',
  shield: 'security',
  barChart: 'report',
  settings: 'settings',
  scale: 'tax',
  checkCircle: 'done',
  bell: 'bell',
  exclamationTriangle: 'alert',
  shieldCheck: 'approved',
  trendingUp: 'trendUp',
  pieChart: 'report',
  wrench: 'settings',
  lightBulb: 'alert',
  accountingEngine: 'calculator',
  procurement: 'purchase',
  crm: 'customer',
  docTemplate: 'statement',
  automation: 'automation',
  jobs: 'inventory',
  Database: 'inventory',
  Activity: 'trendUp',
  Archive: 'inventory',
  CheckBadge: 'approved',
};

function iconForNavKey(key: unknown): React.ReactNode {
  const name = NAV_ICON_KEY_TO_APP_ICON[String(key)] ?? 'document';
  return <AppIcon name={name} size={16} />;
}

function navLeafToCommand(
  leaf: NavLeaf,
  parentLabel?: string,
  parentPermission?: string,
): CommandItem {
  const iconLabel = NAV_ICON_LABELS[String(leaf.iconKey)] ?? String(leaf.iconKey);
  return {
    id: routeId(leaf.href),
    label: labelForLeaf(leaf, parentLabel),
    description: parentLabel ? `${parentLabel} - ${leaf.label}` : leaf.href,
    href: leaf.href,
    group: parentLabel ?? 'Navigation',
    icon: iconForNavKey(leaf.iconKey),
    iconKey: String(leaf.iconKey),
    permission: leaf.permission ?? parentPermission,
    source: 'navigation',
    keywords: [leaf.href, leaf.label, parentLabel, iconLabel].filter(Boolean) as string[],
  };
}

function flattenNavigationCommands(items: NavItem[]) {
  const commands: CommandItem[] = [];
  for (const item of items) {
    if (isGroup(item)) {
      item.children.forEach((child) => {
        commands.push(navLeafToCommand(child, item.label, item.permission));
      });
    } else {
      commands.push(navLeafToCommand(item));
    }
  }
  return commands;
}

const DEFAULT_COMMANDS: CommandItem[] = [
  ...flattenNavigationCommands(NAV),
  ...EXTRA_ROUTE_COMMANDS,
];

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  additionalCommands?: CommandItem[];
}

const RECORD_ICONS: Record<string, AppIconName> = {
  customer: 'customer',
  supplier: 'company',
  product: 'product',
  'sales-order': 'order',
  'purchase-order': 'purchase',
  receivable: 'cash',
  payable: 'payment',
  'journal-entry': 'ledger',
  'cash-account': 'bank',
  employee: 'employee',
  quotation: 'quotation',
  proforma: 'document',
  'delivery-note': 'delivery',
  'report-definition': 'report',
  report: 'report',
};

function iconForRecord(type: string) {
  return <AppIcon name={RECORD_ICONS[type] ?? 'search'} size={16} />;
}

export function CommandPalette({ open, onClose, additionalCommands = [] }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [remoteGroups, setRemoteGroups] = useState<GlobalSearchApiGroup[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { user, hasPermission } = useAuth();
  const { favorites, recent, isFavorite, toggleFavorite } = usePersonalization();

  const allCommands = useMemo(
    () => [...DEFAULT_COMMANDS, ...additionalCommands],
    [additionalCommands],
  );

  const canSeeCommand = useCallback(
    (command: CommandItem) => {
      if (command.permission && !hasPermission(command.permission)) return false;
      if (
        command.anyPermission?.length &&
        !command.anyPermission.some((permission) => user?.permissions.includes(permission))
      ) {
        return false;
      }
      return true;
    },
    [hasPermission, user],
  );

  const visibleCommands = useMemo(
    () => allCommands.filter(canSeeCommand),
    [allCommands, canSeeCommand],
  );

  const isEmptyQuery = !query.trim();

  // Resolve a stored personalization entry (href only) into the full command —
  // preferring the canonical visible command so icon/permission stay consistent;
  // falling back to a synthesized item if the route isn't in the command set.
  const commandByHref = useMemo(() => {
    const map = new Map<string, CommandItem>();
    for (const c of visibleCommands) {
      if (c.href && !map.has(c.href)) map.set(c.href, c);
    }
    return map;
  }, [visibleCommands]);

  const resolveEntry = useCallback(
    (entry: PersonalizationEntry, groupOverride: string): CommandItem | null => {
      const existing = commandByHref.get(entry.href);
      if (existing) {
        // Gate stored entries by current permissions via the visible command set.
        return { ...existing, group: groupOverride };
      }
      // Route not in the command catalog (or not permitted) — skip it.
      return null;
    },
    [commandByHref],
  );

  // When the query is empty, show "Recently viewed" + "Favorites" instead of the
  // full nav dump. Otherwise, fuzzy-match across every visible command.
  const filteredCommands = useMemo(() => {
    if (isEmptyQuery) {
      const items: CommandItem[] = [];
      const seen = new Set<string>();
      for (const fav of favorites) {
        const cmd = resolveEntry(fav, 'Favorites');
        if (cmd && !seen.has(cmd.id)) {
          items.push(cmd);
          seen.add(cmd.id);
        }
      }
      for (const r of recent) {
        // Don't repeat a favorite inside recents.
        if (isFavorite(r.href)) continue;
        const cmd = resolveEntry(r, 'Recently viewed');
        if (cmd && !seen.has(cmd.id)) {
          items.push(cmd);
          seen.add(cmd.id);
        }
      }
      return items;
    }
    const q = query.toLowerCase();
    return visibleCommands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        c.group?.toLowerCase().includes(q) ||
        c.href?.toLowerCase().includes(q) ||
        c.keywords?.some((keyword) => keyword.toLowerCase().includes(q)),
    );
  }, [isEmptyQuery, query, visibleCommands, favorites, recent, isFavorite, resolveEntry]);

  const remoteItems = useMemo<CommandItem[]>(() => {
    return remoteGroups.flatMap((group) =>
      group.results.map((result) => ({
        id: `record:${result.type}:${result.id}`,
        label: result.title,
        description: [result.subtitle, result.date].filter(Boolean).join(' - '),
        href: result.href,
        group: group.label,
        icon: iconForRecord(result.type),
        source: 'record' as const,
        badge: result.badge,
      })),
    );
  }, [remoteGroups]);

  const filtered = useMemo(() => {
    return [...filteredCommands, ...remoteItems];
  }, [filteredCommands, remoteItems]);

  const grouped = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    filtered.forEach((item) => {
      const g = item.group ?? 'Other';
      if (!groups[g]) groups[g] = [];
      groups[g].push(item);
    });
    return groups;
  }, [filtered]);

  const flatItems = useMemo(() => {
    const items: CommandItem[] = [];
    Object.values(grouped).forEach((groupItems) => items.push(...groupItems));
    return items;
  }, [grouped]);

  const executeCommand = useCallback(
    (item: CommandItem) => {
      if (item.action) item.action();
      if (item.href) router.push(item.href);
      onClose();
    },
    [onClose, router],
  );

  const handleToggleFavorite = useCallback(
    (item: CommandItem) => {
      if (!item.href) return;
      toggleFavorite({
        href: item.href,
        label: item.label,
        group: item.group,
        iconKey: item.iconKey,
      });
    },
    [toggleFavorite],
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      setRemoteGroups([]);
      setRemoteError(null);
      setRemoteLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setRemoteGroups([]);
      setRemoteError(null);
      setRemoteLoading(false);
      return;
    }

    let cancelled = false;
    setRemoteError(null);
    const timer = window.setTimeout(async () => {
      setRemoteLoading(true);
      try {
        const response = await backendGet<GlobalSearchApiResponse>('/global-search', {
          query: { q: trimmed, limit: 5 },
        });
        if (!cancelled) {
          setRemoteGroups(response.groups ?? []);
        }
      } catch {
        if (!cancelled) {
          setRemoteGroups([]);
          setRemoteError('Record search is unavailable');
        }
      } finally {
        if (!cancelled) setRemoteLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, Math.max(flatItems.length - 1, 0)));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const item = flatItems[selected];
        if (item) executeCommand(item);
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [executeCommand, flatItems, onClose, open, selected]);

  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(flatItems.length - 1, 0)));
  }, [flatItems.length]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-start justify-center pt-20 px-4"
      style={{ zIndex: 1500 }}
    >
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.6)' }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-2xl rounded-aurora-lg overflow-hidden"
        style={{
          background: 'var(--aurora-card)',
          border: '1px solid var(--aurora-border)',
          boxShadow: 'var(--aurora-shadow-lg, 0 25px 50px -12px rgba(0,0,0,0.25))',
        }}
      >
        {/* Search */}
        <div
          className="flex items-center gap-3 px-4 py-3.5 border-b"
          style={{ borderColor: 'var(--aurora-border)' }}
        >
          <svg
            className="w-5 h-5 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            style={{ color: 'var(--aurora-text-muted)' }}
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search pages, reports, customers, products, orders..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            className="flex-1 text-sm outline-none bg-transparent"
            style={{ color: 'var(--aurora-text)' }}
          />
          <kbd
            className="hidden sm:block text-xs px-1.5 py-0.5 rounded"
            style={{
              background: 'var(--aurora-bg-muted)',
              color: 'var(--aurora-text-muted)',
              border: '1px solid var(--aurora-border)',
            }}
          >
            esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[28rem] overflow-y-auto py-2">
          {flatItems.length === 0 ? (
            <p
              className="px-4 py-8 text-sm text-center"
              style={{ color: 'var(--aurora-text-muted)' }}
            >
              {remoteLoading
                ? 'Searching records...'
                : isEmptyQuery
                  ? 'Star pages to pin them here, or start typing to search.'
                  : 'No results found'}
            </p>
          ) : (
            Object.entries(grouped).map(([group, items]) => {
              return (
                <div key={group}>
                  <p
                    className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    {group}
                  </p>
                  {items.map((item) => {
                    const itemIndex = flatItems.indexOf(item);
                    const isSelected = itemIndex === selected;
                    // Star toggle only applies to routes (navigation targets), not
                    // dynamic record search results.
                    const canFavorite = Boolean(item.href) && item.source !== 'record';
                    const starred = item.href ? isFavorite(item.href) : false;
                    return (
                      <div
                        key={item.id}
                        className="group/cmd flex items-center transition-colors"
                        style={{
                          background: isSelected ? 'var(--aurora-primary-subtle)' : 'transparent',
                        }}
                      >
                        <button
                          onClick={() => executeCommand(item)}
                          className="flex flex-1 min-w-0 items-center gap-3 px-4 py-2.5 text-left"
                          style={{ color: 'var(--aurora-text)' }}
                        >
                          {item.icon && (
                            <span
                              className="w-5 flex items-center justify-center flex-shrink-0"
                              style={{ color: 'var(--aurora-text-muted)' }}
                            >
                              {item.icon}
                            </span>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.label}</p>
                            {item.description && (
                              <p
                                className="text-xs truncate"
                                style={{ color: 'var(--aurora-text-muted)' }}
                              >
                                {item.description}
                              </p>
                            )}
                          </div>
                          {item.badge && (
                            <span
                              className="max-w-28 truncate rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                              style={{
                                background: 'var(--aurora-bg-muted)',
                                color: 'var(--aurora-text-muted)',
                                border: '1px solid var(--aurora-border)',
                              }}
                            >
                              {item.badge}
                            </span>
                          )}
                          {item.shortcut && (
                            <kbd
                              className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                              style={{
                                background: 'var(--aurora-bg-muted)',
                                color: 'var(--aurora-text-muted)',
                                border: '1px solid var(--aurora-border)',
                              }}
                            >
                              {item.shortcut}
                            </kbd>
                          )}
                        </button>
                        {canFavorite && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleToggleFavorite(item);
                            }}
                            aria-pressed={starred}
                            aria-label={starred ? `Unpin ${item.label}` : `Pin ${item.label}`}
                            title={starred ? 'Remove from favorites' : 'Add to favorites'}
                            className={`mr-3 flex-shrink-0 rounded p-1.5 transition-opacity ${
                              starred
                                ? 'opacity-100'
                                : 'opacity-0 group-hover/cmd:opacity-70 hover:!opacity-100 focus:opacity-100'
                            }`}
                            style={{ color: starred ? '#facc15' : 'var(--aurora-text-muted)' }}
                          >
                            <svg
                              className="w-4 h-4"
                              viewBox="0 0 24 24"
                              fill={starred ? 'currentColor' : 'none'}
                              stroke="currentColor"
                              strokeWidth={1.75}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01z" />
                            </svg>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
          {(remoteLoading || remoteError) && flatItems.length > 0 && (
            <div
              className="px-4 py-2 text-xs"
              style={{ color: remoteError ? '#f87171' : 'var(--aurora-text-muted)' }}
            >
              {remoteError ?? 'Searching records...'}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-4 py-2.5 border-t text-xs"
          style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}
        >
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>★ favorite</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
