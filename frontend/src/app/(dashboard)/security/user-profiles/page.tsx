'use client';

import { WorkspaceTable } from '@/components/ui/workspace-table';
import { useState, useEffect, useCallback } from 'react';
import { PageSpinner, Modal, Btn, FormDateField, FormInput, FormSelect, ErrorState } from '@/components/ui';
import { backendList, backendPost, backendPatch } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';

const RISK_COLORS: Record<string, string> = {
  LOW: 'bg-green-100 text-green-700',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  HIGH: 'bg-orange-100 text-orange-700',
  CRITICAL: 'bg-red-100 text-red-700',
};

const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const TWO_FACTOR_METHODS = ['NONE', 'TOTP', 'SMS', 'EMAIL', 'BACKUP_CODE'];

interface UserRef {
  id: string;
  fullName?: string | null;
  email?: string | null;
}

interface ProfileForm {
  userId: string;
  securityRiskLevel: string;
  twoFactorEnabled: string;
  twoFactorMethod: string;
  forcePasswordChange: string;
  forceTwoFactorSetup: string;
  lockedUntil: string;
  passwordExpiresAt: string;
}

const BLANK: ProfileForm = {
  userId: '',
  securityRiskLevel: 'LOW',
  twoFactorEnabled: 'false',
  twoFactorMethod: 'NONE',
  forcePasswordChange: 'false',
  forceTwoFactorSetup: 'false',
  lockedUntil: '',
  passwordExpiresAt: '',
};

function toLocalInput(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formFromProfile(p: any): ProfileForm {
  return {
    userId: p.userId ?? '',
    securityRiskLevel: p.securityRiskLevel ?? 'LOW',
    twoFactorEnabled: p.twoFactorEnabled ? 'true' : 'false',
    twoFactorMethod: p.twoFactorMethod ?? 'NONE',
    forcePasswordChange: p.forcePasswordChange ? 'true' : 'false',
    forceTwoFactorSetup: p.forceTwoFactorSetup ? 'true' : 'false',
    lockedUntil: toLocalInput(p.lockedUntil),
    passwordExpiresAt: toLocalInput(p.passwordExpiresAt),
  };
}

function ProfileModal({ mode, initial, users, onClose, onSaved }: {
  mode: 'create' | 'edit';
  initial?: any;
  users: UserRef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [initialForm] = useState<ProfileForm>(() => (initial ? formFromProfile(initial) : { ...BLANK }));
  const [form, setForm] = useState<ProfileForm>(initialForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof ProfileForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (mode === 'create' && !form.userId) { setError('User is required'); return; }
    setSaving(true); setError('');
    try {
      if (mode === 'create') {
        await backendPost('user-security-profiles', {
          userId: form.userId,
          securityRiskLevel: form.securityRiskLevel,
          twoFactorMethod: form.twoFactorMethod,
          forcePasswordChange: form.forcePasswordChange === 'true',
          forceTwoFactorSetup: form.forceTwoFactorSetup === 'true',
        });
      } else {
        const body: Record<string, unknown> = {};
        if (form.twoFactorEnabled !== initialForm.twoFactorEnabled) body.twoFactorEnabled = form.twoFactorEnabled === 'true';
        if (form.twoFactorMethod !== initialForm.twoFactorMethod) body.twoFactorMethod = form.twoFactorMethod;
        if (form.forcePasswordChange !== initialForm.forcePasswordChange) body.forcePasswordChange = form.forcePasswordChange === 'true';
        if (form.forceTwoFactorSetup !== initialForm.forceTwoFactorSetup) body.forceTwoFactorSetup = form.forceTwoFactorSetup === 'true';
        if (form.securityRiskLevel !== initialForm.securityRiskLevel) body.securityRiskLevel = form.securityRiskLevel;
        if (form.lockedUntil !== initialForm.lockedUntil)
          body.lockedUntil = form.lockedUntil ? new Date(form.lockedUntil).toISOString() : null;
        if (form.passwordExpiresAt !== initialForm.passwordExpiresAt)
          body.passwordExpiresAt = form.passwordExpiresAt ? new Date(form.passwordExpiresAt).toISOString() : null;
        if (Object.keys(body).length === 0) { onClose(); return; }
        await backendPatch(`user-security-profiles/${initial.id}`, body);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Security Profile' : 'Edit Security Profile'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div role="alert" className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        {mode === 'create' ? (
          users.length > 0 ? (
            <FormSelect label="User" required value={form.userId} onChange={(e) => set('userId', e.target.value)} placeholder="Select…" className="col-span-2">
              {users.map((u) => <option key={u.id} value={u.id}>{u.fullName ?? u.email ?? u.id}</option>)}
            </FormSelect>
          ) : (
            <FormInput label="User ID" required value={form.userId} onChange={(e) => set('userId', e.target.value)} className="col-span-2" />
          )
        ) : (
          <FormInput label="User ID" value={form.userId} disabled className="col-span-2" />
        )}
        <FormSelect label="Risk Level" value={form.securityRiskLevel} onChange={(e) => set('securityRiskLevel', e.target.value)}>
          {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
        </FormSelect>
        <FormSelect label="2FA Method" value={form.twoFactorMethod} onChange={(e) => set('twoFactorMethod', e.target.value)}>
          {TWO_FACTOR_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </FormSelect>
        {mode === 'edit' && (
          <FormSelect label="2FA Enabled" hint="Can only be enabled after the user completes 2FA setup"
            value={form.twoFactorEnabled} onChange={(e) => set('twoFactorEnabled', e.target.value)}>
            <option value="false">Disabled</option>
            <option value="true">Enabled</option>
          </FormSelect>
        )}
        <FormSelect label="Force Password Change" value={form.forcePasswordChange} onChange={(e) => set('forcePasswordChange', e.target.value)}>
          <option value="false">No</option>
          <option value="true">Yes</option>
        </FormSelect>
        <FormSelect label="Force 2FA Setup" value={form.forceTwoFactorSetup} onChange={(e) => set('forceTwoFactorSetup', e.target.value)}>
          <option value="false">No</option>
          <option value="true">Yes</option>
        </FormSelect>
        {mode === 'edit' && (
          <>
            <FormDateField
              label="Locked Until"
              hint="Clear to unlock the account"
              granularity="minute"
              value={form.lockedUntil}
              onChange={(value) => set('lockedUntil', value)}
            />
            <FormDateField
              label="Password Expires At"
              granularity="minute"
              value={form.passwordExpiresAt}
              onChange={(value) => set('passwordExpiresAt', value)}
            />
          </>
        )}
      </div>
    </Modal>
  );
}

export default function UserSecurityProfilesPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const canView = hasPermission('user_security_profiles.view');
  const canManage = hasPermission('user_security_profiles.manage');
  const canReadUsers = hasPermission('users.read');
  const beginRequest = useRequestGuard();

  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [users, setUsers] = useState<UserRef[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const load = useCallback(async () => {
    if (authLoading || !canView) return;
    const request = beginRequest();
    setLoading(true);
    setLoadError('');
    try {
      const rows = await backendList<any>('user-security-profiles', { signal: request.signal });
      if (!request.current()) return;
      setData(rows);
    } catch {
      if (!request.current()) return;
      setData([]);
      setLoadError('Failed to load user security profiles.');
    } finally {
      if (request.current()) setLoading(false);
    }
  }, [authLoading, beginRequest, canView]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (authLoading || !canManage || !canReadUsers) return;
    const controller = new AbortController();
    backendList<UserRef>('users', { query: { limit: 1000 }, signal: controller.signal })
      .then((rows) => {
        if (!controller.signal.aborted) setUsers(rows);
      })
      .catch(() => {
        if (!controller.signal.aborted) setUsers([]);
      });
    return () => controller.abort();
  }, [authLoading, canManage, canReadUsers]);

  const onSaved = () => {
    setCreating(false);
    setEditing(null);
    void load();
  };

  if (authLoading || !canView) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900">User Security Profiles</h1>
        <p className="text-gray-500 mt-1">{authLoading ? 'Loading' : 'Access Restricted'}</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Security Profiles</h1>
          <p className="text-gray-500 mt-1">
            View 2FA status, risk levels, and login history per user
          </p>
        </div>
        {canManage && <Btn variant="primary" onClick={() => setCreating(true)}>+ New Profile</Btn>}
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <WorkspaceTable className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">2FA Enabled</th>
                <th className="px-4 py-3">Risk Level</th>
                <th className="px-4 py-3">Last Login</th>
                <th className="px-4 py-3">Failed Attempts</th>
                <th className="px-4 py-3">Force Password Change</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 7 : 6} className="px-4 py-8 text-center text-gray-400">
                    No profiles found
                  </td>
                </tr>
              ) : (
                data.map((row: any) => (
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{row.user?.name ?? row.userId}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${row.twoFactorEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                      >
                        {row.twoFactorEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${RISK_COLORS[row.securityRiskLevel] ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        {row.securityRiskLevel ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3">{row.failedLoginAttempts ?? 0}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${row.forcePasswordChange ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}
                      >
                        {row.forcePasswordChange ? 'Yes' : 'No'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Btn variant="ghost" size="xs" onClick={() => setEditing(row)}>Edit</Btn>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </WorkspaceTable>
        </div>
      )}

      {creating && <ProfileModal mode="create" users={users} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <ProfileModal mode="edit" initial={editing} users={users} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  );
}
