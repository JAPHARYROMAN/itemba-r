'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PageHeader,
  Card,
  Btn,
  Modal,
  ConfirmDialog,
  FormInput,
  FormSelect,
  FormTextarea,
  PageSpinner,
  ErrorState,
  EmptyState,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

// ─── Types ────────────────────────────────────────────────────────────────────

type RoleScope = 'GROUP' | 'COMPANY' | 'DIVISION' | 'BRANCH';

interface Permission {
  id: string;
  code: string;
  description: string;
  module: string;
  action: string;
  isGroupControl: boolean;
}

interface RolePermissionLink {
  permission: Permission;
}

interface Role {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  scope: RoleScope;
  isSystem: boolean;
  rolePermissions: RolePermissionLink[];
  _count?: { userRoles: number; rolePermissions: number };
}

const SCOPE_OPTIONS = [
  { value: 'GROUP', label: 'Group — entire group, including Group Control' },
  { value: 'COMPANY', label: 'Company — single company' },
  { value: 'DIVISION', label: 'Division — single division' },
  { value: 'BRANCH', label: 'Branch — single branch / site / project' },
];

const SCOPE_BADGE: Record<RoleScope, string> = {
  GROUP: 'bg-purple-100 text-purple-700 border-purple-200',
  COMPANY: 'bg-blue-100 text-blue-700 border-blue-200',
  DIVISION: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  BRANCH: 'bg-amber-100 text-amber-700 border-amber-200',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RolesPage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('roles.read');
  const canCreate = hasPermission('roles.create');
  const canUpdate = hasPermission('roles.update');
  const canDelete = hasPermission('roles.delete');

  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/backend/roles');
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(`HTTP ${res.status}: ${errJson?.message ?? 'Failed to load roles'}`);
      }
      const json = await res.json();
      const list: Role[] = Array.isArray(json.data?.data)
        ? json.data.data
        : Array.isArray(json.data)
        ? json.data
        : Array.isArray(json)
        ? json
        : [];
      setRoles(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }, [canRead]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/backend/roles/${deleting.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const message =
          (Array.isArray(errJson?.message) && errJson.message.join(', ')) ||
          errJson?.message ||
          `HTTP ${res.status}`;
        throw new Error(message);
      }
      setDeleting(null);
      await load();
    } catch (e) {
      // Surface the error inline so the user can see why it refused.
      setError(e instanceof Error ? e.message : 'Failed to delete role');
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  if (!canRead) {
    return (
      <main className="p-6">
        <PageHeader title="Roles" subtitle="Manage role definitions and permission assignments" />
        <Card className="p-6">
          <p className="text-sm text-slate-600">You do not have permission to view roles.</p>
        </Card>
      </main>
    );
  }

  return (
    <main className="p-6 flex-1">
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <PageHeader
          title="Roles"
          subtitle="Define what users can do. Each role bundles a set of permissions; assign roles to users from the Users page."
        />
        {canCreate && (
          <Btn variant="primary" onClick={() => { setEditing(null); setEditorOpen(true); }}>
            + New Role
          </Btn>
        )}
      </div>

      {error && (
        <Card className="p-4 mb-4">
          <ErrorState message={error} onRetry={() => { setError(null); void load(); }} />
        </Card>
      )}

      {loading ? (
        <Card className="p-6"><PageSpinner /></Card>
      ) : roles.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            title="No roles defined"
            description={canCreate ? 'Create the first role to get started.' : 'Ask an administrator to create role definitions.'}
          />
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left bg-slate-50 border-b border-slate-200" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-5 py-3 text-xs uppercase tracking-wide">Role</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide">Scope</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide">Permissions</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide">Users</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {roles.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">{r.displayName}</span>
                      {r.isSystem && (
                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                          System
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-mono text-slate-400 mt-0.5">{r.name}</div>
                    {r.description && (
                      <div className="text-xs text-slate-500 mt-1">{r.description}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 align-top">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${SCOPE_BADGE[r.scope]}`}>
                      {r.scope}
                    </span>
                  </td>
                  <td className="px-5 py-3 align-top tabular-nums text-slate-700">
                    {r._count?.rolePermissions ?? r.rolePermissions?.length ?? 0}
                  </td>
                  <td className="px-5 py-3 align-top tabular-nums text-slate-700">
                    {r._count?.userRoles ?? 0}
                  </td>
                  <td className="px-5 py-3 align-top text-right space-x-1 whitespace-nowrap">
                    {canUpdate && (
                      <Btn
                        variant="ghost"
                        size="xs"
                        onClick={() => { setEditing(r); setEditorOpen(true); }}
                      >
                        Edit
                      </Btn>
                    )}
                    {canDelete && !r.isSystem && (
                      <Btn
                        variant="ghost"
                        size="xs"
                        onClick={() => setDeleting(r)}
                      >
                        Delete
                      </Btn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {editorOpen && (
        <RoleEditorModal
          role={editing}
          onClose={() => setEditorOpen(false)}
          onSaved={() => { setEditorOpen(false); void load(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete role"
        message={
          deleting
            ? `Delete the role "${deleting.displayName}"? This cannot be undone.${
                deleting._count?.userRoles
                  ? ` Note: ${deleting._count.userRoles} user(s) currently hold this role and will need to be reassigned first.`
                  : ''
              }`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteBusy}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </main>
  );
}

// ─── Role Editor Modal ────────────────────────────────────────────────────────

interface RoleEditorModalProps {
  role: Role | null; // null = creating
  onClose: () => void;
  onSaved: () => void;
}

function RoleEditorModal({ role, onClose, onSaved }: RoleEditorModalProps) {
  const isCreate = !role;
  const [form, setForm] = useState({
    name: role?.name ?? '',
    displayName: role?.displayName ?? '',
    description: role?.description ?? '',
    scope: role?.scope ?? 'COMPANY',
  });
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loadingPerms, setLoadingPerms] = useState(true);
  const [permError, setPermError] = useState<string | null>(null);

  // The set of permission IDs currently selected, kept as a Set for O(1) toggles.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(role?.rolePermissions?.map((rp) => rp.permission.id) ?? []),
  );

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [permFilter, setPermFilter] = useState('');

  // Load all permissions once when the modal opens.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingPerms(true);
      setPermError(null);
      try {
        const res = await fetch('/api/backend/permissions');
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(`HTTP ${res.status}: ${errJson?.message ?? 'Failed to load permissions'}`);
        }
        const json = await res.json();
        const list: Permission[] = Array.isArray(json.data?.data)
          ? json.data.data
          : Array.isArray(json.data)
          ? json.data
          : Array.isArray(json)
          ? json
          : [];
        if (!cancelled) setPermissions(list);
      } catch (e) {
        if (!cancelled) setPermError(e instanceof Error ? e.message : 'Failed to load permissions');
      } finally {
        if (!cancelled) setLoadingPerms(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Group permissions by module so the picker is navigable.
  const groupedPermissions = useMemo(() => {
    const filter = permFilter.trim().toLowerCase();
    const groups = new Map<string, Permission[]>();
    for (const p of permissions) {
      if (filter && !p.code.toLowerCase().includes(filter) && !p.description.toLowerCase().includes(filter)) {
        continue;
      }
      const key = p.module || 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    // Stable, alphabetic module ordering with permissions sorted by action.
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([module, perms]) => ({
        module,
        permissions: perms.slice().sort((a, b) => a.action.localeCompare(b.action)),
      }));
  }, [permissions, permFilter]);

  function togglePermission(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleModule(perms: Permission[], allSelected: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of perms) {
        if (allSelected) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!form.name.trim() || !form.displayName.trim()) {
      setSubmitError('Name and display name are required.');
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        displayName: form.displayName.trim(),
        description: form.description.trim() || undefined,
        scope: form.scope,
        permissionIds: Array.from(selected),
      };
      const url = isCreate ? '/api/backend/roles' : `/api/backend/roles/${role!.id}`;
      const method = isCreate ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          (Array.isArray(json?.message) && json.message.join(', ')) ||
          json?.message ||
          `HTTP ${res.status}`;
        throw new Error(message);
      }
      onSaved();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to save role');
    } finally {
      setSubmitting(false);
    }
  }

  const totalSelected = selected.size;
  const totalAvailable = permissions.length;

  return (
    <Modal
      open={true}
      onClose={() => (submitting ? undefined : onClose())}
      title={isCreate ? 'New Role' : `Edit Role — ${role!.displayName}`}
      subtitle={`${totalSelected} of ${totalAvailable} permissions selected`}
      size="xl"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Btn>
          <Btn type="submit" form="role-editor-form" variant="primary" loading={submitting}>
            {isCreate ? 'Create Role' : 'Save Changes'}
          </Btn>
        </>
      }
    >
      <form id="role-editor-form" onSubmit={onSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormInput
            label="Name (system identifier)"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            hint="e.g. PETROLEUM_MANAGER. Lowercase or SCREAMING_SNAKE_CASE recommended."
            disabled={!!role?.isSystem}
          />
          <FormInput
            label="Display Name"
            required
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            hint="Human-readable label shown in lists."
          />
          <FormTextarea
            label="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="sm:col-span-2"
            rows={2}
          />
          <FormSelect
            label="Scope"
            required
            value={form.scope}
            onChange={(e) => setForm({ ...form, scope: e.target.value as RoleScope })}
            options={SCOPE_OPTIONS}
            className="sm:col-span-2"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
            <h4 className="text-sm font-semibold text-slate-800">Permissions</h4>
            <input
              type="search"
              value={permFilter}
              onChange={(e) => setPermFilter(e.target.value)}
              placeholder="Filter (e.g. payroll, view, finance)…"
              className="aurora-input text-sm rounded-md px-3 py-1.5 max-w-xs"
            />
          </div>

          {permError ? (
            <div
              className="text-sm rounded-lg p-3 border"
              style={{
                color: 'var(--aurora-danger)',
                borderColor: 'var(--aurora-danger)',
                background: 'var(--aurora-danger-bg, #fef2f2)',
              }}
            >
              {permError}
            </div>
          ) : loadingPerms ? (
            <PageSpinner />
          ) : groupedPermissions.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">
              {permFilter ? 'No permissions match this filter.' : 'No permissions found.'}
            </p>
          ) : (
            <div className="space-y-3 max-h-[40vh] overflow-y-auto rounded-lg border border-slate-200 p-3">
              {groupedPermissions.map(({ module, permissions: perms }) => {
                const totalInGroup = perms.length;
                const selectedInGroup = perms.filter((p) => selected.has(p.id)).length;
                const allSelected = selectedInGroup === totalInGroup;
                return (
                  <div key={module} className="rounded-md border border-slate-100 p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">{module}</span>
                        <span className="text-xs text-slate-400">
                          {selectedInGroup}/{totalInGroup}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleModule(perms, allSelected)}
                        className="text-xs font-medium text-blue-600 hover:underline"
                      >
                        {allSelected ? 'Deselect all' : 'Select all'}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {perms.map((p) => {
                        const checked = selected.has(p.id);
                        return (
                          <label
                            key={p.id}
                            className={`flex items-start gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-slate-50 ${checked ? 'bg-blue-50' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePermission(p.id)}
                              className="mt-0.5 flex-shrink-0"
                            />
                            <span className="min-w-0">
                              <span className="block text-xs font-mono text-slate-800 break-all">
                                {p.code}
                                {p.isGroupControl && (
                                  <span className="ml-2 text-[10px] uppercase tracking-wide px-1 py-0.5 rounded bg-purple-100 text-purple-700 align-middle">
                                    Group Control
                                  </span>
                                )}
                              </span>
                              <span className="block text-xs text-slate-500">{p.description}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {submitError && (
          <div
            role="alert"
            className="text-sm rounded-lg p-3 border"
            style={{
              color: 'var(--aurora-danger)',
              borderColor: 'var(--aurora-danger)',
              background: 'var(--aurora-danger-bg, #fef2f2)',
            }}
          >
            {submitError}
          </div>
        )}
      </form>
    </Modal>
  );
}
