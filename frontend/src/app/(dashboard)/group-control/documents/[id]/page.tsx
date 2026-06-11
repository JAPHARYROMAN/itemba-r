'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocumentDetail {
  id: string;
  documentCode?: string;
  title: string;
  description?: string;
  category: string;
  ownerType: string;
  ownerId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes?: number;
  storageKey: string;
  isConfidential: boolean;
  status: string;
  expiryDate?: string;
  renewalDate?: string;
  version: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  company?: { id: string; name: string } | null;
  division?: { id: string; name: string } | null;
  branch?: { id: string; name: string } | null;
  loan?: { id: string; lenderName: string } | null;
  debt?: { id: string; creditorName: string } | null;
  contract?: { id: string; title: string } | null;
  fixedAsset?: { id: string; name: string } | null;
  uploadedBy?: { id: string; fullName: string } | null;
}

interface AuditEntry {
  id: string;
  action: string;
  userId?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  user?: { id: string; fullName: string } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtLabel(s: string) {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
}

function fmtDate(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtBytes(b?: number) {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function daysUntil(d?: string) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

function StatusBadge({ status }: { status: string }) {
  const color: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-800',
    EXPIRED: 'bg-red-100 text-red-800',
    PENDING_RENEWAL: 'bg-amber-100 text-amber-800',
    ARCHIVED: 'bg-gray-100 text-gray-600',
    SUPERSEDED: 'bg-purple-100 text-purple-800',
  };
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${color[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {fmtLabel(status)}
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-3 border-b border-gray-100 last:border-0">
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900 col-span-2">{value ?? '—'}</dd>
    </div>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({
  doc,
  onClose,
  onSuccess,
}: {
  doc: DocumentDetail;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const DOC_STATUSES = ['ACTIVE','EXPIRED','PENDING_RENEWAL','ARCHIVED','SUPERSEDED'];
  const [form, setForm] = useState({
    title: doc.title,
    description: doc.description ?? '',
    status: doc.status,
    isConfidential: doc.isConfidential,
    expiryDate: doc.expiryDate ? doc.expiryDate.slice(0, 10) : '',
    renewalDate: doc.renewalDate ? doc.renewalDate.slice(0, 10) : '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const body: Record<string, unknown> = { ...form };
      if (!body.expiryDate) body.expiryDate = null;
      if (!body.renewalDate) body.renewalDate = null;

      const res = await fetch(`/api/backend/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { message?: string }).message ?? 'Update failed');
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Edit Document Metadata</h2>
          <button onClick={onClose} className="text-xs font-medium text-gray-400 hover:text-gray-600">Close</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
              {DOC_STATUSES.map(s => <option key={s} value={s}>{fmtLabel(s)}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Expiry Date</label>
              <input type="date" value={form.expiryDate} onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Renewal Date</label>
              <input type="date" value={form.renewalDate} onChange={e => setForm(f => ({ ...f, renewalDate: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.isConfidential} onChange={e => setForm(f => ({ ...f, isConfidential: e.target.checked }))} className="rounded border-gray-300" />
            <span className="text-sm text-gray-700">Confidential</span>
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'links' | 'audit';

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useAuth();

  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [showEdit, setShowEdit] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const canManage = hasPermission('documents.update');

  const fetchDoc = useCallback(async () => {
    setLoading(true);
    try {
      const [docRes, auditRes] = await Promise.all([
        fetch(`/api/backend/documents/${id}`),
        fetch(`/api/backend/documents/${id}/audit-history`),
      ]);
      const [docJson, auditJson] = await Promise.all([docRes.json(), auditRes.json()]);
      setDoc(docJson.data ?? null);
      setAudit(auditJson.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void fetchDoc(); }, [fetchDoc]);

  const handleDownload = async () => {
    if (!doc) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/backend/documents/${id}/download`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = doc.fileName; a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Soft-delete this document? It will be hidden but not permanently removed.')) return;
    const res = await fetch(`/api/backend/documents/${id}`, { method: 'DELETE' });
    if (res.ok) router.push('/group-control/documents');
    else setError('Delete failed');
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex items-center justify-center h-64 text-gray-500">Loading…</div>
    </div>
  );

  if (!doc) return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-6 py-16 text-center">
        <p className="text-gray-500 mb-4">Document not found or has been deleted.</p>
        <Link href="/group-control/documents" className="text-blue-600 hover:underline">← Back to Documents</Link>
      </div>
    </div>
  );

  const days = daysUntil(doc.expiryDate);
  const isExpired = days !== null && days < 0;
  const isExpiring = days !== null && days >= 0 && days <= 30;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/group-control" className="hover:text-gray-900">Group Control</Link>
          <span>/</span>
          <Link href="/group-control/documents" className="hover:text-gray-900">Documents</Link>
          <span>/</span>
          <span className="text-gray-900 font-medium">{doc.title}</span>
        </nav>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
        )}

        {/* Hero Strip */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  {doc.isConfidential && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Confidential</span>
                  )}
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">{fmtLabel(doc.category)}</span>
                </div>
                <h1 className="text-xl font-bold text-gray-900">{doc.title}</h1>
                {doc.documentCode && <p className="text-sm text-gray-400 font-mono">{doc.documentCode}</p>}
                {doc.description && <p className="text-sm text-gray-600 mt-1">{doc.description}</p>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <StatusBadge status={doc.status} />
              </div>
            </div>
          </div>

          {/* Key Metrics Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-100">
            <div className="px-5 py-4">
              <p className="text-xs font-medium text-gray-500 mb-1">File Name</p>
              <p className="text-sm font-semibold text-gray-900 truncate">{doc.fileName}</p>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs font-medium text-gray-500 mb-1">File Size</p>
              <p className="text-sm font-semibold text-gray-900">{fmtBytes(doc.fileSizeBytes)}</p>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs font-medium text-gray-500 mb-1">Expiry Date</p>
              <p className={`text-sm font-semibold ${isExpired ? 'text-red-700' : isExpiring ? 'text-amber-700' : 'text-gray-900'}`}>
                {fmtDate(doc.expiryDate)}
                {days !== null && days >= 0 && days <= 60 && <span className="ml-1 text-xs">({days}d left)</span>}
                {isExpired && <span className="ml-1 text-xs">(expired)</span>}
              </p>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs font-medium text-gray-500 mb-1">Uploaded</p>
              <p className="text-sm font-semibold text-gray-900">{fmtDate(doc.createdAt)}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center gap-3">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {downloading ? 'Downloading…' : '↓ Download'}
            </button>
            {canManage && (
              <>
                <button onClick={() => setShowEdit(true)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                  Edit Metadata
                </button>
                <button onClick={handleDelete} className="px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-300 rounded-lg hover:bg-red-50 ml-auto">
                  Delete
                </button>
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex gap-1">
            {([['overview','Overview'],['links','Linked Entities'],['audit','Audit Trail']] as [Tab, string][]).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                  tab === t
                    ? 'border-b-2 border-blue-600 text-blue-600 bg-white'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        {tab === 'overview' && (
          <Card>
            <dl className="divide-y divide-gray-100">
              <DetailRow label="Document Code" value={doc.documentCode} />
              <DetailRow label="Category" value={fmtLabel(doc.category)} />
              <DetailRow label="Owner Type" value={fmtLabel(doc.ownerType)} />
              <DetailRow label="Owner ID" value={<span className="font-mono text-xs">{doc.ownerId}</span>} />
              <DetailRow label="Company" value={doc.company?.name} />
              <DetailRow label="Division" value={doc.division?.name} />
              <DetailRow label="Branch" value={doc.branch?.name} />
              <DetailRow label="Status" value={<StatusBadge status={doc.status} />} />
              <DetailRow label="Confidential" value={doc.isConfidential ? 'Yes - Group Control restricted' : 'No'} />
              <DetailRow label="MIME Type" value={<span className="font-mono text-xs">{doc.mimeType}</span>} />
              <DetailRow label="Version" value={`v${doc.version}`} />
              <DetailRow label="Expiry Date" value={fmtDate(doc.expiryDate)} />
              <DetailRow label="Renewal Date" value={fmtDate(doc.renewalDate)} />
              <DetailRow label="Uploaded By" value={doc.uploadedBy?.fullName} />
              <DetailRow label="Uploaded On" value={fmtDateTime(doc.createdAt)} />
              <DetailRow label="Last Updated" value={fmtDateTime(doc.updatedAt)} />
              {doc.tags.length > 0 && (
                <DetailRow
                  label="Tags"
                  value={
                    <div className="flex flex-wrap gap-1">
                      {doc.tags.map(t => (
                        <span key={t} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">{t}</span>
                      ))}
                    </div>
                  }
                />
              )}
            </dl>
          </Card>
        )}

        {tab === 'links' && (
          <Card>
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Linked Entities</h3>
            {!doc.loan && !doc.debt && !doc.contract && !doc.fixedAsset ? (
              <p className="text-sm text-gray-500">No specific entity links recorded beyond owner type.</p>
            ) : (
              <dl className="divide-y divide-gray-100">
                {doc.loan && (
                  <DetailRow label="Loan" value={
                    <Link href={`/group-control/loans-debts/${doc.loan.id}`} className="text-blue-600 hover:underline">
                      {doc.loan.lenderName}
                    </Link>
                  } />
                )}
                {doc.debt && (
                  <DetailRow label="Debt" value={
                    <Link href={`/group-control/loans-debts/${doc.debt.id}`} className="text-blue-600 hover:underline">
                      {doc.debt.creditorName}
                    </Link>
                  } />
                )}
                {doc.contract && (
                  <DetailRow label="Contract" value={
                    <Link href={`/group-control/contracts/${doc.contract.id}`} className="text-blue-600 hover:underline">
                      {doc.contract.title}
                    </Link>
                  } />
                )}
                {doc.fixedAsset && (
                  <DetailRow label="Fixed Asset" value={
                    <Link href={`/group-control/fixed-assets/${doc.fixedAsset.id}`} className="text-blue-600 hover:underline">
                      {doc.fixedAsset.name}
                    </Link>
                  } />
                )}
              </dl>
            )}
          </Card>
        )}

        {tab === 'audit' && (
          <Card>
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Audit Trail</h3>
            {audit.length === 0 ? (
              <p className="text-sm text-gray-500">No audit records found.</p>
            ) : (
              <div className="space-y-3">
                {audit.map(entry => (
                  <div key={entry.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                      <span className="text-blue-600 text-xs font-bold">
                        {entry.user?.fullName?.charAt(0) ?? '?'}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-900">
                          {entry.user?.fullName ?? 'System'}
                        </span>
                        <span className="text-xs text-gray-400 whitespace-nowrap">{fmtDateTime(entry.createdAt)}</span>
                      </div>
                      <p className="text-sm text-gray-600 mt-0.5">
                        <span className="font-mono text-xs bg-gray-200 px-1.5 py-0.5 rounded mr-2">{entry.action}</span>
                        {entry.ipAddress && <span className="text-gray-400 text-xs">from {entry.ipAddress}</span>}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>

      {showEdit && doc && (
        <EditModal doc={doc} onClose={() => setShowEdit(false)} onSuccess={fetchDoc} />
      )}
    </div>
  );
}
