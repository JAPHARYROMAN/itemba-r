'use client';

import { useEffect, useState, useCallback } from 'react';
import { PageHeader, Card } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { unwrapList } from '@/lib/unwrap';
import { RolesModal } from './_components/RolesModal';

// ── Types ──────────────────────────────────────────────────────────────────────

interface UserRoleAssignment {
  role: { id: string; name: string; displayName: string; scope: string };
  assignedAt: string;
  assignedById: string | null;
}

interface User {
  id: string;
  email: string;
  fullName: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  companyId: string | null;
  createdAt: string;
  updatedAt: string;
  userRoles?: UserRoleAssignment[];
}

interface Company {
  id: string;
  name: string;
  code: string;
}

interface Role {
  id: string;
  name: string;
  displayName: string;
  scope: string;
  description?: string | null;
}

// ── Status badge ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
  SUSPENDED: 'bg-amber-100 text-amber-700',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {status}
    </span>
  );
}

// ── Create / Edit Modal ────────────────────────────────────────────────────────

interface UserFormData {
  fullName: string;
  email: string;
  password: string;
  companyId: string;
  status: string;
}

const EMPTY_FORM: UserFormData = { fullName: '', email: '', password: '', companyId: '', status: 'ACTIVE' };

function UserModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: User;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<UserFormData>(
    initial
      ? { fullName: initial.fullName, email: initial.email, password: '', companyId: initial.companyId ?? '', status: initial.status }
      : EMPTY_FORM,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof UserFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        fullName: form.fullName,
        email: form.email,
        companyId: form.companyId || undefined,
      };
      if (form.password) body.password = form.password;
      if (mode === 'edit') body.status = form.status;

      const res = await fetch(
        mode === 'create' ? '/api/backend/users' : `/api/backend/users/${initial!.id}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? `Error ${res.status}`);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">
            {mode === 'create' ? 'Add User' : 'Edit User'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Full Name *</label>
            <input
              required value={form.fullName} onChange={set('fullName')}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="John Doe"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Email *</label>
            <input
              required type="email" value={form.email} onChange={set('email')}
              disabled={mode === 'edit'}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
              placeholder="user@itemba.local"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Password {mode === 'create' ? '*' : '(leave blank to keep current)'}
            </label>
            <input
              required={mode === 'create'} type="password" value={form.password} onChange={set('password')}
              minLength={8}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Min. 8 characters"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Company</label>
            <select
              value={form.companyId} onChange={set('companyId')}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">— Group-level / No company —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </select>
          </div>

          {mode === 'edit' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
              <select
                value={form.status} onChange={set('status')}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
                <option value="SUSPENDED">SUSPENDED</option>
              </select>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors">
              Cancel
            </button>
            <button
              type="submit" disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {saving ? 'Saving…' : mode === 'create' ? 'Create User' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const { hasPermission } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; user?: User } | null>(null);
  const [rolesModalUser, setRolesModalUser] = useState<User | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/backend/users');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setUsers(unwrapList(json));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCompanies = useCallback(async () => {
    try {
      const res = await fetch('/api/backend/companies?limit=100');
      if (!res.ok) return;
      const json = await res.json();
      setCompanies(unwrapList(json));
    } catch {/* non-fatal */}
  }, []);

  const fetchRoles = useCallback(async () => {
    try {
      const res = await fetch('/api/backend/roles?limit=200');
      if (!res.ok) return;
      const json = await res.json();
      setRoles(unwrapList(json));
    } catch {/* non-fatal */}
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchCompanies();
    if (hasPermission('users.assign_roles')) {
      fetchRoles();
    }
  }, [fetchUsers, fetchCompanies, fetchRoles, hasPermission]);

  // Client-side filter — name/email search runs in render below.
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  };

  const companyName = (id: string | null) =>
    id ? (companies.find((c) => c.id === id)?.name ?? id.slice(0, 8) + '…') : '—';

  const filtered = users.filter((u) => {
    const matchSearch =
      !search ||
      u.fullName.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || u.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalActive = users.filter((u) => u.status === 'ACTIVE').length;
  const totalInactive = users.filter((u) => u.status !== 'ACTIVE').length;

  return (
    <>
      {modal && (
        <UserModal
          mode={modal.mode}
          initial={modal.user}
          companies={companies}
          onClose={() => setModal(null)}
          onSaved={fetchUsers}
        />
      )}

      {rolesModalUser && (
        <RolesModal
          user={rolesModalUser}
          allRoles={roles}
          onClose={() => setRolesModalUser(null)}
          onSaved={fetchUsers}
        />
      )}

      <main className="p-6 flex-1 bg-slate-50 min-h-screen">
        <PageHeader
          title="Users"
          description="All people with access to ITEMBA-R."
          action={
            hasPermission('users.create') ? (
              <button
                onClick={() => setModal({ mode: 'create' })}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                + Add User
              </button>
            ) : null
          }
        />

        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <Card className="p-4">
            <div className="text-sm text-slate-500">Total Users</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{users.length}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-slate-500">Active</div>
            <div className="text-2xl font-bold text-green-700 mt-1">{totalActive}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-slate-500">Inactive / Suspended</div>
            <div className="text-2xl font-bold text-slate-500 mt-1">{totalInactive}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-slate-500">Companies</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{companies.length}</div>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-5">
          <input
            type="text"
            value={search}
            onChange={handleSearchChange}
            placeholder="Search by name or email…"
            className="flex-1 min-w-[200px] max-w-sm px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </div>

        {/* Table */}
        <Card className="overflow-hidden">
          {loading && (
            <div className="divide-y divide-slate-100">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4 animate-pulse">
                  <div className="h-9 w-9 rounded-full bg-slate-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-slate-200 rounded w-1/3" />
                    <div className="h-3 bg-slate-100 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="p-6 text-sm text-red-600">⚠ {error}</div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="p-10 text-center text-slate-400 text-sm">
              {search || statusFilter ? 'No users match the current filters.' : 'No users found.'}
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">User</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Company</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Roles</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Created</th>
                    {(hasPermission('users.update') ||
                      hasPermission('users.delete') ||
                      hasPermission('users.assign_roles')) && (
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      companyName={companyName(user.companyId)}
                      canEdit={hasPermission('users.update')}
                      canDelete={hasPermission('users.delete')}
                      canAssignRoles={hasPermission('users.assign_roles')}
                      onEdit={() => setModal({ mode: 'edit', user })}
                      onManageRoles={() => setRolesModalUser(user)}
                      onDeleted={fetchUsers}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {!loading && filtered.length > 0 && (
          <div className="mt-3 text-xs text-slate-400 text-right">
            Showing {filtered.length} of {users.length} users
          </div>
        )}
      </main>
    </>
  );
}

// ── User Row ───────────────────────────────────────────────────────────────────

function UserRow({
  user,
  companyName,
  canEdit,
  canDelete,
  canAssignRoles,
  onEdit,
  onManageRoles,
  onDeleted,
}: {
  user: User;
  companyName: string;
  canEdit: boolean;
  canDelete: boolean;
  canAssignRoles: boolean;
  onEdit: () => void;
  onManageRoles: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const initials = user.fullName
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const roleNames = (user.userRoles ?? []).map((ur) => ur.role.displayName);

  const handleDelete = async () => {
    if (
      !confirm(
        `Deactivate user "${user.fullName}" (${user.email})? This sets status to INACTIVE and revokes their refresh tokens. Audit history is preserved.`,
      )
    )
      return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/backend/users/${user.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.message ?? 'Delete failed');
      } else {
        onDeleted();
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
            {initials}
          </div>
          <div>
            <div className="font-medium text-slate-900 leading-tight">{user.fullName}</div>
            <div className="text-xs text-slate-400 mt-0.5">{user.email}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5 text-sm text-slate-600">{companyName}</td>
      <td className="px-4 py-3.5 text-sm text-slate-600">
        {roleNames.length === 0 ? (
          <span className="text-xs italic text-slate-400">No roles</span>
        ) : (
          <div className="flex flex-wrap gap-1 max-w-xs">
            {roleNames.slice(0, 3).map((rn) => (
              <span
                key={rn}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-700"
              >
                {rn}
              </span>
            ))}
            {roleNames.length > 3 && (
              <span className="text-[11px] text-slate-400">
                +{roleNames.length - 3}
              </span>
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-3.5">
        <StatusBadge status={user.status} />
      </td>
      <td className="px-4 py-3.5 text-xs text-slate-400">
        {new Date(user.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
      </td>
      {(canEdit || canDelete || canAssignRoles) && (
        <td className="px-4 py-3.5 text-right">
          <div className="flex items-center justify-end gap-2">
            {canAssignRoles && (
              <button
                onClick={onManageRoles}
                className="text-xs px-3 py-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors font-medium"
              >
                Roles
              </button>
            )}
            {canEdit && (
              <button
                onClick={onEdit}
                className="text-xs px-3 py-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors font-medium"
              >
                Edit
              </button>
            )}
            {canDelete && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs px-3 py-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors font-medium disabled:opacity-50"
              >
                {deleting ? '…' : 'Remove'}
              </button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}
