'use client';
import React, { useState, useEffect, createContext, useContext } from 'react';
import { usePathname } from 'next/navigation';
import { CommandPalette } from './CommandPalette';
import { NAV, isGroup, type NavLeaf } from '@/components/layout/sidebar';
import { recordVisit } from '@/hooks/use-personalization';

interface CommandPaletteContextValue {
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const Ctx = createContext<CommandPaletteContextValue>({
  open: () => {},
  close: () => {},
  toggle: () => {},
});

export function useCommandPalette() {
  return useContext(Ctx);
}

// Flat lookup of every navigable route so a visited pathname can be described
// (label / group / icon) for the personalization store. Built once at module load.
interface RouteMeta {
  href: string;
  label: string;
  group?: string;
  iconKey?: string;
}

const ROUTE_META: RouteMeta[] = (() => {
  const rows: RouteMeta[] = [];
  const pushLeaf = (leaf: NavLeaf, group?: string) => {
    rows.push({ href: leaf.href, label: leaf.label, group, iconKey: String(leaf.iconKey) });
  };
  for (const item of NAV) {
    if (isGroup(item)) {
      item.children.forEach((child) => pushLeaf(child, item.label));
    } else {
      pushLeaf(item);
    }
  }
  // Longest href first so `/finance/expenses` wins over `/finance` on prefix match.
  return rows.sort((a, b) => b.href.length - a.href.length);
})();

function metaForPath(pathname: string): RouteMeta | undefined {
  const exact = ROUTE_META.find((r) => r.href === pathname);
  if (exact) return exact;
  // Fall back to the closest ancestor route (e.g. a detail page under a list route).
  return ROUTE_META.find(
    (r) => r.href !== '/' && (pathname === r.href || pathname.startsWith(r.href + '/')),
  );
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  // Record every visited route into the personalization store so the palette
  // and sidebar can surface "Recently viewed".
  useEffect(() => {
    if (!pathname) return;
    const meta = metaForPath(pathname);
    if (!meta) return;
    // Record the canonical nav href (not the raw pathname) so detail pages fold
    // into their list route and stay clickable/labelled.
    recordVisit({
      href: meta.href,
      label: meta.label,
      group: meta.group,
      iconKey: meta.iconKey,
    });
  }, [pathname]);

  return (
    <Ctx.Provider value={{
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen(p => !p),
    }}>
      {children}
      <CommandPalette open={isOpen} onClose={() => setIsOpen(false)} />
    </Ctx.Provider>
  );
}
