'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string; code: string }

interface DocumentRecord {
  id: string;
  documentCode?: string | null;
  title: string;
  category: string;
  status: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes?: number | null;
  isConfidential: boolean;
  expiryDate?: string | null;
  renewalDate?: string | null;
  ownerType: string;
  createdAt: string;
  company?: { name: string } | null;
  uploadedBy?: { fullName: string } | null;
}

interface ExpiringDoc { id: string; title: string; expiryDate: string; category: string; company?: { name: string } | null }

interface DocSummary {
  total: number;
  confidential: number;
  expired: number;
  expiringSoon: number;
  byCategory?: { category: string; _count: { id: number } }[];
  byStatus?: { status: string; _count: { id: number } }[];
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const CATEGORIES = ['COMPANY_REGISTRATION', 'BRELA_DOCUMENT', 'TIN_CERTIFICATE', 'VRN_CERTIFICATE', 'BUSINESS_LICENSE', 'TAX_CLEARANCE', 'BANK_DOCUMENT', 'LOAN_DOCUMENT', 'DEBT_DOCUMENT', 'CONTRACT', 'INSURANCE_POLICY', 'VEHICLE_LOGBOOK', 'LAND_TITLE_DEED', 'LEASE_AGREEMENT', 'BOARD_RESOLUTION', 'PERMIT', 'INVOICE', 'RECEIPT', 'SUPPLIER_STATEMENT', 'CUSTOMER_AGREEMENT', 'PAYROLL_DOCUMENT', 'EMPLOYMENT_CONTRACT', 'AUDIT_FILE', 'LEGAL_CORRESPONDENCE', 'COURT_DOCUMENT', 'CONSTRUCTION_PERMIT', 'AGRICULTURE_PERMIT', 'IMPORT_EXPORT_DOCUMENT', 'OTHER'];
const STATUSES = ['ACTIVE', 'EXPIRED', 'PENDING_RENEWAL', 'ARCHIVED', 'SUPERSEDED'];
const OWNER_TYPES = ['GROUP', 'COMPANY', 'DIVISION', 'BRANCH', 'BANK_ACCOUNT', 'LOAN', 'DEBT', 'CONTRACT', 'FIXED_ASSET'];

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtBytes(b?: number | null) {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}
function daysUntil(d?: string | null) {
  if (!d) return Infinity;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

function UploadModal({ companies, onClose, onSaved }: { companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    title: '', category: 'OTHER', ownerType: 'COMPANY', ownerId: '',
    companyId: '', description: '', isConfidential: false, expiryDate: '', renewalDate: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!file) { setError('File is required'); return; }
    if (!form.title.trim()) { setError('Title is required'); return; }
    if (!form.ownerId.trim()) { setError('Owner ID is required'); return; }
    setSaving(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', form.title.trim());
      fd.append('category', form.category);
      fd.append('ownerType', form.ownerType);
      fd.append('ownerId', form.ownerId.trim());
      if (form.companyId) fd.append('companyId', form.companyId);
      if (form.description) fd.append('description', form.description);
      fd.append('isConfidential', form.isConfidential ? 'true' : 'false');
      if (form.expiryDate) fd.append('expiryDate', form.expiryDate);
      if (form.renewalDate) fd.append('renewalDate', form.renewalDate);
      const res = await fetch('/api/backend/documents/upload', { method: 'POST', body: fd });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Upload failed'); }
      onSaved();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="Upload Document" size="xl"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={handleSubmit} loading={saving}>Upload</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--aurora-text)' }}>File <span className="text-red-500">*</span></label>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Title" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          <FormSelect label="Category" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
          </FormSelect>
          <FormSelect label="Owner Type" value={form.ownerType} onChange={(e) => setForm((f) => ({ ...f, ownerType: e.target.value }))}>
            {OWNER_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </FormSelect>
          <FormInput label="Owner ID (UUID)" required value={form.ownerId} onChange={(e) => setForm((f) => ({ ...f, ownerId: e.target.value }))} />
          <FormSelect label="Company" value={form.companyId} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))} placeholder="Group-level">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FormSelect>
          <div></div>
          <FormInput label="Expiry Date" type="date" value={form.expiryDate} onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))} />
          <FormInput label="Renewal Date" type="date" value={form.renewalDate} onChange={(e) => setForm((f) => ({ ...f, renewalDate: e.target.value }))} />
          <div className="col-span-2"><FormTextarea label="Description" rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--aurora-text)' }}>
          <input type="checkbox" checked={form.isConfidential} onChange={(e) => setForm((f) => ({ ...f, isConfidential: e.target.checked }))} /> Mark as Confidential
        </label>
      </div>
    </Modal>
  );
}

export default function DocumentsPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<DocumentRecord> | null>(null);
  const [summary, setSummary] = useState<DocSummary | null>(null);
  const [expiring, setExpiring] = useState<ExpiringDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterConfidential, setFilterConfidential] = useState('');
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);

  const canView = hasPermission('documents.read');
  const canManage = hasPermission('documents.create');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json())
      .then((j) => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const loadAux = useCallback(() => {
    fetch('/api/backend/documents/summary').then((r) => r.json()).then((j) => setSummary(j.data ?? null));
    fetch('/api/backend/documents/expiring?days=60').then((r) => r.json())
      .then((j) => setExpiring(Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search.trim()) params.set('search', search.trim());
      if (filterCompany) params.set('companyId', filterCompany);
      if (filterCategory) params.set('category', filterCategory);
      if (filterStatus) params.set('status', filterStatus);
      if (filterConfidential) params.set('isConfidential', filterConfidential);
      const res = await fetch(`/api/backend/documents?${params}`);
      const json = await res.json();
      setData(json.data ?? null);
    } finally { setLoading(false); }
  }, [page, search, filterCompany, filterCategory, filterStatus, filterConfidential]);

  useEffect(() => { loadAux(); }, [loadAux]);
  useEffect(() => { load(); }, [load]);

  if (!canView) {
    return <div className="p-6"><PageHeader title="Documents" subtitle="Group document vault" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;
  }

  const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' } as const;
  const refresh = () => { load(); loadAux(); };
  const expiring60 = expiring.filter((e) => daysUntil(e.expiryDate) <= 60 && daysUntil(e.expiryDate) >= 0);

  const activeCount = summary?.byStatus?.find((s) => s.status === 'ACTIVE')?._count.id ?? 0;
  const pendingRenewal = summary?.byStatus?.find((s) => s.status === 'PENDING_RENEWAL')?._count.id ?? 0;

  return (
    <div className="p-6 space-y-6">
      {uploading && <UploadModal companies={companies} onClose={() => setUploading(false)} onSaved={() => { setUploading(false); refresh(); }} />}

      <PageHeader title="Documents" subtitle="Group document vault — confidential, expiry tracking, and renewals" />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total" value={summary?.total ?? 0} />
        <StatCard label="Confidential" value={summary?.confidential ?? 0} hint="Restricted" />
        <StatCard label="Active" value={activeCount} />
        <StatCard label="Expired" value={summary?.expired ?? 0} />
        <StatCard label="Expiring Soon" value={summary?.expiringSoon ?? 0} hint="Within 60d" />
        <StatCard label="Pending Renewal" value={pendingRenewal} />
      </div>

      {expiring60.length > 0 && (
        <Card className="p-4 border-amber-300 bg-amber-50">
          <div className="text-sm font-semibold text-amber-900 mb-2">⚠ {expiring60.length} document(s) expiring within 60 days</div>
          <ul className="space-y-1 text-xs">
            {expiring60.slice(0, 5).map((d) => (
              <li key={d.id}>
                <Link href={`/group-control/documents/${d.id}`} className="text-amber-900 hover:underline">
                  {d.title} ({d.category.replace(/_/g, ' ')}) — {daysUntil(d.expiryDate)} day(s) — {fmtDate(d.expiryDate)}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <PageToolbar
        search={search} onSearch={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Title, code, filename…"
        filters={
          <>
            <select value={filterCompany} onChange={(e) => { setFilterCompany(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={filterCategory} onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={filterConfidential} onChange={(e) => { setFilterConfidential(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Visibility</option>
              <option value="true">Confidential</option>
              <option value="false">Standard</option>
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setUploading(true)}>+ Upload</Btn> : null}
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Expiry</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Uploaded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td colSpan={8}><PageSpinner /></td></tr>
                : !data?.data.length ? <tr><td colSpan={8} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No documents</td></tr>
                : data.data.map((d) => {
                  const days = daysUntil(d.expiryDate);
                  const expired = d.expiryDate && days < 0;
                  const expSoon = d.expiryDate && days >= 0 && days <= 30;
                  const rowCls = expired ? 'bg-red-50 hover:bg-red-100' : expSoon ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-slate-50';
                  return (
                    <tr key={d.id} className={rowCls}>
                      <td className="px-4 py-3">
                        <Link href={`/group-control/documents/${d.id}`} className="text-brand-600 hover:underline">
                          {d.isConfidential && <span className="mr-1">🔒</span>}{d.title}
                        </Link>
                        {d.documentCode && <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{d.documentCode}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs">{d.category.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3 text-xs">{d.company?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-xs">{d.fileName}</td>
                      <td className="px-4 py-3 text-xs">{fmtBytes(d.fileSizeBytes)}</td>
                      <td className={`px-4 py-3 text-xs ${expired ? 'text-red-700 font-bold' : expSoon ? 'text-amber-700 font-semibold' : ''}`}>
                        {fmtDate(d.expiryDate)}
                      </td>
                      <td className="px-4 py-3"><StatusBadge value={d.status} /></td>
                      <td className="px-4 py-3 text-xs">{fmtDate(d.createdAt)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {data && data.totalPages > 1 && (
          <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--aurora-border)' }}>
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>Page {data.page} of {data.totalPages} · {data.total} total</span>
            <div className="flex gap-2">
              <Btn variant="secondary" size="xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Btn>
              <Btn variant="secondary" size="xs" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
