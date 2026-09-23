'use client';
import { useGuardedRouter } from '@/components/workspace/unsaved-work-provider';
import React, { useState, useEffect, useRef, useMemo, useCallback, useId } from 'react';

import { Modal, ModalPortalProvider } from '@/components/ui/modal';
import { FilePreviewDialog } from '@/components/documents/FilePreviewDialog';
import {
  filePreviewPaths,
  type FilePreviewSource,
} from '@/components/documents/file-preview-source';
import { searchResultFile } from './search-result-file';
import { APP_REGISTRY } from '@/lib/apps';
import { safeNotificationActionUrl as safeTarget } from '@/lib/notification-links';
import './command-palette.css';
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
  source?: 'navigation' | 'record' | 'app';
  badge?: string;
  date?: string;
  keywords?: string[];
  /** Sidebar icon key, carried so favoriting keeps a consistent icon everywhere. */
  iconKey?: string;
  file?: FilePreviewSource;
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
  file?: unknown;
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
  fuelGrid: 'Fuel operations',
};

const EXTRA_ROUTE_COMMANDS: CommandItem[] = [
  {
    id: 'route:document-library',
    label: 'Browse file library',
    href: '/documents?view=library',
    group: 'Documents',
    permission: 'documents.view',
    icon: <AppIcon name="document" size={16} />,
    keywords: ['files', 'attachments', 'pdf', 'word', 'excel'],
  },
  {
    id: 'route:write-letter',
    label: 'Write a company letter',
    href: '/documents?view=letter',
    group: 'Documents',
    permission: 'documents.manage',
    anyPermission: ['documents.view'],
    icon: <AppIcon name="document" size={16} />,
    keywords: ['correspondence', 'letterhead', 'word', 'create letter'],
  },
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
    permission: 'employees.view',
    keywords: ['employee medical'],
  },
  {
    id: 'route:hr-disputes',
    label: 'Employment Disputes',
    href: '/hr/disputes',
    group: 'HR & Payroll',
    icon: <AppIcon name="alert" size={16} />,
    permission: 'employees.view',
    keywords: ['labor disputes'],
  },
  {
    id: 'route:hr-disciplinary-actions',
    label: 'Disciplinary Actions',
    href: '/hr/disciplinary-actions',
    group: 'HR & Payroll',
    icon: <AppIcon name="alert" size={16} />,
    permission: 'employees.view',
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
    id: 'route:mobile-pos-lite',
    label: 'Itemba POS',
    href: '/mobile-pos',
    group: 'Westsides',
    icon: <AppIcon name="pos" size={16} />,
    permission: 'mobile_pos_lite.use',
    keywords: ['mobile sales', 'phone pos', 'cashier', 'mobile pos'],
  },
  {
    id: 'route:mobile-pos-activate',
    label: 'Itemba POS Activation',
    href: '/mobile-pos/activate',
    group: 'Westsides',
    icon: <AppIcon name="pos" size={16} />,
    permission: 'mobile_pos_lite.use',
    keywords: ['activate terminal', 'setup code', 'connect phone'],
  },
  {
    id: 'route:mobile-pos-terminals',
    label: 'Itemba POS Terminals',
    href: '/westsides/mobile-pos/terminals',
    group: 'Westsides',
    icon: <AppIcon name="pos" size={16} />,
    permission: 'mobile_pos_lite.manage',
    keywords: ['terminal setup', 'phone app', 'qr install'],
  },
  {
    id: 'route:mobile-pos-install',
    label: 'Itemba POS Install Page',
    href: '/westsides/mobile-pos/install',
    group: 'Westsides',
    icon: <AppIcon name="pos" size={16} />,
    permission: 'mobile_pos_lite.manage',
    keywords: ['install app', 'add to home screen', 'qr code'],
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
  fuelGrid: 'fuel',
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
  'invoice-attachment': 'document',
  'desk-invoice': 'order',
  'desk-sale': 'order',
  'desk-movement': 'cash',
  document: 'document',
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

const APP_COMMANDS: CommandItem[] = APP_REGISTRY.map((app) => ({
  id: `app:${app.id}`,
  label: app.label,
  description: app.description,
  href: app.href,
  group: 'Apps',
  source: 'app',
  permission: app.permission,
  anyPermission: app.permissionsAny,
  keywords: [...app.keywords],
  icon: <AppIcon name={app.icon} size={20} />,
  iconKey: app.iconKey,
}));
const EMPTY_COMMANDS: CommandItem[] = [];
type Filter = 'all' | 'apps' | 'pages' | 'records' | 'files';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'apps', label: 'Apps' },
  { id: 'pages', label: 'Pages & actions' },
  { id: 'records', label: 'Records' },
  { id: 'files', label: 'Files' },
];

export function CommandPalette(props: CommandPaletteProps) {
  const { user } = useAuth();
  // Search responses and queries never survive an account/permission boundary or close.
  const boundary = JSON.stringify([user?.id, user?.companyId, user?.permissions]);
  return props.open && user ? <SearchSession key={boundary} {...props} /> : null;
}

function SearchSession({ onClose, additionalCommands = EMPTY_COMMANDS }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState(0);
  const [retry, setRetry] = useState(0);
  const [preview, setPreview] = useState<FilePreviewSource | null>(null);
  const [remote, setRemote] = useState<{
    key: string;
    groups: GlobalSearchApiGroup[];
    loading: boolean;
    error: string;
  }>({ key: '', groups: [], loading: false, error: '' });
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const router = useGuardedRouter();
  const { hasPermission } = useAuth();
  const { favorites, recent, isFavorite, toggleFavorite } = usePersonalization();
  const trimmed = query.trim();
  const category = filter === 'files' ? 'files' : 'all';
  const recordSearch = ['all', 'records', 'files'].includes(filter) && trimmed.length >= 2;
  const requestKey = JSON.stringify([trimmed, retry, category]);
  const remoteLoading = recordSearch && (remote.key !== requestKey || remote.loading);
  const remoteError = recordSearch && remote.key === requestKey ? remote.error : '';

  const visibleCommands = useMemo(() => {
    const seen = new Set<string>();
    return [...APP_COMMANDS, ...DEFAULT_COMMANDS, ...additionalCommands].filter((command) => {
      if (command.permission && !hasPermission(command.permission)) return false;
      if (command.anyPermission?.length && !command.anyPermission.some((p) => hasPermission(p)))
        return false;
      const key = command.href || command.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [additionalCommands, hasPermission]);

  const navigation = useMemo(() => {
    const candidates = visibleCommands.filter((command) =>
      filter === 'records' || filter === 'files'
        ? false
        : filter === 'apps'
          ? command.source === 'app'
          : filter === 'pages'
            ? command.source !== 'app'
            : true,
    );
    if (trimmed) {
      const words = trimmed.toLowerCase().split(/\s+/);
      return candidates.filter((command) => {
        const text = [
          command.label,
          command.description,
          command.group,
          command.href,
          ...(command.keywords ?? []),
        ]
          .join(' ')
          .toLowerCase();
        return words.every((word) => text.includes(word));
      });
    }
    if (filter !== 'all') return candidates;
    const byHref = new Map(candidates.filter((c) => c.href).map((c) => [c.href!, c]));
    const entries: CommandItem[] = [];
    const seen = new Set<string>();
    const add = (entry: PersonalizationEntry, group: string) => {
      const item = byHref.get(entry.href);
      if (item && !seen.has(item.id)) {
        entries.push({ ...item, group });
        seen.add(item.id);
      }
    };
    favorites.forEach((entry) => add(entry, 'Favorites'));
    recent.forEach((entry) => add(entry, 'Recently viewed'));
    candidates
      .filter((item) => item.source === 'app' && !seen.has(item.id))
      .forEach((item) => entries.push(item));
    return entries;
  }, [filter, trimmed, visibleCommands, favorites, recent]);

  const grouped = useMemo(() => {
    const records: CommandItem[] =
      recordSearch && remote.key === requestKey
        ? remote.groups.flatMap((group) =>
            group.results.flatMap((result) => {
              const href = safeTarget(result.href);
              const file = searchResultFile(result, hasPermission);
              return href && (filter !== 'files' || file)
                ? [
                    {
                      id: `record:${result.type}:${result.id}`,
                      label: result.title,
                      description: [result.subtitle, result.date].filter(Boolean).join(' · '),
                      href,
                      group: group.label,
                      source: 'record' as const,
                      icon: iconForRecord(result.type),
                      badge: result.badge,
                      file,
                    },
                  ]
                : [];
            }),
          )
        : [];
    const groups = new Map<string, CommandItem[]>();
    [...navigation, ...records].forEach((item) => {
      const key = item.group ?? 'Pages & actions';
      groups.set(key, [...(groups.get(key) ?? []), item]);
    });
    return [...groups.entries()];
  }, [navigation, recordSearch, remote, requestKey, filter, hasPermission]);
  const flatItems = useMemo(() => grouped.flatMap(([, items]) => items), [grouped]);
  const index = Math.min(selected, Math.max(flatItems.length - 1, 0));
  const activeItem = flatItems[index];
  const activeId = activeItem ? `${listId}-option-${index}` : undefined;
  const canPin = activeItem?.href && activeItem.source !== 'record';
  const files = flatItems.flatMap((item) => (item.file ? [item.file] : []));

  const execute = useCallback(
    (item: CommandItem) => {
      if (item.file) {
        setPreview(item.file);
        return;
      }
      onClose();
      if (item.action) item.action();
      if (item.href) router.push(item.href);
    },
    [onClose, router],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!recordSearch) return;
    const controller = new AbortController();
    const [q, , searchCategory] = JSON.parse(requestKey) as [string, number, string];
    setRemote({ key: requestKey, groups: [], loading: true, error: '' });
    const timer = window.setTimeout(() => {
      backendGet<GlobalSearchApiResponse>('/global-search', {
        query: { q, limit: 5, ...(searchCategory === 'files' ? { category: 'files' } : {}) },
        signal: controller.signal,
      })
        .then((response) => {
          if (!controller.signal.aborted)
            setRemote({
              key: requestKey,
              groups: response.groups ?? [],
              loading: false,
              error: '',
            });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setRemote({
              key: requestKey,
              groups: [],
              loading: false,
              error: `${searchCategory === 'files' ? 'File' : 'Record'} search is unavailable. You can still open apps and pages.`,
            });
        });
    }, 220);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [recordSearch, requestKey]);
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId, activeItem?.id]);

  const status = remoteLoading
    ? filter === 'files'
      ? 'Searching files…'
      : 'Searching records…'
    : remoteError
      ? ''
      : ['records', 'files'].includes(filter) && trimmed.length < 2
        ? `Enter at least two characters to search ${filter === 'files' ? 'files' : 'records'}.`
        : flatItems.length
          ? `${flatItems.length} results`
          : 'No results found.';

  return (
    <ModalPortalProvider>
      <Modal
        open
        onClose={onClose}
        title="Search ITEMBA OS"
        size="lg"
        footer={
          <div className="os-search-footer">
            <span>↑ ↓ to browse · Enter to open · Esc to close</span>
            {canPin && (
              <button
                type="button"
                className="os-search-pin"
                aria-pressed={isFavorite(activeItem.href!)}
                onClick={() =>
                  toggleFavorite({
                    href: activeItem.href!,
                    label: activeItem.label,
                    group: activeItem.group,
                    iconKey: activeItem.iconKey,
                  })
                }
              >
                {isFavorite(activeItem.href!) ? 'Unpin' : 'Pin'} {activeItem.label}
              </button>
            )}
          </div>
        }
      >
        <div className="os-search" data-os-search>
          <label className="sr-only" htmlFor={`${listId}-input`}>
            Search apps, pages and records
          </label>
          <input
            id={`${listId}-input`}
            ref={inputRef}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-describedby={`${listId}-status`}
            autoComplete="off"
            spellCheck={false}
            placeholder="Find an app, invoice, sale, person or document…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setSelected(
                  Math.max(
                    0,
                    Math.min(flatItems.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                  ),
                );
              } else if (event.key === 'Enter' && activeItem) {
                event.preventDefault();
                execute(activeItem);
              }
            }}
          />
          <div className="os-search-filters" role="group" aria-label="Search categories">
            {FILTERS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={filter === entry.id}
                onClick={() => {
                  setFilter(entry.id);
                  setSelected(0);
                  inputRef.current?.focus();
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <p id={`${listId}-status`} role="status" className="os-search-status">
            {status}
          </p>
          {remoteError && (
            <div role="alert" className="os-search-error">
              <p>{remoteError}</p>
              <button
                type="button"
                onClick={() => {
                  setRetry((value) => value + 1);
                  inputRef.current?.focus();
                }}
              >
                Try again
              </button>
            </div>
          )}
          <div
            id={listId}
            role="listbox"
            aria-label="Search results"
            aria-busy={remoteLoading}
            className="os-search-results"
          >
            {grouped.map(([group, items], groupIndex) => (
              <div key={group} role="group" aria-labelledby={`${listId}-group-${groupIndex}`}>
                <p id={`${listId}-group-${groupIndex}`} className="os-search-group">
                  {group}
                </p>
                {items.map((item) => {
                  const itemIndex = flatItems.indexOf(item);
                  return (
                    <div
                      key={item.id}
                      id={`${listId}-option-${itemIndex}`}
                      role="option"
                      aria-selected={itemIndex === index}
                      className="os-search-option"
                      onMouseEnter={() => setSelected(itemIndex)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => execute(item)}
                    >
                      <span aria-hidden="true" className="os-search-icon">
                        {item.icon}
                      </span>
                      <span className="os-search-copy">
                        <strong>{item.label}</strong>
                        {item.description && <span>{item.description}</span>}
                      </span>
                      {item.badge && <span className="os-search-badge">{item.badge}</span>}
                      {item.file && <span className="os-search-badge">Quick Look</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Modal>
      {preview && (
        <FilePreviewDialog
          sources={files}
          initial={preview}
          returnFocusRef={inputRef}
          onClose={() => setPreview(null)}
          onOpenRecord={(source) => {
            const item = flatItems.find(
              (entry) =>
                entry.file && filePreviewPaths(entry.file).key === filePreviewPaths(source).key,
            );
            if (!item?.href) return;
            setPreview(null);
            onClose();
            router.push(item.href);
          }}
        />
      )}
    </ModalPortalProvider>
  );
}
