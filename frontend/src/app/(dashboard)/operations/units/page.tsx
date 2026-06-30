'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card,
  PageHeader,
  StatCard,
  StatusBadge,
  SkeletonTable,
  EmptyState,
  Modal,
  ConfirmDialog,
  Btn,
  FormInput,
  FormSelect,
  FormTextarea,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import {
  backendDelete,
  backendList,
  backendPage,
  backendPatch,
  backendPost,
} from '@/lib/api-client';
import { rowsToCsv, downloadTextFile } from '@/lib/report-export';

interface Company {
  id: string;
  name: string;
  code: string;
}

interface Unit {
  id: string;
  name: string;
  symbol: string;
  unitType: string;
  isBaseUnit: boolean;
  isSystemUnit: boolean;
  status: string;
  companyId?: string | null;
  company?: { name: string } | null;
}

interface UnitConversion {
  id: string;
  fromUnitId: string;
  toUnitId: string;
  conversionFactor: number;
  description?: string | null;
  isActive: boolean;
  fromUnit?: { name: string; symbol: string } | null;
  toUnit?: { name: string; symbol: string } | null;
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

const UNIT_TYPES = [
  'PIECE',
  'VOLUME',
  'WEIGHT',
  'LENGTH',
  'AREA',
  'PACKAGE',
  'SERVICE',
  'TIME',
  'OTHER',
];

const TYPE_BADGE: Record<string, string> = {
  PIECE: 'bg-blue-50 text-blue-700 border-blue-200',
  VOLUME: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  WEIGHT: 'bg-amber-50 text-amber-700 border-amber-200',
  LENGTH: 'bg-purple-50 text-purple-700 border-purple-200',
  AREA: 'bg-pink-50 text-pink-700 border-pink-200',
  PACKAGE: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  SERVICE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  TIME: 'bg-slate-50 text-slate-700 border-slate-200',
  OTHER: 'bg-zinc-50 text-zinc-700 border-zinc-200',
};

interface UnitForm {
  name: string;
  symbol: string;
  unitType: string;
  companyId: string;
  isBaseUnit: boolean;
  status: string;
}
const BLANK_UNIT: UnitForm = {
  name: '',
  symbol: '',
  unitType: 'PIECE',
  companyId: '',
  isBaseUnit: false,
  status: 'ACTIVE',
};

function UnitModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Unit;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<UnitForm>(() =>
    initial
      ? {
          name: initial.name,
          symbol: initial.symbol,
          unitType: initial.unitType,
          companyId: initial.companyId ?? '',
          isBaseUnit: initial.isBaseUnit,
          status: initial.status ?? 'ACTIVE',
        }
      : { ...BLANK_UNIT },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof UnitForm>(k: K, v: UnitForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    if (!form.symbol.trim()) {
      setError('Symbol is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        symbol: form.symbol,
        unitType: form.unitType,
        isBaseUnit: form.isBaseUnit,
        status: form.status,
      };
      if (mode === 'create') {
        // Company (scope) is only assignable at creation; UpdateUnitDto ignores it.
        if (form.companyId) body.companyId = form.companyId;
        await backendPost('/units', body);
      } else {
        await backendPatch(`/units/${initial!.id}`, body);
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
      title={mode === 'create' ? 'Create Unit' : 'Edit Unit'}
      size="md"
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
        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="Name"
            required
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
          <FormInput
            label="Symbol"
            required
            value={form.symbol}
            onChange={(e) => set('symbol', e.target.value)}
          />
        </div>
        <FormSelect
          label="Unit Type"
          required
          value={form.unitType}
          onChange={(e) => set('unitType', e.target.value)}
        >
          {UNIT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </FormSelect>
        {mode === 'create' && (
          <FormSelect
            label="Company (optional)"
            value={form.companyId}
            onChange={(e) => set('companyId', e.target.value)}
            placeholder="System unit (no company)"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </FormSelect>
        )}
        <FormSelect
          label="Status"
          required
          value={form.status}
          onChange={(e) => set('status', e.target.value)}
        >
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </FormSelect>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--aurora-text)' }}>
          <input
            type="checkbox"
            checked={form.isBaseUnit}
            onChange={(e) => set('isBaseUnit', e.target.checked)}
            className="rounded"
          />
          Base unit
        </label>
      </div>
    </Modal>
  );
}

interface ConversionForm {
  fromUnitId: string;
  toUnitId: string;
  conversionFactor: string;
  description: string;
  isActive: boolean;
}
const BLANK_CONV: ConversionForm = {
  fromUnitId: '',
  toUnitId: '',
  conversionFactor: '1',
  description: '',
  isActive: true,
};

function ConversionModal({
  mode,
  initial,
  allUnits,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: UnitConversion;
  allUnits: Unit[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ConversionForm>(() =>
    initial
      ? {
          fromUnitId: initial.fromUnitId,
          toUnitId: initial.toUnitId,
          conversionFactor: String(initial.conversionFactor),
          description: initial.description ?? '',
          isActive: initial.isActive,
        }
      : { ...BLANK_CONV },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof ConversionForm>(k: K, v: ConversionForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Only ACTIVE units can be picked; in edit mode keep the already-selected
  // units even if they have since been deactivated, so the form stays valid.
  const selectableUnits = useMemo(() => {
    const active = allUnits.filter((u) => u.status === 'ACTIVE');
    if (mode === 'edit' && initial) {
      const ids = new Set(active.map((u) => u.id));
      for (const id of [initial.fromUnitId, initial.toUnitId]) {
        if (!ids.has(id)) {
          const u = allUnits.find((x) => x.id === id);
          if (u) active.push(u);
        }
      }
    }
    return active;
  }, [allUnits, mode, initial]);

  // Live preview: "1 <from> = <factor> <to>" using whatever is currently typed.
  const preview = useMemo(() => {
    const from = selectableUnits.find((u) => u.id === form.fromUnitId);
    const to = selectableUnits.find((u) => u.id === form.toUnitId);
    const factor = Number(form.conversionFactor);
    if (!from || !to || !Number.isFinite(factor) || factor <= 0) return null;
    return `1 ${from.symbol} = ${factor} ${to.symbol}`;
  }, [selectableUnits, form.fromUnitId, form.toUnitId, form.conversionFactor]);

  const handleSubmit = async () => {
    if (!form.fromUnitId || !form.toUnitId) {
      setError('Both units required');
      return;
    }
    if (form.fromUnitId === form.toUnitId) {
      setError('Units must differ');
      return;
    }
    const factor = Number(form.conversionFactor);
    if (!factor || factor <= 0) {
      setError('Factor must be > 0');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        fromUnitId: form.fromUnitId,
        toUnitId: form.toUnitId,
        conversionFactor: factor,
        isActive: form.isActive,
      };
      if (form.description) body.description = form.description;
      if (mode === 'create') {
        await backendPost('/unit-conversions', body);
      } else {
        await backendPatch(`/unit-conversions/${initial!.id}`, body);
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
      title={mode === 'create' ? 'Create Conversion' : 'Edit Conversion'}
      size="md"
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
          label="From Unit"
          required
          value={form.fromUnitId}
          onChange={(e) => set('fromUnitId', e.target.value)}
          placeholder="Select unit"
        >
          {selectableUnits.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.symbol})
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="To Unit"
          required
          value={form.toUnitId}
          onChange={(e) => set('toUnitId', e.target.value)}
          placeholder="Select unit"
        >
          {selectableUnits.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.symbol})
            </option>
          ))}
        </FormSelect>
        <FormInput
          label="Conversion Factor"
          required
          type="number"
          step="0.0001"
          value={form.conversionFactor}
          onChange={(e) => set('conversionFactor', e.target.value)}
        />
        <div
          aria-live="polite"
          className="rounded-lg border px-3 py-2 text-sm font-mono"
          style={{
            borderColor: 'var(--aurora-border)',
            color: 'var(--aurora-text-muted)',
          }}
        >
          {preview ?? 'Select both units and a factor to preview the conversion'}
        </div>
        <FormTextarea
          label="Description"
          rows={2}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
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

export default function UnitsPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [allUnits, setAllUnits] = useState<Unit[]>([]);
  const [units, setUnits] = useState<Paginated<Unit> | null>(null);
  const [conversions, setConversions] = useState<Paginated<UnitConversion> | null>(null);
  const [unitsLoading, setUnitsLoading] = useState(true);
  const [convLoading, setConvLoading] = useState(true);
  const [error, setError] = useState('');
  const [unitsPage, setUnitsPage] = useState(1);
  const [convPage, setConvPage] = useState(1);

  const [creatingUnit, setCreatingUnit] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [creatingConv, setCreatingConv] = useState(false);
  const [editingConv, setEditingConv] = useState<UnitConversion | null>(null);
  const [deletingUnit, setDeletingUnit] = useState<Unit | null>(null);
  const [deletingConv, setDeletingConv] = useState<UnitConversion | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const canView = hasPermission('units.view');
  const canCreate = hasPermission('units.manage');

  const companyNameById = useMemo(
    () => new Map(companies.map((c) => [c.id, c.name])),
    [companies],
  );

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;

    async function loadLookups() {
      const [companyResult, unitResult] = await Promise.allSettled([
        backendList<Company>('/companies', { query: { limit: 100 } }),
        backendList<Unit>('/units', { query: { limit: 500 } }),
      ]);
      if (cancelled) return;
      setCompanies(companyResult.status === 'fulfilled' ? companyResult.value : []);
      setAllUnits(unitResult.status === 'fulfilled' ? unitResult.value : []);
    }

    void loadLookups();

    return () => {
      cancelled = true;
    };
  }, [canView]);

  const loadUnits = useCallback(async () => {
    if (!canView) return;
    setUnitsLoading(true);
    setError('');
    try {
      const result = await backendPage<Unit>('/units', { query: { page: unitsPage, limit: 20 } });
      setUnits(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load units');
      setUnits(emptyPaginated<Unit>(unitsPage));
    } finally {
      setUnitsLoading(false);
    }
  }, [canView, unitsPage]);

  const loadConversions = useCallback(async () => {
    if (!canView) return;
    setConvLoading(true);
    setError('');
    try {
      const result = await backendPage<UnitConversion>('/unit-conversions', {
        query: { page: convPage, limit: 20 },
      });
      setConversions(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load unit conversions');
      setConversions(emptyPaginated<UnitConversion>(convPage));
    } finally {
      setConvLoading(false);
    }
  }, [canView, convPage]);

  useEffect(() => {
    loadUnits();
  }, [loadUnits]);
  useEffect(() => {
    loadConversions();
  }, [loadConversions]);

  const refreshAll = () => {
    loadUnits();
    loadConversions();
    backendList<Unit>('/units', { query: { limit: 500 } })
      .then(setAllUnits)
      .catch(() => setAllUnits([]));
  };

  const handleDeleteUnit = async () => {
    if (!deletingUnit) return;
    setDeleteBusy(true);
    setError('');
    try {
      await backendDelete(`/units/${deletingUnit.id}`);
      setDeletingUnit(null);
      refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete unit');
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleDeleteConv = async () => {
    if (!deletingConv) return;
    setDeleteBusy(true);
    setError('');
    try {
      await backendDelete(`/unit-conversions/${deletingConv.id}`);
      setDeletingConv(null);
      loadConversions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete conversion');
    } finally {
      setDeleteBusy(false);
    }
  };

  const exportUnits = () => {
    const rows = (units?.data ?? []).map((u) => ({
      Name: u.name,
      Symbol: u.symbol,
      Type: u.unitType,
      Scope: u.isSystemUnit
        ? 'System'
        : u.companyId
          ? (companyNameById.get(u.companyId) ?? '')
          : '',
      Base: u.isBaseUnit ? 'Yes' : 'No',
      Status: u.status,
    }));
    downloadTextFile('units.csv', 'text/csv', rowsToCsv(rows));
  };

  const exportConversions = () => {
    const rows = (conversions?.data ?? []).map((c) => ({
      From: `${c.fromUnit?.name ?? ''} (${c.fromUnit?.symbol ?? ''})`,
      To: `${c.toUnit?.name ?? ''} (${c.toUnit?.symbol ?? ''})`,
      Factor: c.conversionFactor,
      Description: c.description ?? '',
      Status: c.isActive ? 'ACTIVE' : 'INACTIVE',
    }));
    downloadTextFile('unit-conversions.csv', 'text/csv', rowsToCsv(rows));
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Units" subtitle="Units of measure" />
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">Access Restricted</p>
        </div>
      </div>
    );
  }

  const activeUnits = units?.data.filter((u) => u.status === 'ACTIVE').length ?? 0;

  return (
    <div className="p-6 space-y-6">
      {creatingUnit && (
        <UnitModal
          mode="create"
          companies={companies}
          onClose={() => setCreatingUnit(false)}
          onSaved={() => {
            setCreatingUnit(false);
            refreshAll();
          }}
        />
      )}
      {editingUnit && (
        <UnitModal
          mode="edit"
          initial={editingUnit}
          companies={companies}
          onClose={() => setEditingUnit(null)}
          onSaved={() => {
            setEditingUnit(null);
            refreshAll();
          }}
        />
      )}
      {creatingConv && (
        <ConversionModal
          mode="create"
          allUnits={allUnits}
          onClose={() => setCreatingConv(false)}
          onSaved={() => {
            setCreatingConv(false);
            loadConversions();
          }}
        />
      )}
      {editingConv && (
        <ConversionModal
          mode="edit"
          initial={editingConv}
          allUnits={allUnits}
          onClose={() => setEditingConv(null)}
          onSaved={() => {
            setEditingConv(null);
            loadConversions();
          }}
        />
      )}
      {deletingUnit && (
        <ConfirmDialog
          open
          variant="danger"
          title="Delete unit"
          message={`Delete "${deletingUnit.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          loading={deleteBusy}
          onConfirm={handleDeleteUnit}
          onClose={() => setDeletingUnit(null)}
        />
      )}
      {deletingConv && (
        <ConfirmDialog
          open
          variant="danger"
          title="Delete conversion"
          message={`Delete the conversion ${deletingConv.fromUnit?.symbol ?? ''} → ${deletingConv.toUnit?.symbol ?? ''}? This cannot be undone.`}
          confirmLabel="Delete"
          loading={deleteBusy}
          onConfirm={handleDeleteConv}
          onClose={() => setDeletingConv(null)}
        />
      )}

      <PageHeader
        title="Units of Measure"
        subtitle="Standardize measurement units and conversions"
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Total Units" value={units?.total ?? 0} />
        <StatCard label="Active Units (page)" value={activeUnits} />
        <StatCard label="Conversions" value={conversions?.total ?? 0} />
      </div>

      {/* Units section */}
      <Card className="overflow-hidden">
        <div
          className="px-5 py-3 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--aurora-border)' }}
        >
          <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Units
          </div>
          <div className="flex items-center gap-2">
            <Btn
              variant="secondary"
              size="sm"
              onClick={exportUnits}
              disabled={!units?.data.length}
            >
              Export CSV
            </Btn>
            {canCreate && (
              <Btn variant="primary" size="sm" onClick={() => setCreatingUnit(true)}>
                + New Unit
              </Btn>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <caption className="sr-only">Units of measure</caption>
            <thead>
              <tr
                className="text-left text-xs uppercase bg-gray-50"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th scope="col" className="px-4 py-3">Name</th>
                <th scope="col" className="px-4 py-3">Symbol</th>
                <th scope="col" className="px-4 py-3">Type</th>
                <th scope="col" className="px-4 py-3">Scope</th>
                <th scope="col" className="px-4 py-3">Base</th>
                {canCreate && (
                  <th scope="col" className="px-4 py-3 text-right">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {unitsLoading ? (
                <tr>
                  <td colSpan={6} className="p-4">
                    <SkeletonTable rows={5} cols={canCreate ? 6 : 5} />
                  </td>
                </tr>
              ) : !units?.data.length ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      title="No units found"
                      description="Create a unit of measure to get started."
                    />
                  </td>
                </tr>
              ) : (
                units.data.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{u.symbol}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${TYPE_BADGE[u.unitType] ?? 'bg-zinc-50 text-zinc-700 border-zinc-200'}`}
                      >
                        {u.unitType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                      {u.isSystemUnit
                        ? 'System'
                        : u.companyId
                          ? (companyNameById.get(u.companyId) ?? '—')
                          : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">{u.isBaseUnit ? 'Yes' : '—'}</td>
                    {canCreate && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {!u.isSystemUnit && (
                          <>
                            <Btn
                              variant="ghost"
                              size="xs"
                              aria-label={`Edit ${u.name}`}
                              onClick={() => setEditingUnit(u)}
                            >
                              Edit
                            </Btn>
                            <Btn
                              variant="ghost"
                              size="xs"
                              aria-label={`Delete ${u.name}`}
                              onClick={() => setDeletingUnit(u)}
                            >
                              Delete
                            </Btn>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {units && units.totalPages > 1 && (
          <div
            className="px-5 py-3 border-t flex items-center justify-between"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Page {units.page} of {units.totalPages}
            </span>
            <div className="flex gap-2">
              <Btn
                variant="secondary"
                size="xs"
                disabled={unitsPage <= 1}
                onClick={() => setUnitsPage((p) => p - 1)}
              >
                Previous
              </Btn>
              <Btn
                variant="secondary"
                size="xs"
                disabled={unitsPage >= units.totalPages}
                onClick={() => setUnitsPage((p) => p + 1)}
              >
                Next
              </Btn>
            </div>
          </div>
        )}
      </Card>

      {/* Conversions section */}
      <Card className="overflow-hidden">
        <div
          className="px-5 py-3 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--aurora-border)' }}
        >
          <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Unit Conversions
          </div>
          <div className="flex items-center gap-2">
            <Btn
              variant="secondary"
              size="sm"
              onClick={exportConversions}
              disabled={!conversions?.data.length}
            >
              Export CSV
            </Btn>
            {canCreate && (
              <Btn variant="primary" size="sm" onClick={() => setCreatingConv(true)}>
                + New Conversion
              </Btn>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <caption className="sr-only">Unit conversions</caption>
            <thead>
              <tr
                className="text-left text-xs uppercase bg-gray-50"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th scope="col" className="px-4 py-3">From</th>
                <th scope="col" className="px-4 py-3">To</th>
                <th scope="col" className="px-4 py-3 text-right">Factor</th>
                <th scope="col" className="px-4 py-3">Description</th>
                <th scope="col" className="px-4 py-3">Status</th>
                {canCreate && (
                  <th scope="col" className="px-4 py-3 text-right">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {convLoading ? (
                <tr>
                  <td colSpan={6} className="p-4">
                    <SkeletonTable rows={5} cols={canCreate ? 6 : 5} />
                  </td>
                </tr>
              ) : !conversions?.data.length ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      title="No conversions found"
                      description="Define a conversion between two units to get started."
                    />
                  </td>
                </tr>
              ) : (
                conversions.data.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      {c.fromUnit?.name ?? '—'}{' '}
                      <span
                        className="font-mono text-xs"
                        style={{ color: 'var(--aurora-text-muted)' }}
                      >
                        ({c.fromUnit?.symbol ?? ''})
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {c.toUnit?.name ?? '—'}{' '}
                      <span
                        className="font-mono text-xs"
                        style={{ color: 'var(--aurora-text-muted)' }}
                      >
                        ({c.toUnit?.symbol ?? ''})
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.conversionFactor}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                      {c.description ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.isActive ? 'ACTIVE' : 'INACTIVE'} />
                    </td>
                    {canCreate && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {(() => {
                          const convLabel = `${c.fromUnit?.symbol ?? ''} to ${c.toUnit?.symbol ?? ''} conversion`;
                          return (
                            <>
                              <Btn
                                variant="ghost"
                                size="xs"
                                aria-label={`Edit ${convLabel}`}
                                onClick={() => setEditingConv(c)}
                              >
                                Edit
                              </Btn>
                              <Btn
                                variant="ghost"
                                size="xs"
                                aria-label={`Delete ${convLabel}`}
                                onClick={() => setDeletingConv(c)}
                              >
                                Delete
                              </Btn>
                            </>
                          );
                        })()}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {conversions && conversions.totalPages > 1 && (
          <div
            className="px-5 py-3 border-t flex items-center justify-between"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Page {conversions.page} of {conversions.totalPages}
            </span>
            <div className="flex gap-2">
              <Btn
                variant="secondary"
                size="xs"
                disabled={convPage <= 1}
                onClick={() => setConvPage((p) => p - 1)}
              >
                Previous
              </Btn>
              <Btn
                variant="secondary"
                size="xs"
                disabled={convPage >= conversions.totalPages}
                onClick={() => setConvPage((p) => p + 1)}
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
