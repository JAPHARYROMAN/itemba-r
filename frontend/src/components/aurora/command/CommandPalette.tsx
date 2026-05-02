'use client';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  href?: string;
  action?: () => void;
  group?: string;
  icon?: React.ReactNode;
  shortcut?: string;
}

const DEFAULT_COMMANDS: CommandItem[] = [
  { id: 'dashboard', label: 'Go to Dashboard', href: '/dashboard', group: 'Navigation', icon: '⊞' },
  {
    id: 'group-control',
    label: 'Group Control',
    href: '/group-control',
    group: 'Navigation',
    icon: '🔒',
  },
  { id: 'finance', label: 'Finance', href: '/finance', group: 'Navigation', icon: '💰' },
  {
    id: 'petroleum',
    label: 'Petroleum Operations',
    href: '/petroleum',
    group: 'Navigation',
    icon: '⛽',
  },
  {
    id: 'westsides',
    label: 'Westsides Operations',
    href: '/westsides',
    group: 'Navigation',
    icon: '🛒',
  },
  { id: 'itemba', label: 'Itemba Enterprises', href: '/itemba', group: 'Navigation', icon: '🏗️' },
  { id: 'hr', label: 'HR & Payroll', href: '/hr', group: 'Navigation', icon: '👥' },
  {
    id: 'compliance',
    label: 'Compliance & Tax',
    href: '/compliance',
    group: 'Navigation',
    icon: '📋',
  },
  {
    id: 'approvals',
    label: 'Pending Approvals',
    href: '/approvals/pending',
    group: 'Quick Actions',
    icon: '✅',
  },
  {
    id: 'bi-executive',
    label: 'Executive Dashboard',
    href: '/bi/executive',
    group: 'BI & Reports',
    icon: '📊',
  },
  {
    id: 'bi-reports',
    label: 'Report Definitions',
    href: '/bi/reports',
    group: 'BI & Reports',
    icon: '📄',
  },
  {
    id: 'bi-insights',
    label: 'Executive Insights',
    href: '/bi/insights',
    group: 'BI & Reports',
    icon: '💡',
  },
  {
    id: 'data-quality',
    label: 'Data Quality',
    href: '/bi/data-quality',
    group: 'BI & Reports',
    icon: '🛡️',
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

export function CommandPalette({ open, onClose, additionalCommands = [] }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const allCommands = useMemo(
    () => [...DEFAULT_COMMANDS, ...additionalCommands],
    [additionalCommands],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return allCommands;
    const q = query.toLowerCase();
    return allCommands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        c.group?.toLowerCase().includes(q),
    );
  }, [query, allCommands]);

  const grouped = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    filtered.forEach((item) => {
      const g = item.group ?? 'Other';
      if (!groups[g]) groups[g] = [];
      groups[g].push(item);
    });
    return groups;
  }, [filtered]);

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
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, filtered.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const item = filtered[selected];
        if (item) executeCommand(item);
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [executeCommand, filtered, onClose, open, selected]);

  if (!open) return null;

  // Build a flat index map so we can compute selected state without mutation in render
  const flatItems: CommandItem[] = [];
  Object.values(grouped).forEach((items) => flatItems.push(...items));

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
        className="relative w-full max-w-xl rounded-aurora-lg overflow-hidden"
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
            placeholder="Search commands, modules, actions..."
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
        <div className="max-h-80 overflow-y-auto py-2">
          {flatItems.length === 0 ? (
            <p
              className="px-4 py-8 text-sm text-center"
              style={{ color: 'var(--aurora-text-muted)' }}
            >
              No commands found
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
