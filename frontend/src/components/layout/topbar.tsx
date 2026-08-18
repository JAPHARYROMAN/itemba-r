'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, LogOut, Menu, Plus } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { GlobalSearchBox } from '@/components/aurora/command';
import { AppIcon, type AppIconName } from '@/components/ui/icon-set';
import { ThemeSelector } from '@/components/ui/theme-selector';
import { MsaidiziTopbarButton } from '@/components/msaidizi/msaidizi-launcher';

interface TopbarProps {
  onMenuClick: () => void;
}

// Global Quick-Create targets. Routes mirror the EXTRA_ROUTE_COMMANDS-style
// entries in the command palette so both surfaces stay consistent. Each is
// permission-gated; items the user can't create are hidden.
interface QuickCreateItem {
  label: string;
  href: string;
  icon: AppIconName;
  permission?: string;
}

const QUICK_CREATE_ITEMS: QuickCreateItem[] = [
  { label: 'New Sale', href: '/westsides/quick-sale', icon: 'pos', permission: 'sales.create' },
  {
    label: 'New Sales Order',
    href: '/operations/sales-orders?create=1',
    icon: 'order',
    permission: 'sales.create',
  },
  {
    label: 'New Purchase Order',
    href: '/operations/purchase-orders?create=1',
    icon: 'purchase',
    permission: 'purchases.create',
  },
  {
    label: 'New Company',
    href: '/companies/new',
    icon: 'company',
    permission: 'companies.create',
  },
  { label: 'Run Report', href: '/reports/run', icon: 'run', permission: 'report_runs.create' },
];

export function Topbar({ onMenuClick }: TopbarProps) {
  const { user, logout, loading, hasPermission } = useAuth();
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLDivElement>(null);

  const quickCreateItems = QUICK_CREATE_ITEMS.filter(
    (item) => !item.permission || hasPermission(item.permission),
  );

  const initials = user?.fullName
    ? user.fullName
        .split(' ')
        .map((n: string) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '??';

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (createRef.current && !createRef.current.contains(e.target as Node)) {
        setCreateOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <header
      className="h-14 border-b flex items-center justify-between px-4 lg:px-6 flex-shrink-0"
      style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
    >
      {/* Left: hamburger (mobile) */}
      <button
        onClick={onMenuClick}
        className="lg:hidden p-1.5 rounded-md transition-colors hover:bg-[var(--aurora-bg-subtle)] hover:text-[var(--aurora-text)]"
        style={{ color: 'var(--aurora-text-muted)' }}
        aria-label="Open menu"
      >
        <Menu aria-hidden className="h-5 w-5" />
      </button>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
        <GlobalSearchBox />

        {/* Opens the assistant with the question already running. Renders null
            for anyone without `msaidizi.use`, and cannot render at all in the
            POS shell — its provider is mounted only in the ERP arm. */}
        <MsaidiziTopbarButton />

        {/* Quick Create ("+ New") */}
        {!loading && user && quickCreateItems.length > 0 && (
          <div className="relative" ref={createRef}>
            <button
              onClick={() => setCreateOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors"
              style={{
                background: 'var(--aurora-primary)',
                color: 'var(--aurora-primary-contrast, #fff)',
              }}
              aria-expanded={createOpen}
              aria-haspopup="menu"
              aria-label="Quick create"
            >
              <Plus aria-hidden className="h-4 w-4" />
              <span className="hidden sm:block">New</span>
              <ChevronDown aria-hidden className="hidden h-3.5 w-3.5 sm:block" />
            </button>

            {createOpen && (
              <div
                className="absolute right-0 top-full mt-1.5 w-56 rounded-xl border py-1.5 z-50 animate-fade-in"
                style={{
                  background: 'var(--aurora-card-elevated)',
                  borderColor: 'var(--aurora-border)',
                  boxShadow: 'var(--aurora-shadow)',
                }}
                role="menu"
              >
                <div
                  className="px-3.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  Create
                </div>
                {quickCreateItems.map((item) => (
                  <button
                    key={item.href}
                    onClick={() => {
                      setCreateOpen(false);
                      router.push(item.href);
                    }}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] transition-colors hover:bg-[var(--aurora-bg-subtle)]"
                    style={{ color: 'var(--aurora-text)' }}
                    role="menuitem"
                  >
                    <span
                      className="flex w-4 items-center justify-center"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      <AppIcon name={item.icon} size={15} />
                    </span>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <ThemeSelector className="hidden sm:flex" />

        {/* Right: user menu */}
        {!loading && user && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-lg hover:bg-[var(--aurora-bg-subtle)] transition-colors"
              aria-expanded={dropdownOpen}
              aria-haspopup="menu"
            >
              <div
                className="w-7 h-7 rounded-full font-semibold text-xs flex items-center justify-center"
                style={{
                  background: 'var(--aurora-primary-subtle)',
                  color: 'var(--aurora-primary-text)',
                }}
              >
                {initials}
              </div>
              <div className="hidden sm:block text-left">
                <div
                  className="text-[13px] font-medium leading-none"
                  style={{ color: 'var(--aurora-text)' }}
                >
                  {user.fullName}
                </div>
                <div
                  className="text-[11px] mt-0.5 leading-none"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  {user.email}
                </div>
              </div>
              <ChevronDown
                aria-hidden
                className="hidden h-3.5 w-3.5 sm:block"
                style={{ color: 'var(--aurora-text-muted)' }}
              />
            </button>

            {dropdownOpen && (
              <div
                className="absolute right-0 top-full mt-1.5 w-52 rounded-xl border py-1.5 z-50 animate-fade-in"
                style={{
                  background: 'var(--aurora-card-elevated)',
                  borderColor: 'var(--aurora-border)',
                  boxShadow: 'var(--aurora-shadow)',
                }}
                role="menu"
              >
                <div
                  className="px-3.5 py-2.5 border-b"
                  style={{ borderColor: 'var(--aurora-border)' }}
                >
                  <div className="text-[13px] font-medium" style={{ color: 'var(--aurora-text)' }}>
                    {user.fullName}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>
                    {user.email}
                  </div>
                  <div
                    className="text-[11px] mt-0.5 capitalize"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    {(user.roles ?? []).join(', ')}
                  </div>
                </div>
                <div
                  className="border-b px-3.5 py-2.5 sm:hidden"
                  style={{ borderColor: 'var(--aurora-border)' }}
                >
                  <div
                    className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    Theme
                  </div>
                  <ThemeSelector />
                </div>
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    logout();
                  }}
                  className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] transition-colors hover:bg-[var(--aurora-danger-bg)]"
                  style={{ color: 'var(--aurora-danger-text)' }}
                  role="menuitem"
                >
                  <LogOut aria-hidden className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
