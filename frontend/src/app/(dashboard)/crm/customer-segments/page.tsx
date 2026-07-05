'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageSpinner, PageToolbar, Modal, ConfirmDialog, Btn, FormInput, FormSelect, FormTextarea, showToast } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { ApiError, backendGet, backendPost, backendPut, backendDelete } from '@/lib/api-client';

interface Company { id: string; name: string }

interface CustomerOption { id: string; customerCode: string; name: string }

interface Membership { id: string; customerId: string; assignedAt?: string }

interface Segment {
  id: string;
  companyId: string;
  segmentCode: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  memberships?: Membership[];
}

interface SegmentForm { companyId: string; segmentCode: string; name: string; description: string; isActive: string }
const BLANK: SegmentForm = { companyId: '', segmentCode: '', name: '', description: '', isActive: 'true' };

function errMsg(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Request failed';
}

function SegmentModal({ mode, initial, companies, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: Segment; companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<SegmentForm>(() => initial ? {
    companyId: initial.companyId,
    segmentCode: initial.segmentCode,
    name: initial.name,
    description: initial.description ?? '',
    isActive: initial.isActive ? 'true' : 'false',
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof SegmentForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (mode === 'create' && !form.companyId) { setError('Company is required'); return; }
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        isActive: form.isActive === 'true',
      };
      if (mode === 'create') {
        body.companyId = form.companyId;
        if (form.segmentCode.trim()) body.segmentCode = form.segmentCode.trim();
        await backendPost('/customer-segments', body);
      } else {
        if (form.segmentCode.trim()) body.segmentCode = form.segmentCode.trim();
        await backendPut(`/customer-segments/${initial!.id}`, body);
      }
      onSaved();
    } catch (err) { setError(errMsg(err)); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Segment' : 'Edit Segment'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        {mode === 'create' ? (
          <FormSelect label="Company" required value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Select…">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FormSelect>
        ) : (
          <FormInput label="Company" value={companies.find((c) => c.id === form.companyId)?.name ?? form.companyId} disabled />
        )}
        <FormInput label="Segment Code" value={form.segmentCode} onChange={(e) => set('segmentCode', e.target.value)}
          hint={mode === 'create' ? 'Leave blank to auto-generate' : undefined} />
        <div className="col-span-2"><FormInput label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div className="col-span-2"><FormTextarea label="Description" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
        <FormSelect label="Status" value={form.isActive} onChange={(e) => set('isActive', e.target.value)}>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </FormSelect>
      </div>
    </Modal>
  );
}

function MembersModal({ segment, onClose, onChanged }: { segment: Segment; onClose: () => void; onChanged: () => void }) {
  const [members, setMembers] = useState<Membership[]>(segment.memberships ?? []);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/backend/customers?companyId=${encodeURIComponent(segment.companyId)}&limit=500`)
      .then((r) => r.json())
      .then((j) => setCustomers(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []))
      .catch(() => setCustomers([]));
  }, [segment.companyId]);

  const refresh = async () => {
    try {
      const fresh = await backendGet<Segment>(`/customer-segments/${segment.id}`);
      setMembers(fresh.memberships ?? []);
    } catch { /* keep the current list; the mutation itself already succeeded */ }
    onChanged();
  };

  const addMember = async () => {
    if (!customerId) { setError('Select a customer to add'); return; }
    setAdding(true); setError('');
    try {
      await backendPost(`/customer-segments/${segment.id}/members`, { customerId });
      setCustomerId('');
      await refresh();
    } catch (err) { setError(errMsg(err)); } finally { setAdding(false); }
  };

  const removeMember = async (id: string) => {
    setRemovingId(id); setError('');
    try {
      await backendDelete(`/customer-segments/${segment.id}/members/${id}`);
      await refresh();
    } catch (err) { setError(errMsg(err)); } finally { setRemovingId(null); }
  };

  const memberIds = new Set(members.map((m) => m.customerId));
  const available = customers.filter((c) => !memberIds.has(c.id));
  const nameOf = (id: string) => {
    const c = customers.find((x) => x.id === id);
    return c ? `${c.name} (${c.customerCode})` : id;
  };

  return (
    <Modal open onClose={onClose} title="Manage Members" subtitle={`${segment.name} — ${segment.segmentCode}`} size="lg"
      footer={<Btn variant="secondary" onClick={onClose}>Close</Btn>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="flex items-end gap-2 mb-4">
        <FormSelect label="Add Customer" className="flex-1" value={customerId} onChange={(e) => setCustomerId(e.target.value)} placeholder="Select…">
          {available.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.customerCode})</option>)}
        </FormSelect>
        <Btn variant="primary" onClick={addMember} loading={adding} disabled={!customerId}>Add</Btn>
      </div>
      {members.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-400">No members in this segment</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Added</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.customerId} className="border-t border-gray-100">
                <td className="px-3 py-2">{nameOf(m.customerId)}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{m.assignedAt?.split('T')[0] ?? '—'}</td>
                <td className="px-3 py-2 text-right">
                  <Btn variant="ghost" size="xs" loading={removingId === m.customerId} onClick={() => removeMember(m.customerId)}>Remove</Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

export default function CustomerSegmentsPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('customer_segments.create');
  const canUpdate = hasPermission('customer_segments.update');
  const canDelete = hasPermission('customer_segments.delete');
  const canManageMembers = hasPermission('customer_segments.manage_members');
  const showActions = canUpdate || canDelete || canManageMembers;

  const [data, setData] = useState<Segment[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Segment | null>(null);
  const [deleting, setDeleting] = useState<Segment | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [managing, setManaging] = useState<Segment | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => setCompanies(j.data?.data ?? j.data ?? []))
      .catch(() => setCompanies([]));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/backend/customer-segments?limit=100')
      .then(r => r.json())
      .then(res => setData(Array.isArray(res.data?.items) ? res.data.items : Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSaved = () => { setCreating(false); setEditing(null); load(); };

  const doDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await backendDelete(`/customer-segments/${deleting.id}`);
      showToast('success', 'Segment deleted');
      setDeleting(null);
      load();
    } catch (err) { showToast('error', 'Delete failed', errMsg(err)); } finally { setDeleteBusy(false); }
  };

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Customer Segments</h1>
        <p className="text-gray-500 mt-1">Manage customer segmentation and classification</p>
      </div>

      {canCreate && (
        <PageToolbar actions={<Btn variant="primary" onClick={() => setCreating(true)}>+ New Segment</Btn>} />
      )}

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Segment Code</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Members</th>
                <th className="px-4 py-3">Active</th>
                {showActions && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={showActions ? 7 : 6} className="px-4 py-8 text-center text-gray-400">No records found</td></tr>
              ) : data.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.segmentCode}</td>
                  <td className="px-4 py-3">{companyName(row.companyId)}</td>
                  <td className="px-4 py-3 font-medium">{row.name}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-[250px] truncate">{row.description ?? '—'}</td>
                  <td className="px-4 py-3">{row.memberships?.length ?? 0}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {row.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {showActions && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {canManageMembers && <Btn variant="ghost" size="xs" onClick={() => setManaging(row)}>Members</Btn>}
                      {canUpdate && <Btn variant="ghost" size="xs" onClick={() => setEditing(row)}>Edit</Btn>}
                      {canDelete && <Btn variant="ghost" size="xs" onClick={() => setDeleting(row)}>Delete</Btn>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <SegmentModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <SegmentModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {managing && <MembersModal segment={managing} onClose={() => setManaging(null)} onChanged={load} />}
      <ConfirmDialog
        open={!!deleting}
        title="Delete Segment"
        message={deleting ? `Delete segment "${deleting.name}" (${deleting.segmentCode})? Its member assignments will be removed.` : ''}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteBusy}
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
