'use client';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { useMotionPreference } from '@/hooks/use-motion-preference';
import { useWorkspacePreferences } from '@/hooks/use-workspace-preferences';

/** Shared by the desktop Settings app and the ERP settings hub. */
export function WorkspaceControls() {
  const { user } = useAuth();
  const { mode, setMode } = useTheme();
  const motion = useMotionPreference();
  const { preferences, update } = useWorkspacePreferences(user?.id);
  return (
    <div className="settings-controls">
      <fieldset className="settings-appearance">
        <legend>Appearance</legend>
        <p>Choose the look of your workspace.</p>
        <div className="settings-appearance-options">
          {(
            [
              { value: 'light', label: 'Light', Icon: Sun },
              { value: 'dark', label: 'Dark', Icon: Moon },
              { value: 'system', label: 'Automatic', Icon: Monitor },
            ] as const
          ).map(({ value, label, Icon }) => (
            <button
              type="button"
              key={value}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              <Icon size={24} strokeWidth={1.5} aria-hidden />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="settings-backdrops">
        <legend>Desktop backdrop</legend>
        <p>A little atmosphere, or a quieter canvas.</p>
        <div>
          {(
            [
              { value: 'landscape', label: 'Landscape' },
              { value: 'mist', label: 'Mist' },
              { value: 'graphite', label: 'Graphite' },
            ] as const
          ).map(({ value, label }) => (
            <button
              type="button"
              key={value}
              aria-pressed={preferences.backdrop === value}
              onClick={() => update((current) => ({ ...current, backdrop: value }))}
            >
              <span data-backdrop={value} aria-hidden="true" />
              <strong>{label}</strong>
            </button>
          ))}
        </div>
      </fieldset>
      <div className="settings-group">
        <label className="settings-control-row">
          <span>
            <strong>Workspace density</strong>
            <small>Choose the spacing in lists and app controls.</small>
          </span>
          <select
            value={preferences.density}
            onChange={(event) =>
              update((current) => ({
                ...current,
                density: event.target.value as 'comfortable' | 'compact',
              }))
            }
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>
        <label className="settings-control-row">
          <span>
            <strong>Transparency</strong>
            <small>Use solid surfaces for greater visual clarity.</small>
          </span>
          <select
            value={preferences.transparency}
            onChange={(event) =>
              update((current) => ({
                ...current,
                transparency: event.target.value as 'full' | 'reduced',
              }))
            }
          >
            <option value="full">Translucent</option>
            <option value="reduced">Reduced</option>
          </select>
        </label>
        <label className="settings-control-row">
          <span>
            <strong>When ITEMBA OS opens</strong>
            <small>Pick up where you left off, or start fresh.</small>
          </span>
          <select
            value={preferences.startup}
            onChange={(event) =>
              update((current) => ({
                ...current,
                startup: event.target.value as 'desktop' | 'resume',
              }))
            }
          >
            <option value="desktop">Start at the desktop</option>
            <option value="resume">Resume my last app</option>
          </select>
        </label>
        <label className="settings-control-row">
          <span>
            <strong>Motion</strong>
            <small>Reduce movement and interface animations.</small>
          </span>
          <select
            value={motion.mode}
            onChange={(event) =>
              motion.setMode(event.target.value as 'system' | 'full' | 'reduced')
            }
          >
            <option value="system">Follow device</option>
            <option value="reduced">Reduced</option>
            <option value="full">Full</option>
          </select>
        </label>
      </div>
      <p className="settings-footnote">
        Changes apply immediately on this device. App pins, window size and record layouts are
        remembered for your account.
      </p>
    </div>
  );
}
