'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Card,
  PageHeader,
  PageToolbar,
  StatCard,
  Modal,
  Btn,
  PageSpinner,
  FormInput,
  FormSelect,
  FormTextarea,
  ConfirmDialog,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendDelete, backendList, backendPage, backendPatch, backendPost } from '@/lib/api-client';

interface Company {
  id: string;
  name: string;
  code: string;
}

interface InventoryLocation {
  id: string;
  locationCode: string;
  name: string;
  locationType: string;
  address?: string | null;
  isActive: boolean;
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  company?: { name: string } | null;
  createdAt?: string;
}

interface LocationForm {
  companyId: string;
  locationCode: string;
  name: string;
  locationType: string;
  address: string;
  isActive: boolean;
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

function emptyPaginated<T>(page = 1): Paginated<T> {
  return { data: [], total: 0, page, totalPages: 1 };
}

const LOCATION_TYPES = [
  'STORE',
  'WAREHOUSE',
  'SHOP_FLOOR',
  'FUEL_TANK',
  'FARM_STORE',
  'CONSTRUCTION_SITE',
  'VEHICLE',
  'PROJECT_SITE',
  'OTHER',
];

const TYPE_BADGE: Record<string, string> = {
  STORE: 'bg-blue-50 text-blue-700 border-blue-200',
  WAREHOUSE: 'bg-purple-50 text-purple-700 border-purple-200',
  SHOP_FLOOR: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  FUEL_TANK: 'bg-amber-50 text-amber-700 border-amber-200',
  FARM_STORE: 'bg-lime-50 text-lime-700 border-lime-200',
  CONSTRUCTION_SITE: 'bg-orange-50 text-orange-700 border-orange-200',
  VEHICLE: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  PROJECT_SITE: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  OTHER: 'bg-zinc-50 text-zinc-700 border-zinc-200',
};

const BLANK_FORM: LocationForm = {
  companyId: '',
  locationCode: '',
  name: '',
  locationType: 'STORE',
  address: '',
  isActive: true,
};

function LocationModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: InventoryLocation;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<LocationForm>(() =>
    initial
      ? {
          companyId: initial.companyId,
          locationCode: initial.locationCode,
          name: initial.name,
          locationType: initial.locationType,
          address: initial.address ?? '',
          isActive: initial.isActive,
        }
      : { ...BLANK_FORM },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof LocationForm>(k: K, v: LocationForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.companyId) {
      setError('Company is required');
      return;
    }
    if (!form.locationCode.trim()) {
      setError('Location code is required');
      return;
    }
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = { ...form, address: form.address || undefined };
      if (mode === 'create') {
        await backendPost('/inventory-locations', body);
      } else {
        await backendPatch(`/inventory-locations/${initial!.id}`, body);
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'Create Location' : 'Edit Location'}
      size="lg"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={saving}>
            {mode === 'create' ? 'Create' : 'Save Changes'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="space-y-3">
        <FormSelect
          label="Company"
          required
          value={form.companyId}
          onChange={(e) => set('companyId', e.target.value)}
          placeholder="Select company"
          disabled={mode === 'edit'}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </FormSelect>
        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="Location Code"
            required
            value={form.locationCode}
            onChange={(e) => set('locationCode', e.target.value)}
          />
          <FormSelect
            label="Type"
            required
            value={form.locationType}
            onChange={(e) => set('locationType', e.target.value)}
          >
            {LOCATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </FormSelect>
        </div>
        <FormInput
          label="Name"
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
        />
        <FormTextarea
          label="Address"
          rows={2}
          value={form.address}
          onChange={(e) => set('address', e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--aurora-text)' }}>
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
            className="rounded"
          />
          Active
        </label>
      </div>
    </Modal>
  );
}

export default function InventoryLocationsPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<InventoryLocation> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [locationType, setLocationType] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<InventoryLocation | null>(null);
  const [deleting, setDeleting] = useState<InventoryLocation | null>(null);

  const canView = hasPermission('inventory.view');
  const canManage = hasPermission('inventory.manage');

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;

    async function loadCompanies() {
      try {
        const records = await backendList<Company>('/companies', { query: { limit: 100 } });
        if (!cancelled) setCompanies(records);
      } catch {
        if (!cancelled) setCompanies([]);
      }
    }

    void loadCompanies();

    return () => {
      cancelled = true;
    };
  }, [canView]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const result = await backendPage<InventoryLocation>('/inventory-locations', {
        query: {
          page,
          limit: 20,
          search: search.trim() || undefined,
          companyId: companyId || undefined,
          locationType: locationType || undefined,
          isActive: activeFilter || undefined,
        },
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inventory locations');
      setData(emptyPaginated<InventoryLocation>(page));
    } finally {
      setLoading(false);
    }
  }, [canView, page, search, companyId, locationType, activeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async () => {
    if (!deleting) return;
    setError('');
    try {
      await backendDelete(`/inventory-locations/${deleting.id}`);
      setDeleting(null);
      if (data?.data.length === 1 && page > 1) {
        setPage((p) => p - 1);
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete inventory location');
    }
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Inventory Locations" subtitle="Manage locations" />
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">Access Restricted</p>
        </div>
      </div>
    );
  }

  const filterSelectCls =
    'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = {
    borderColor: 'var(--aurora-border)',
    background: 'var(--aurora-card)',
    color: 'var(--aurora-text)',
  } as const;

  const warehouses = data?.data.filter((l) => l.locationType === 'WAREHOUSE').length ?? 0;
  const stores = data?.data.filter((l) => l.locationType === 'STORE').length ?? 0;
  const active = data?.data.filter((l) => l.isActive).length ?? 0;

  return (
    <div className="p-6 space-y-6">
      {creating && (
        <LocationModal
          mode="create"
          companies={companies}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {editing && (
        <LocationModal
          mode="edit"
          initial={editing}
          companies={companies}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete Location"
        message={`Delete "${deleting?.name ?? 'this inventory location'}"? This hides it from inventory workflows but keeps its audit history.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />

      <PageHeader title="Inventory Locations" subtitle="Stores, warehouses, and storage points" />

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total Locations" value={data?.total ?? 0} />
        <StatCard label="Active" value={active} />
        <StatCard label="Warehouses" value={warehouses} />
        <StatCard label="Stores" value={stores} />
      </div>

      <PageToolbar
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search code or name…"
        filters={
          <>
            <select
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={locationType}
              onChange={(e) => {
                setLocationType(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Types</option>
              {LOCATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <select
              value={activeFilter}
              onChange={(e) => {
                setActiveFilter(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Status</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </>
        }
        actions={
          canManage ? (
            <Btn variant="primary" onClick={() => setCreating(true)}>
              + New Location
            </Btn>
          ) : null
        }
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr
                className="text-left text-xs uppercase bg-gray-50"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7}>
                    <PageSpinner />
                  </td>
                </tr>
              ) : !data?.data.length ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    No locations found
                  </td>
                </tr>
              ) : (
                data.data.map((loc) => (
                  <tr key={loc.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">{loc.locationCode}</td>
                    <td className="px-4 py-3 font-medium">{loc.name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${TYPE_BADGE[loc.locationType] ?? 'bg-zinc-50 text-zinc-700 border-zinc-200'}`}
                      >
                        {loc.locationType.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">{loc.company?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                      {loc.address ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${loc.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-zinc-100 text-zinc-500 border-zinc-200'}`}
                      >
                        {loc.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Btn variant="ghost" size="xs" onClick={() => setEditing(loc)}>
                            Edit
                          </Btn>
                          <Btn variant="danger" size="xs" onClick={() => setDeleting(loc)}>
                            Delete
                          </Btn>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {data && data.totalPages > 1 && (
          <div
            className="px-5 py-3 border-t flex items-center justify-between"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Page {data.page} of {data.totalPages} · {data.total} total
            </span>
            <div className="flex gap-2">
              <Btn
                variant="secondary"
                size="xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Btn>
              <Btn
                variant="secondary"
                size="xs"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
