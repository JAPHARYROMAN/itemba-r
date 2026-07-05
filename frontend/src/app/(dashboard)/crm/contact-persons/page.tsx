'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageSpinner, PageToolbar, Modal, ConfirmDialog, Btn, FormInput, FormSelect, FormTextarea, showToast } from '@/components/ui';
import { backendPost, backendPut, backendDelete, ApiError } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string }
interface EntityOption { id: string; name: string }

interface ContactPerson {
  id: string;
  companyId: string;
  entityType: string;
  entityId: string;
  fullName: string;
  position?: string | null;
  phone?: string | null;
  email?: string | null;
  isPrimary: boolean;
  notes?: string | null;
}

const ENTITY_TYPES = ['CUSTOMER', 'SUPPLIER', 'TENANT', 'GUEST', 'PARTNER', 'OTHER'];

interface ContactForm {
  companyId: string; entityType: string; entityId: string; fullName: string;
  position: string; phone: string; email: string; isPrimary: string; notes: string;
}
const BLANK: ContactForm = { companyId: '', entityType: 'CUSTOMER', entityId: '', fullName: '', position: '', phone: '', email: '', isPrimary: 'false', notes: '' };

function ContactModal({ mode, initial, companies, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: ContactPerson; companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ContactForm>(() => initial ? {
    companyId: initial.companyId, entityType: initial.entityType, entityId: initial.entityId,
    fullName: initial.fullName, position: initial.position ?? '', phone: initial.phone ?? '',
    email: initial.email ?? '', isPrimary: initial.isPrimary ? 'true' : 'false', notes: initial.notes ?? '',
  } : { ...BLANK });
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof ContactForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const linkedList = form.entityType === 'CUSTOMER' ? 'customers' : form.entityType === 'SUPPLIER' ? 'suppliers' : null;

  useEffect(() => {
    let cancelled = false;
    if (!linkedList || !form.companyId) { setEntities([]); return; }
    fetch(`/api/backend/${linkedList}?companyId=${encodeURIComponent(form.companyId)}&limit=500`)
      .then((r) => r.json())
      .then((j) => {
        const rows = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data?.items) ? j.data.items : Array.isArray(j.data) ? j.data : [];
        if (!cancelled) setEntities(rows);
      })
      .catch(() => { if (!cancelled) setEntities([]); });
    return () => { cancelled = true; };
  }, [linkedList, form.companyId]);

  const submit = async () => {
    if (!form.companyId || !form.entityId || !form.fullName.trim()) { setError('Company, entity and full name are required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        entityType: form.entityType,
        entityId: form.entityId,
        fullName: form.fullName.trim(),
        position: form.position || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        isPrimary: form.isPrimary === 'true',
        notes: form.notes || undefined,
      };
      if (mode === 'create') {
        await backendPost('/contact-persons', { ...body, companyId: form.companyId });
      } else {
        await backendPut(`/contact-persons/${initial!.id}`, body);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Contact Person' : 'Edit Contact Person'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormSelect label="Company" required value={form.companyId} disabled={mode === 'edit'}
          onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value, entityId: '' }))} placeholder="Select…">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormSelect label="Entity Type" required value={form.entityType}
          onChange={(e) => setForm((f) => ({ ...f, entityType: e.target.value, entityId: '' }))}>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </FormSelect>
        {linkedList ? (
          <FormSelect label={form.entityType === 'CUSTOMER' ? 'Customer' : 'Supplier'} required value={form.entityId}
            onChange={(e) => set('entityId', e.target.value)} placeholder={form.companyId ? 'Select…' : 'Select company first'}>
            {entities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FormSelect>
        ) : (
          <FormInput label="Entity ID" required value={form.entityId} onChange={(e) => set('entityId', e.target.value)} />
        )}
        <FormInput label="Full Name" required value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
        <FormInput label="Position" value={form.position} onChange={(e) => set('position', e.target.value)} />
        <FormInput label="Phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        <FormInput label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        <FormSelect label="Primary Contact" value={form.isPrimary} onChange={(e) => set('isPrimary', e.target.value)}>
          <option value="false">No</option>
          <option value="true">Yes</option>
        </FormSelect>
        <div className="col-span-2"><FormTextarea label="Notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function ContactPersonsPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('contact_persons.create');
  const canUpdate = hasPermission('contact_persons.update');
  const canDelete = hasPermission('contact_persons.delete');
  const hasActions = canUpdate || canDelete;

  const [data, setData] = useState<ContactPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ContactPerson | null>(null);
  const [deleting, setDeleting] = useState<ContactPerson | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/backend/contact-persons')
      .then(r => r.json())
      .then(res => {
        const d = res.data ?? res;
        setData(Array.isArray(d) ? d : Array.isArray(d?.items) ? d.items : Array.isArray(d?.data) ? d.data : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!canCreate && !canUpdate) return;
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => setCompanies(j.data?.data ?? j.data ?? []))
      .catch(() => {});
  }, [canCreate, canUpdate]);

  const onSaved = () => {
    showToast('success', creating ? 'Contact person created' : 'Contact person updated');
    setCreating(false); setEditing(null); load();
  };

  const doDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await backendDelete(`/contact-persons/${deleting.id}`);
      showToast('success', 'Contact person deleted');
      setDeleting(null); load();
    } catch (err) {
      showToast('error', 'Delete failed', err instanceof ApiError ? err.message : err instanceof Error ? err.message : undefined);
    } finally { setDeleteBusy(false); }
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Contact Persons</h1>
        <p className="text-gray-500 mt-1">Manage contacts for customers and suppliers</p>
      </div>

      <PageToolbar
        actions={canCreate ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Contact</Btn> : null}
      />

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Full Name</th>
                <th className="px-4 py-3">Entity Type</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Position</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Primary</th>
                {hasActions && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={hasActions ? 8 : 7} className="px-4 py-8 text-center text-gray-400">No records found</td></tr>
              ) : data.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{row.fullName}</td>
                  <td className="px-4 py-3">{row.entityType}</td>
                  <td className="px-4 py-3">{row.entityId}</td>
                  <td className="px-4 py-3">{row.position ?? '—'}</td>
                  <td className="px-4 py-3">{row.phone ?? '—'}</td>
                  <td className="px-4 py-3">{row.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.isPrimary ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {row.isPrimary ? 'Yes' : 'No'}
                    </span>
                  </td>
                  {hasActions && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
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

      {creating && <ContactModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <ContactModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={onSaved} />}
      <ConfirmDialog
        open={!!deleting}
        title="Delete Contact Person"
        message={deleting ? `Delete "${deleting.fullName}"? This cannot be undone.` : ''}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteBusy}
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
