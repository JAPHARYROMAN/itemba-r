'use client';

import { useState } from 'react';

export interface RoleSummary {
  id: string;
  name: string;
  displayName: string;
  scope: string;
  description?: string | null;
}

export interface RolesModalUser {
  id: string;
  email: string;
  fullName: string;
  userRoles?: Array<{ role: { id: string; name: string; displayName: string; scope: string } }>;
}

interface Props {
  user: RolesModalUser;
  allRoles: RoleSummary[];
  onClose: () => void;
  onSaved: () => void;
}

const SCOPE_ORDER = ['GROUP', 'COMPANY', 'DIVISION', 'BRANCH'];

/**
 * RolesModal — assigns the supplied set of roles to a user, replacing any
 * existing assignment. Calls `PUT /api/backend/users/:id/roles` with the
 * canonical `{ roleIds }` payload.
 *
 * Extracted from the Users page so it can be unit-tested independently of
 * the dashboard layout providers.
 */
export function RolesModal({ user, allRoles, onClose, onSaved }: Props) {
  const initialAssigned = new Set((user.userRoles ?? []).map((ur) => ur.role.id));
  const [selected, setSelected] = useState<Set<string>>(initialAssigned);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (roleId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/backend/users/${user.id}/roles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleIds: Array.from(selected) }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? `Error ${res.status}`);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save roles');
    } finally {
      setSaving(false);
    }
  };

  const grouped = SCOPE_ORDER.map((scope) => ({
    scope,
    roles: allRoles
      .filter((r) => r.scope === scope)
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  })).filter((g) => g.roles.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Manage Roles</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {user.fullName} · {user.email}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          >
            ×
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-6 py-4 overflow-y-auto flex-1 space-y-5">
            {error && (
              <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
            {grouped.length === 0 && (
              <div className="text-sm text-slate-400 text-center py-8">
                No roles available. Seed the role catalog first.
              </div>
            )}
            {grouped.map((group) => (
              <div key={group.scope}>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">
                  {group.scope} scope
                </div>
                <div className="space-y-1.5">
                  {group.roles.map((role) => (
                    <label
                      key={role.id}
                      className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(role.id)}
                        onChange={() => toggle(role.id)}
                        aria-label={role.displayName}
                        className="mt-1 h-4 w-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-900">
                          {role.displayName}
                        </div>
                        <div className="text-xs text-slate-400 truncate">
                          {role.name}
                          {role.description ? ` · ${role.description}` : ''}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
            <div className="text-xs text-slate-500">
              {selected.size} role{selected.size === 1 ? '' : 's'} selected
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
              >
                {saving ? 'Saving…' : 'Save Roles'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
