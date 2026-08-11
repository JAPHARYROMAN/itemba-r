'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Building2, Globe2, MonitorCog, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { Card, PageHeader, FormSelect, Btn, SkeletonCardGrid, ConfirmDialog, showToast } from '@/components/ui';
import { FormSwitch } from '@/components/aurora/forms/FormSwitch';
import { useMotionPreference } from '@/hooks/use-motion-preference';
import { useTheme, type ThemeMode } from '@/hooks/use-theme';

interface Company { id: string; name: string; code: string; }
interface Division { id: string; name: string; code: string; companyId: string; }
interface Branch { id: string; name: string; code: string; divisionId: string; }

interface UserPreference {
  theme: ThemeMode;
  density: string;
  locale: string;
  timezone: string;
  dateFormat: string;
  numberFormat: string;
  defaultCompanyId?: string | null;
  defaultDivisionId?: string | null;
  defaultBranchId?: string | null;
  persisted?: boolean;
  updatedAt?: string;
}

const THEMES: Array<{ value: ThemeMode; label: string }> = [
  { value: 'system', label: 'System (follow OS)' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const DENSITIES = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'spacious', label: 'Spacious' },
];
const LOCALES = [
  { value: 'en', label: 'English' },
  { value: 'sw', label: 'Kiswahili' },
];
const DATE_FORMATS = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (e.g. 30/04/2026)' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (e.g. 04/30/2026)' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (e.g. 2026-04-30)' },
];
const NUMBER_FORMATS = [
  { value: 'en-GB', label: '1,234.56 (en-GB / en-TZ)' },
  { value: 'en-US', label: '1,234.56 (en-US)' },
  { value: 'fr-FR', label: '1 234,56 (fr-FR)' },
];
const TIMEZONES = [
  { value: 'Africa/Dar_es_Salaam', label: 'Africa/Dar es Salaam (EAT)' },
  { value: 'Africa/Nairobi', label: 'Africa/Nairobi (EAT)' },
  { value: 'Africa/Kampala', label: 'Africa/Kampala (EAT)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'Europe/London' },
];

const DEFAULTS: UserPreference = {
  theme: 'system',
  density: 'comfortable',
  locale: 'en',
  timezone: 'Africa/Dar_es_Salaam',
  dateFormat: 'DD/MM/YYYY',
  numberFormat: 'en-GB',
  defaultCompanyId: null,
  defaultDivisionId: null,
  defaultBranchId: null,
  persisted: false,
};

function normalizeTheme(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export default function UserPreferencesPage() {
  const { setMode: setThemeMode } = useTheme();
  const {
    mode: motionMode,
    setMode: setMotionMode,
    hydrated: motionHydrated,
  } = useMotionPreference();
  const [prefs, setPrefs] = useState<UserPreference>(DEFAULTS);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // Load companies once.
  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => {
        const inner = j.data?.data ?? j.data;
        const rows: Company[] = Array.isArray(inner) ? inner : Array.isArray(inner?.data) ? inner.data : [];
        setCompanies(rows);
      })
      // Dropdown options only: the preferences form still loads and saves; failure just leaves the company select empty.
      .catch(() => undefined);
  }, []);

  // Cascade divisions → branches when defaults change.
  useEffect(() => {
    if (!prefs.defaultCompanyId) { setDivisions([]); return; }
    fetch(`/api/backend/divisions?companyId=${prefs.defaultCompanyId}&limit=50`)
      .then((r) => r.json())
      .then((j) => {
        const inner = j.data?.data ?? j.data;
        const rows: Division[] = Array.isArray(inner) ? inner : Array.isArray(inner?.data) ? inner.data : [];
        setDivisions(rows);
      })
      // Dropdown options only: failure just leaves the division select empty.
      .catch(() => undefined);
  }, [prefs.defaultCompanyId]);

  useEffect(() => {
    if (!prefs.defaultDivisionId) { setBranches([]); return; }
    fetch(`/api/backend/branches?divisionId=${prefs.defaultDivisionId}&limit=50`)
      .then((r) => r.json())
      .then((j) => {
        const inner = j.data?.data ?? j.data;
        const rows: Branch[] = Array.isArray(inner) ? inner : Array.isArray(inner?.data) ? inner.data : [];
        setBranches(rows);
      })
      // Dropdown options only: failure just leaves the branch select empty.
      .catch(() => undefined);
  }, [prefs.defaultDivisionId]);

  // Load my prefs.
  const loadPrefs = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/backend/user-preferences/me');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const data: UserPreference = json.data ?? json;
      const nextPrefs = { ...DEFAULTS, ...data, theme: normalizeTheme(data.theme) };
      setPrefs(nextPrefs);
      setThemeMode(nextPrefs.theme);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load preferences';
      setError(message);
      showToast('error', 'Preferences unavailable', message);
    } finally {
      setLoading(false);
    }
  }, [setThemeMode]);

  useEffect(() => { loadPrefs(); }, [loadPrefs]);

  const update = <K extends keyof UserPreference>(key: K, value: UserPreference[K]) => {
    setPrefs((p) => {
      // Cascade: clearing or changing company invalidates division+branch defaults.
      if (key === 'defaultCompanyId') {
        return { ...p, defaultCompanyId: value as string | null, defaultDivisionId: null, defaultBranchId: null };
      }
      if (key === 'defaultDivisionId') {
        return { ...p, defaultDivisionId: value as string | null, defaultBranchId: null };
      }
      return { ...p, [key]: value };
    });
    if (key === 'theme') setThemeMode(normalizeTheme(value));
    setInfo('');
  };

  const save = async () => {
    setSaving(true); setError(''); setInfo('');
    try {
      const body: Record<string, unknown> = {
        theme: prefs.theme,
        density: prefs.density,
        locale: prefs.locale,
        timezone: prefs.timezone,
        dateFormat: prefs.dateFormat,
        numberFormat: prefs.numberFormat,
        defaultCompanyId: prefs.defaultCompanyId || null,
        defaultDivisionId: prefs.defaultDivisionId || null,
        defaultBranchId: prefs.defaultBranchId || null,
      };
      const res = await fetch('/api/backend/user-preferences/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      const data: UserPreference = json.data ?? json;
      const nextPrefs = { ...DEFAULTS, ...data, theme: normalizeTheme(data.theme) };
      setPrefs(nextPrefs);
      setThemeMode(nextPrefs.theme);
      setInfo('Preferences saved.');
      showToast('success', 'Preferences saved', 'Your account preferences were updated.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      setError(message);
      showToast('error', 'Preferences were not saved', message);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setConfirmingReset(false);
    setSaving(true); setError(''); setInfo('');
    try {
      const res = await fetch('/api/backend/user-preferences/me', { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPrefs(DEFAULTS);
      setThemeMode(DEFAULTS.theme);
      setMotionMode('system');
      setInfo('Your workspace settings were reset to defaults.');
      showToast('success', 'Preferences reset', 'Default workspace settings are active again.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reset';
      setError(message);
      showToast('error', 'Preferences were not reset', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="My Workspace Settings"
        subtitle="Personal display, formatting, and default company scope. These affect only your account."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'My Workspace Settings' }]}
        actions={
          <div className="flex items-center gap-2">
            <Btn
              variant="secondary"
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={() => setConfirmingReset(true)}
              disabled={saving || loading}
            >
              Reset
            </Btn>
            <Btn
              icon={<Save className="h-3.5 w-3.5" />}
              onClick={save}
              disabled={saving || loading}
            >
              {saving ? 'Saving…' : 'Save settings'}
            </Btn>
          </div>
        }
      />

      <ConfirmDialog
        open={confirmingReset}
        title="Reset Workspace Settings"
        variant="warning"
        confirmLabel="Reset"
        message="Reset your workspace settings back to the Itemba-R defaults?"
        onConfirm={reset}
        onCancel={() => setConfirmingReset(false)}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <PreferenceSummary
          icon={<MonitorCog className="h-4 w-4" />}
          title="Display"
          value={`${THEMES.find((theme) => theme.value === prefs.theme)?.label ?? 'System'} / ${prefs.density}`}
          note="Theme, density, and motion settings."
        />
        <PreferenceSummary
          icon={<Globe2 className="h-4 w-4" />}
          title="Format"
          value={`${prefs.dateFormat} / ${prefs.timezone}`}
          note="Dates, language, timezone, and number style."
        />
        <PreferenceSummary
          icon={<Building2 className="h-4 w-4" />}
          title="Default scope"
          value={prefs.defaultCompanyId ? 'Pre-selected' : 'Not set'}
          note="Company, division, and branch defaults."
        />
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {info && <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700">{info}</div>}
      {loading && <SkeletonCardGrid count={4} className="grid grid-cols-1 gap-4 md:grid-cols-2" />}

      {!loading && (
        <>
          <Card className="p-5 space-y-4">
            <SettingsSection
              icon={<MonitorCog className="h-4 w-4" />}
              title="Appearance"
              description="Choose the visual comfort level for your own account."
            />
            <div className="aurora-stagger grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormSelect
                label="Theme"
                value={prefs.theme}
                onChange={(e) => update('theme', normalizeTheme(e.target.value))}
                options={THEMES}
                hint="Light / Dark / follow OS."
              />
              <FormSelect
                label="Density"
                value={prefs.density}
                onChange={(e) => update('density', e.target.value)}
                options={DENSITIES}
                hint="How much padding tables and lists use."
              />
              <div className="md:col-span-2">
                <FormSwitch
                  label="Reduce motion"
                  checked={motionHydrated && motionMode === 'reduced'}
                  onChange={(checked) => setMotionMode(checked ? 'reduced' : 'system')}
                  help="Turns off UI transitions and entrance animations on this device."
                />
              </div>
            </div>
          </Card>

          <Card className="p-5 space-y-4">
            <SettingsSection
              icon={<Globe2 className="h-4 w-4" />}
              title="Locale and formatting"
              description="Control how dates, time, language, and numbers are shown."
            />
            <div className="aurora-stagger grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <FormSelect
                label="Language"
                value={prefs.locale}
                onChange={(e) => update('locale', e.target.value)}
                options={LOCALES}
              />
              <FormSelect
                label="Timezone"
                value={prefs.timezone}
                onChange={(e) => update('timezone', e.target.value)}
                options={TIMEZONES}
              />
              <FormSelect
                label="Date Format"
                value={prefs.dateFormat}
                onChange={(e) => update('dateFormat', e.target.value)}
                options={DATE_FORMATS}
              />
              <FormSelect
                label="Number Format"
                value={prefs.numberFormat}
                onChange={(e) => update('numberFormat', e.target.value)}
                options={NUMBER_FORMATS}
                hint="Affects how numbers and currencies are displayed."
              />
            </div>
          </Card>

          <Card className="p-5 space-y-4">
            <SettingsSection
              icon={<ShieldCheck className="h-4 w-4" />}
              title="Default scope"
              description="Pre-select the business area you normally work in."
            />
            <p className="text-[12px] text-slate-500 -mt-1">
              Pages that ask &quot;which company?&quot; will pre-select these. You can still override on any page.
            </p>
            <div className="aurora-stagger grid grid-cols-1 gap-4 md:grid-cols-3">
              <FormSelect
                label="Default Company"
                value={prefs.defaultCompanyId ?? ''}
                onChange={(e) => update('defaultCompanyId', e.target.value || null)}
                placeholder="— None —"
                options={companies.map((c) => ({ value: c.id, label: c.name }))}
              />
              <FormSelect
                label="Default Division"
                value={prefs.defaultDivisionId ?? ''}
                onChange={(e) => update('defaultDivisionId', e.target.value || null)}
                placeholder="— None —"
                disabled={!prefs.defaultCompanyId}
                options={divisions.map((d) => ({ value: d.id, label: d.name }))}
              />
              <FormSelect
                label="Default Branch"
                value={prefs.defaultBranchId ?? ''}
                onChange={(e) => update('defaultBranchId', e.target.value || null)}
                placeholder="— None —"
                disabled={!prefs.defaultDivisionId}
                options={branches.map((b) => ({ value: b.id, label: b.name }))}
              />
            </div>
          </Card>

          <div className="text-[11px] text-slate-400">
            {prefs.persisted
              ? prefs.updatedAt
                ? `Saved ${new Date(prefs.updatedAt).toLocaleString()}.`
                : 'Saved.'
              : 'Using defaults — save once to persist your choices.'}
          </div>
        </>
      )}
    </div>
  );
}

function PreferenceSummary({
  icon,
  title,
  value,
  note,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  note: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-900">{value}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">{note}</div>
        </div>
      </div>
    </Card>
  );
}

function SettingsSection({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
        {icon}
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
    </div>
  );
}
