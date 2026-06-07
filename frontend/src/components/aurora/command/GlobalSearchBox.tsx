'use client';
import React from 'react';
import { useCommandPalette } from './CommandPaletteProvider';

export function GlobalSearchBox() {
  const { open } = useCommandPalette();
  return (
    <button
      onClick={open}
      className="flex min-w-10 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors md:min-w-[260px] md:px-3"
      style={{
        background: 'var(--aurora-bg-subtle)',
        color: 'var(--aurora-text-muted)',
        border: '1px solid var(--aurora-border)',
        maxWidth: '320px',
      }}
      aria-label="Open command palette (Ctrl+K)"
    >
      <svg
        className="w-4 h-4 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <span className="hidden flex-1 text-left text-sm md:block">Search records, pages...</span>
      <kbd
        className="hidden rounded px-1.5 py-0.5 text-xs md:block"
        style={{
          background: 'var(--aurora-bg-muted)',
          color: 'var(--aurora-text-muted)',
          border: '1px solid var(--aurora-border)',
          fontSize: '0.65rem',
        }}
      >
        ⌘K
      </kbd>
    </button>
  );
}
