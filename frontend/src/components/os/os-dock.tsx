'use client';

import { useRef, type KeyboardEvent } from 'react';
import { motion } from 'motion/react';
import { LayoutGrid } from 'lucide-react';
import { AppGlyph } from './app-glyph';
import type { WorkspaceApp } from '@/lib/apps';

export function OsDock({
  apps,
  desktop,
  activeAppId,
  settingsOpen,
  onDesktop,
  onOpen,
}: {
  apps: readonly WorkspaceApp[];
  desktop: boolean;
  activeAppId: string;
  settingsOpen: boolean;
  onDesktop: () => void;
  onOpen: (app: WorkspaceApp) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  function navigate(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
    buttons[next]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  return (
    <nav className="os-dock" aria-label="Applications" ref={ref} onKeyDown={navigate}>
      <motion.button
        type="button"
        whileTap={{ scale: 0.94 }}
        onClick={onDesktop}
        aria-label="Show Apps"
        aria-pressed={desktop}
      >
        <span className="os-apps-icon os-glyph">
          <LayoutGrid size={26} strokeWidth={1.7} aria-hidden="true" />
        </span>
        <span className="os-dock-label">Apps</span>
        <i data-active={desktop} aria-hidden="true" />
      </motion.button>
      <span className="os-dock-divider" aria-hidden="true" />
      {apps.map((app) => {
        const active =
          app.launch.kind === 'settings' ? settingsOpen : !desktop && activeAppId === app.id;
        return (
          <motion.button
            key={app.id}
            type="button"
            whileTap={{ scale: 0.94 }}
            onClick={() => onOpen(app)}
            aria-label={app.launch.kind === 'settings' ? 'Open OS settings' : `Open ${app.label}`}
            aria-pressed={active}
          >
            <AppGlyph app={app} />
            <span className="os-dock-label">{app.label}</span>
            <i data-active={active} aria-hidden="true" />
          </motion.button>
        );
      })}
    </nav>
  );
}
