'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Contract {
  id: string;
  title: string;
  contractType: string;
  contractNumber?: string;
  owningLevel: string;
  counterpartyName: string;
  counterpartyContact?: string;
  counterpartyAddress?: string;
  startDate: string;
  endDate?: string;
  renewalDate?: string;
  renewalNoticeDate?: string;
  autoRenews: boolean;
  value?: string | number;
  currency: string;
  paymentTerms?: string;
  obligations?: string;
  status: string;
  riskLevel: string;
  isSensitive: boolean;
  responsiblePersonId?: string;
  signatoryUserId?: string;
  description?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  company?: { id: string; name: string; code: string } | null;
  group?: { id: string; name: string; code: string } | null;
  documents?: Document[];
}

interface Document {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  createdAt: string;
}

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  user?: { fullName: string; email: string } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | string | null | undefined) {
  const num = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  if (isNaN(num)) return '—';
  return num.toLocaleString('en-TZ', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function daysUntil(d?: string | null) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  EXPIRED: 'bg-red-100 text-red-600',
  TERMINATED: 'bg-red-100 text-red-700',
  SUSPENDED: 'bg-orange-100 text-orange-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
  PENDING_RENEWAL: 'bg-blue-100 text-blue-700',
};

const RISK_STYLES: Record<string, string> = {
  LOW: 'bg-green-100 text-green-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  HIGH: 'bg-orange-100 text-orange-700',
  CRITICAL: 'bg-red-100 text-red-700',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function RiskBadge({ level }: { level: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold ${RISK_STYLES[level] ?? 'bg-slate-100 text-slate-500'}`}>
      {level}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 last:border-0">
      <dt className="text-sm text-slate-500 font-medium">{label}</dt>
      <dd className="col-span-2 text-sm text-slate-800">{value ?? '—'}</dd>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

type Tab = 'details' | 'parties' | 'terms' | 'documents' | 'audit';

// ─── Change Status Modal ──────────────────────────────────────────────────────

const STATUSES = ['DRAFT','PENDING_APPROVAL','ACTIVE','EXPIRED','TERMINATED','SUSPENDED','CANCELLED','PENDING_RENEWAL'];

function ChangeStatusModal({
  current,
  onClose,
  onSubmit,
}: {
  current: string;
  onClose: () => void;
  onSubmit: (status: string, notes: string) => Promise<void>;
}) {
  const [status, setStatus] = useState(current);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try { await onSubmit(status, notes); } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-900">Change Contract Status</h3>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">New Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              placeholder="Reason for status change…"
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">Cancel</button>
          <button onClick={handleSubmit} disabled={loading}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {loading ? 'Saving…' : 'Update Status'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();

  const [contract, setContract] = useState<Contract | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('details');
  const [showStatusModal, setShowStatusModal] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const [conRes, auditRes] = await Promise.all([
          fetch(`/api/backend/contracts/${id}`),
          fetch(`/api/backend/contracts/${id}/audit-history`),
        ]);
        const [conJson, auditJson] = await Promise.all([conRes.json(), auditRes.json()]);
        if (!conRes.ok) throw new Error(conJson.message ?? `Error ${conRes.status}`);
        setContract(conJson.data ?? null);
        setAudit(Array.isArray(auditJson.data) ? auditJson.data : []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load contract');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleStatusChange = async (status: string, notes: string) => {
    const res = await fetch(`/api/backend/contracts/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, notes }),
    });
    if (!res.ok) throw new Error('Failed to update status');
    const json = await res.json();
    setContract(json.data ?? null);
    setShowStatusModal(false);
    // Refresh audit trail
    const auditRes = await fetch(`/api/backend/contracts/${id}/audit-history`);
    const auditJson = await auditRes.json();
    setAudit(Array.isArray(auditJson.data) ? auditJson.data : []);
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <main className="flex-1"><Spinner /></main>
    </div>
  );

  if (error || !contract) return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <main className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-500">{error ?? 'Contract not found'}</p>
          <Link href="/group-control/contracts" className="text-sm text-indigo-600 hover:underline mt-2 block">
            ← Back to Registry
          </Link>
        </div>
      </main>
    </div>
  );

  const daysLeft = daysUntil(contract.endDate);
  const expiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'details', label: 'Details' },
    { id: 'parties', label: 'Parties & Ownership' },
    { id: 'terms', label: 'Terms & Obligations' },
    { id: 'documents', label: `Documents (${contract.documents?.length ?? 0})` },
    { id: 'audit', label: `Audit Trail (${audit.length})` },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <main className="flex-1 px-6 py-6 max-w-screen-xl mx-auto w-full space-y-6">
        <PageHeader
          title={contract.title}
          description={`${contract.contractType.replace(/_/g, ' ')} · ${contract.company?.name ?? contract.group?.name ?? 'Group'}`}
          action={
            <Link href="/group-control/contracts" className="text-sm text-indigo-600 hover:underline">
              ← Contracts Registry
            </Link>
          }
        />

        {/* Hero strip */}
        <div className="bg-white rounded-xl border border-slate-200 px-6 py-5 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <StatusBadge status={contract.status} />
            <RiskBadge level={contract.riskLevel} />
            {contract.isSensitive && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-100 text-rose-700 text-xs font-semibold">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                Sensitive
              </span>
            )}
          </div>

          {contract.value && (
            <div className="text-right ml-auto">
              <div className="text-2xl font-bold text-slate-900">{contract.currency} {fmt(contract.value)}</div>
              <div className="text-xs text-slate-400">Contract Value</div>
            </div>
          )}

          <div className="flex gap-6 text-sm">
            <div>
              <div className="text-slate-500 text-xs">Start</div>
              <div className="font-medium">{fmtDate(contract.startDate)}</div>
            </div>
            {contract.endDate && (
              <div>
                <div className="text-slate-500 text-xs">End</div>
                <div className={`font-medium ${expiringSoon ? 'text-amber-600' : ''}`}>
                  {fmtDate(contract.endDate)}
                  {expiringSoon && <span className="ml-1 text-xs text-amber-500">({daysLeft}d left)</span>}
                </div>
              </div>
            )}
            {contract.renewalDate && (
              <div>
                <div className="text-slate-500 text-xs">Renewal</div>
                <div className="font-medium">{fmtDate(contract.renewalDate)}</div>
              </div>
            )}
          </div>

          {hasPermission('contracts.update') && (
            <button onClick={() => setShowStatusModal(true)}
              className="ml-auto px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
              Change Status
            </button>
          )}
        </div>

        {/* Expiry warning */}
        {expiringSoon && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-3">
            <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <p className="text-sm text-amber-800 font-medium">
              This contract expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''} on {fmtDate(contract.endDate)}.
              {contract.renewalNoticeDate && ` Renewal notice due: ${fmtDate(contract.renewalNoticeDate)}.`}
            </p>
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-slate-200">
          <nav className="flex gap-0.5 -mb-px overflow-x-auto">
            {TABS.map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        {activeTab === 'details' && (
          <Card className="p-6">
            <dl>
              <InfoRow label="Contract Number" value={contract.contractNumber} />
              <InfoRow label="Contract Type" value={contract.contractType.replace(/_/g, ' ')} />
              <InfoRow label="Status" value={<StatusBadge status={contract.status} />} />
              <InfoRow label="Risk Level" value={<RiskBadge level={contract.riskLevel} />} />
              <InfoRow label="Start Date" value={fmtDate(contract.startDate)} />
              <InfoRow label="End Date" value={fmtDate(contract.endDate)} />
              <InfoRow label="Renewal Date" value={fmtDate(contract.renewalDate)} />
              <InfoRow label="Renewal Notice By" value={fmtDate(contract.renewalNoticeDate)} />
              <InfoRow label="Auto Renews" value={contract.autoRenews ? 'Yes' : 'No'} />
              <InfoRow label="Sensitive" value={contract.isSensitive ? (
                <span className="text-rose-600 font-medium">Yes — Group Control restricted</span>
              ) : 'No'} />
              <InfoRow label="Description" value={contract.description} />
              <InfoRow label="Notes" value={contract.notes} />
              <InfoRow label="Created" value={fmtDateTime(contract.createdAt)} />
              <InfoRow label="Last Updated" value={fmtDateTime(contract.updatedAt)} />
            </dl>
          </Card>
        )}

        {activeTab === 'parties' && (
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-6">
              <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-4">Counterparty</h3>
              <dl>
                <InfoRow label="Name" value={contract.counterpartyName} />
                <InfoRow label="Contact" value={contract.counterpartyContact} />
                <InfoRow label="Address" value={contract.counterpartyAddress} />
              </dl>
            </Card>
            <Card className="p-6">
              <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-4">Owning Entity</h3>
              <dl>
                <InfoRow label="Ownership Level" value={
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                    contract.owningLevel === 'GROUP' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-700'
                  }`}>{contract.owningLevel}</span>
                } />
                {contract.company && <InfoRow label="Company" value={`${contract.company.name} (${contract.company.code})`} />}
                {contract.group && <InfoRow label="Group" value={`${contract.group.name} (${contract.group.code})`} />}
              </dl>
            </Card>
          </div>
        )}

        {activeTab === 'terms' && (
          <Card className="p-6">
            <dl>
              <InfoRow label="Contract Value" value={contract.value ? `${contract.currency} ${fmt(contract.value)}` : undefined} />
              <InfoRow label="Currency" value={contract.currency} />
              <InfoRow label="Payment Terms" value={contract.paymentTerms} />
            </dl>
            {contract.obligations && (
              <div className="mt-4">
                <div className="text-sm font-semibold text-slate-700 mb-2">Obligations</div>
                <div className="bg-slate-50 rounded-lg p-4 text-sm text-slate-700 whitespace-pre-wrap">
                  {contract.obligations}
                </div>
              </div>
            )}
          </Card>
        )}

        {activeTab === 'documents' && (
          <Card className="p-6">
            {!contract.documents?.length ? (
              <p className="text-sm text-slate-400 text-center py-8">No documents attached to this contract.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {contract.documents.map((doc) => (
                  <li key={doc.id} className="py-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{doc.title}</p>
                      <p className="text-xs text-slate-400">{doc.fileName} · {fmtDate(doc.createdAt)}</p>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">{doc.mimeType}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {activeTab === 'audit' && (
          <Card>
            {!audit.length ? (
              <p className="text-sm text-slate-400 text-center py-8">No audit history yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500 border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-5 py-3">Action</th>
                    <th className="px-5 py-3">User</th>
                    <th className="px-5 py-3">Details</th>
                    <th className="px-5 py-3">IP</th>
                    <th className="px-5 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {audit.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          entry.action === 'CREATE' ? 'bg-green-100 text-green-700' :
                          entry.action === 'DELETE' ? 'bg-red-100 text-red-700' :
                          entry.action === 'STATUS_CHANGE' ? 'bg-blue-100 text-blue-700' :
                          entry.action === 'SENSITIVE_ACCESS' ? 'bg-rose-100 text-rose-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {entry.action.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-700">{entry.user?.fullName ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-500 text-xs max-w-xs truncate">
                        {entry.metadata ? JSON.stringify(entry.metadata) : '—'}
                      </td>
                      <td className="px-5 py-3 text-slate-400 text-xs font-mono">{entry.ipAddress ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-400 text-xs">{fmtDateTime(entry.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
      </main>

      {showStatusModal && contract && (
        <ChangeStatusModal
          current={contract.status}
          onClose={() => setShowStatusModal(false)}
          onSubmit={handleStatusChange}
        />
      )}
    </div>
  );
}
