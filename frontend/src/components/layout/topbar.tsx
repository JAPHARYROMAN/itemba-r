'use client';

import { useState, useRef, useEffect } from 'react';
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
    <header className="h-14 bg-white border-b border-zinc-200 flex items-center justify-between px-4 lg:px-6 flex-shrink-0">
      {/* Left: hamburger (mobile) */}
      <button
        onClick={onMenuClick}
        className="lg:hidden p-1.5 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
        aria-label="Open menu"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
        <GlobalSearchBox />

        <ThemeSelector className="hidden sm:flex" />

        {/* Right: user menu */}
        {!loading && user && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-lg hover:bg-zinc-50 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 font-semibold text-xs flex items-center justify-center">
                {initials}
              </div>
              <div className="hidden sm:block text-left">
                <div className="text-[13px] font-medium text-zinc-900 leading-none">
                  {user.fullName}
                </div>
                <div className="text-[11px] text-zinc-400 mt-0.5 leading-none">{user.email}</div>
              </div>
              <svg
                className="w-3.5 h-3.5 text-zinc-400 hidden sm:block"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-52 bg-white rounded-xl border border-zinc-200 shadow-card-md py-1.5 z-50 animate-fade-in">
                <div className="px-3.5 py-2.5 border-b border-zinc-100">
                  <div className="text-[13px] font-medium text-zinc-900">{user.fullName}</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">{user.email}</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5 capitalize">
                    {(user.roles ?? []).join(', ')}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    logout();
                  }}
                  className="w-full text-left px-3.5 py-2 text-[13px] text-red-600 hover:bg-red-50 transition-colors"
                >
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
