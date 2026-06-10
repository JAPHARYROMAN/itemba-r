'use client';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { backendGet } from '@/lib/api-client';

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

const DEFAULT_COMMANDS: CommandItem[] = [
  { id: 'dashboard', label: 'Go to Dashboard', href: '/dashboard', group: 'Navigation', icon: '⊞' },
  {
    id: 'group-control',
    label: 'Group Control',
    href: '/group-control',
    group: 'Navigation',
    icon: '🔒',
    permission: 'group-control.view',
  },
  {
    id: 'finance',
    label: 'Finance',
    href: '/finance',
    group: 'Navigation',
    icon: '💰',
    permission: 'finance.view',
  },
  {
    id: 'finance-cash-accounts',
    label: 'Cash Accounts',
    description: 'Cash and bank account setup',
    href: '/finance/cash-accounts',
    group: 'Finance',
    icon: '🏦',
    permission: 'cash_accounts.view',
  },
  {
    id: 'finance-reports',
    label: 'Finance Reports',
    description: 'Financial statements, AR/AP, and management reports',
    href: '/finance/reports',
    group: 'Finance',
    icon: '📊',
    permission: 'finance.reports.view',
  },
  {
    id: 'operations',
    label: 'Operations',
    description: 'Inventory, sales, purchases, customers, and suppliers',
    href: '/operations',
    group: 'Navigation',
    icon: '⚙️',
    permission: 'operations.dashboard.view',
  },
  {
    id: 'operations-products',
    label: 'Products',
    description: 'Find products, SKUs, and stock items',
    href: '/operations/products',
    group: 'Operations',
    icon: '📦',
    anyPermission: ['products.view', 'sales.create', 'purchases.create', 'inventory.view'],
  },
  {
    id: 'operations-customers',
    label: 'Customers',
    description: 'Customer master data and profiles',
    href: '/operations/customers',
    group: 'Operations',
    icon: '👤',
    permission: 'customers.view',
  },
  {
    id: 'operations-suppliers',
    label: 'Suppliers',
    description: 'Supplier master data',
    href: '/operations/suppliers',
    group: 'Operations',
    icon: '🏢',
    permission: 'suppliers.view',
  },
  {
    id: 'operations-sales-orders',
    label: 'Sales Orders',
    description: 'Customer orders, fulfillment, and revenue',
    href: '/operations/sales-orders',
    group: 'Operations',
    icon: '🧾',
    permission: 'sales.view',
  },
  {
    id: 'operations-purchase-orders',
    label: 'Purchase Orders',
    description: 'Supplier orders and receiving',
    href: '/operations/purchase-orders',
    group: 'Operations',
    icon: '🧾',
    permission: 'purchases.view',
  },
  {
    id: 'operations-reports',
    label: 'Operations Reports',
    description: 'Sales, purchases, inventory, and movement reports',
    href: '/operations/reports',
    group: 'Operations',
    icon: '📈',
    permission: 'operations.reports.view',
  },
  {
    id: 'westsides',
    label: 'Westsides Operations',
    href: '/westsides',
    group: 'Navigation',
    icon: '🛒',
    permission: 'westsides.dashboard.view',
  },
  {
    id: 'westsides-quick-sale',
    label: 'Quick Sale',
    description: 'Counter sale flow',
    href: '/westsides/quick-sale',
    group: 'Westsides',
    icon: '💳',
    permission: 'sales.create',
  },
  {
    id: 'westsides-proformas',
    label: 'Proforma Invoices',
    description: 'Customer proforma invoices and printouts',
    href: '/westsides/proforma-invoices',
    group: 'Westsides',
    icon: '📄',
    permission: 'proformas.view',
  },
  {
    id: 'westsides-reports',
    label: 'Westsides Reports',
    description: 'Readable operations reports and exports',
    href: '/westsides/reports',
    group: 'Westsides',
    icon: '📊',
    permission: 'westsides.reports.view',
  },
  {
    id: 'hr',
    label: 'HR & Payroll',
    href: '/hr',
    group: 'Navigation',
    icon: '👥',
    permission: 'hr.dashboard.view',
  },
  {
    id: 'compliance',
    label: 'Compliance & Tax',
    href: '/compliance',
    group: 'Navigation',
    icon: '📋',
    permission: 'compliance.dashboard.view',
  },
  {
    id: 'approvals',
    label: 'Pending Approvals',
    href: '/approvals/pending',
    group: 'Quick Actions',
    icon: '✅',
    permission: 'approval_requests.view',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    href: '/notifications',
    group: 'Quick Actions',
    icon: '🔔',
  },
  { id: 'alerts', label: 'Alerts', href: '/alerts', group: 'Quick Actions', icon: '⚠️' },
];

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  additionalCommands?: CommandItem[];
}

function iconForRecord(type: string) {
  switch (type) {
    case 'customer':
      return '👤';
    case 'supplier':
      return '🏢';
    case 'product':
      return '📦';
    case 'sales-order':
      return '🧾';
    case 'purchase-order':
      return '📥';
    case 'quotation':
      return '📋';
    case 'proforma':
      return '📄';
    case 'delivery-note':
      return '🚚';
    case 'fuel-tank':
      return '🛢️';
    case 'fuel-shift':
      return '⛽';
    case 'fuel-delivery':
      return '🚛';
    case 'report-definition':
      return '📊';
    default:
      return '⌕';
  }
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

  const filteredCommands = useMemo(() => {
    if (!query.trim()) return visibleCommands;
    const q = query.toLowerCase();
    return visibleCommands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        c.group?.toLowerCase().includes(q),
    );
  }, [query, visibleCommands]);

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
              {remoteLoading ? 'Searching records...' : 'No results found'}
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
                    return (
                      <button
                        key={item.id}
                        onClick={() => executeCommand(item)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                        style={{
                          background: isSelected ? 'var(--aurora-primary-subtle)' : 'transparent',
                          color: 'var(--aurora-text)',
                        }}
                      >
                        {item.icon && (
                          <span className="text-base w-5 text-center flex-shrink-0">
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
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
