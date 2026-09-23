'use client';
import { useEffect, useState } from 'react';
import { Upload, Trash2, Check, Sparkles } from 'lucide-react';
import { backendDelete, backendGet, backendUpload } from '@/lib/api-client';
import { DEFAULT_APPEARANCE, THEMES, type DesktopAppearance } from '@/lib/desktop';
export function AppearanceStudio({
  value,
  onChange,
  status,
}: {
  value: DesktopAppearance;
  onChange: (change: (current: DesktopAppearance) => DesktopAppearance) => void;
  status: string;
}) {
  const [wallpapers, setWallpapers] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [presetName, setPresetName] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    backendGet<{ id: string; name: string }[]>('/workspace/wallpapers', {
      signal: controller.signal,
    })
      .then(setWallpapers)
      .catch(() => { if(!controller.signal.aborted)setError('Your saved wallpapers could not be loaded.'); });
    return () => controller.abort();
  }, []);
  function change<K extends keyof DesktopAppearance>(key: K, next: DesktopAppearance[K]) {
    onChange((current) => ({ ...current, [key]: next }));
  }
  return (
    <div className="appearance-studio">
      <header>
        <span className="desktop-eyebrow">MAKE YOURSELF AT HOME</span>
        <h1>Your desktop. Your atmosphere.</h1>
        <p>Choose a starting point, then make it yours.</p>
        <span className="desktop-sync" role="status">
          {status}
        </span>
      </header>
      <section>
        <h2>Collections</h2>
        <div className="appearance-themes">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              aria-pressed={value.theme === theme.id}
              onClick={() =>
                onChange((current) => ({
                  ...current,
                  theme: theme.id,
                  accent: theme.accent,
                  wallpaperId: null,
                }))
              }
            >
              <span
                className="appearance-theme-preview"
                data-theme={theme.id}
                style={{ backgroundColor: theme.color }}
              >
                <span />
                <i />
                {value.theme === theme.id && <Check size={20} />}
              </span>
              <strong>{theme.label}</strong>
            </button>
          ))}
        </div>
      </section>
      <section className="appearance-section">
        <h2>Colour & material</h2>
        <div className="appearance-controls">
          <label>
            Appearance
            <select
              value={value.mode}
              onChange={(e) => change('mode', e.target.value as DesktopAppearance['mode'])}
            >
              <option value="system">Follow device</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label>
            Accent colour
            <input
              type="color"
              value={value.accent}
              onChange={(e) => change('accent', e.target.value)}
            />
          </label>
          <label>
            Transparency
            <select
              value={value.transparency}
              onChange={(e) =>
                change('transparency', e.target.value as DesktopAppearance['transparency'])
              }
            >
              <option value="full">Tinted glass</option>
              <option value="reduced">Solid surfaces</option>
            </select>
          </label>
          <label>
            Glass softness <output>{value.blur}</output>
            <input
              type="range"
              min="0"
              max="40"
              value={value.blur}
              onChange={(e) => change('blur', Number(e.target.value))}
            />
          </label>
          <label>
            Density
            <select
              value={value.density}
              onChange={(e) => change('density', e.target.value as DesktopAppearance['density'])}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
        </div>
      </section>
      <section className="appearance-section">
        <h2>Wallpaper</h2>
        <p>Your uploads stay private to your account.</p>
        <div className="appearance-wallpapers">
          <button aria-pressed={!value.wallpaperId} onClick={() => change('wallpaperId', null)}>
            Collection wallpaper
          </button>
          {wallpapers.map((wallpaper) => (
            <div key={wallpaper.id}>
              <button
                aria-pressed={value.wallpaperId === wallpaper.id}
                onClick={() => change('wallpaperId', wallpaper.id)}
              >
                {wallpaper.name}
              </button>
              <button
                aria-label={`Delete wallpaper ${wallpaper.name}`}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await backendDelete(`/workspace/wallpapers/${wallpaper.id}`);
                    setWallpapers((rows) => rows.filter((row) => row.id !== wallpaper.id));
                    if (value.wallpaperId === wallpaper.id) change('wallpaperId', null);
                  } catch {
                    setError('Could not remove this wallpaper.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <label className="appearance-upload">
          <Upload size={17} />
          {busy ? 'Uploading…' : 'Choose an image'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              e.target.value = '';
              setBusy(true);
              setError('');
              try {
                const form = new FormData();
                form.append('file', file);
                const wallpaper = await backendUpload<{ id: string; name: string }>(
                  '/workspace/wallpapers',
                  form,
                );
                setWallpapers((rows) => [wallpaper, ...rows]);
                change('wallpaperId', wallpaper.id);
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : 'The image could not be uploaded.',
                );
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        <label className="appearance-inline">
          Position
          <select
            value={value.wallpaperPosition}
            onChange={(e) =>
              change('wallpaperPosition', e.target.value as DesktopAppearance['wallpaperPosition'])
            }
          >
            <option value="center">Centre</option>
            <option value="top">Top</option>
            <option value="bottom">Bottom</option>
          </select>
        </label>
        {error && <p role="alert">{error}</p>}
      </section>
      <section className="appearance-section">
        <h2>Dock & movement</h2>
        <div className="appearance-controls">
          <label>
            Dock position
            <select
              value={value.dock}
              onChange={(e) => change('dock', e.target.value as DesktopAppearance['dock'])}
            >
              <option value="bottom">Bottom</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label>
            Icon size <output>{value.iconSize}px</output>
            <input
              type="range"
              min="36"
              max="64"
              value={value.iconSize}
              onChange={(e) => change('iconSize', Number(e.target.value))}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={value.autoHide}
              onChange={(e) => change('autoHide', e.target.checked)}
            />{' '}
            Automatically hide the dock
          </label>
          <label>
            Motion
            <select
              value={value.motion}
              onChange={(e) => change('motion', e.target.value as DesktopAppearance['motion'])}
            >
              <option value="system">Follow device</option>
              <option value="full">Expressive</option>
              <option value="reduced">Reduced</option>
            </select>
          </label>
          <label>
            Motion intensity
            <input
              type="range"
              min="0.5"
              max="1.4"
              step="0.1"
              value={value.intensity}
              onChange={(e) => change('intensity', Number(e.target.value))}
            />
          </label>
        </div>
        <p className="appearance-footnote">
          Device accessibility preferences always take priority.
        </p>
      </section>
      <section className="appearance-section">
        <h2>Desktop widgets</h2>
        <div className="appearance-controls">
          {(['recent', 'drafts', 'approvals'] as const).map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={value.widgets[key]}
                onChange={(e) =>
                  onChange((current) => ({
                    ...current,
                    widgets: { ...current.widgets, [key]: e.target.checked },
                  }))
                }
              />
              {
                { recent: 'Recent work', drafts: 'Saved drafts', approvals: 'Pending approvals' }[
                  key
                ]
              }
            </label>
          ))}
        </div>
      </section>
      <section className="appearance-section">
        <h2>Personal colour presets</h2>
        <div className="appearance-presets">
          {value.presets.map((preset, index) => (
            <button
              key={`${preset.name}-${index}`}
              onClick={() =>
                onChange((current) => ({
                  ...current,
                  theme: preset.theme as DesktopAppearance['theme'],
                  accent: preset.accent,
                  mode: preset.mode,
                }))
              }
            >
              <i style={{ background: preset.accent }} />
              {preset.name}
            </button>
          ))}
        </div>
        <div className="appearance-save">
          <input
            aria-label="Preset name"
            placeholder="Name this colour combination"
            value={presetName}
            maxLength={40}
            onChange={(e) => setPresetName(e.target.value)}
          />
          <button
            disabled={!presetName.trim() || value.presets.length >= 12}
            onClick={() => {
              onChange((current) => ({
                ...current,
                presets: [
                  ...current.presets,
                  {
                    name: presetName.trim(),
                    theme: current.theme,
                    accent: current.accent,
                    mode: current.mode,
                  },
                ],
              }));
              setPresetName('');
            }}
          >
            <Sparkles size={15} />
            Save preset
          </button>
        </div>
      </section>
      <button
        className="appearance-reset"
        onClick={() =>
          onChange((current) => ({
            ...DEFAULT_APPEARANCE,
            shortcuts: current.shortcuts,
            presets: current.presets,
          }))
        }
      >
        Reset appearance to Aurora
      </button>
    </div>
  );
}
