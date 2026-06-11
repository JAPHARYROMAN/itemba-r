'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, LogOut, Menu } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { GlobalSearchBox } from '@/components/aurora/command';
import { ThemeSelector } from '@/components/ui/theme-selector';

interface TopbarProps {
  onMenuClick: () => void;
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const { user, logout, loading } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
                style={{ background: 'var(--aurora-primary-subtle)', color: 'var(--aurora-primary-text)' }}
              >
                {initials}
              </div>
              <div className="hidden sm:block text-left">
                <div className="text-[13px] font-medium leading-none" style={{ color: 'var(--aurora-text)' }}>
                  {user.fullName}
                </div>
                <div className="text-[11px] mt-0.5 leading-none" style={{ color: 'var(--aurora-text-muted)' }}>{user.email}</div>
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
                <div className="px-3.5 py-2.5 border-b" style={{ borderColor: 'var(--aurora-border)' }}>
                  <div className="text-[13px] font-medium" style={{ color: 'var(--aurora-text)' }}>{user.fullName}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>{user.email}</div>
                  <div className="text-[11px] mt-0.5 capitalize" style={{ color: 'var(--aurora-text-muted)' }}>
                    {(user.roles ?? []).join(', ')}
                  </div>
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
