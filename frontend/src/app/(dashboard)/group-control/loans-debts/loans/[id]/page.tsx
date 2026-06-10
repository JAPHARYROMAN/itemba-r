'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LoanDetail {
  id: string;
  lenderName: string;
  lenderType?: string;
  loanReference?: string;
  obligationType: string;
  borrowerLevel: string;
  principalAmount: string;
  outstandingBalance: string;
  interestRate: string;
  repaymentFrequency: string;
  repaymentAmount?: string;
  startDate?: string;
  maturityDate?: string;
  status: string;
  riskLevel: string;
  currency: string;
  purpose?: string;
  collateralDescription?: string;
  guarantor?: string;
  guaranteeDetails?: string;
  linkedAssetIds?: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  company?: { id: string; name: string; code: string } | null;
  group?: { id: string; name: string } | null;
  repayments?: Repayment[];
}

interface Repayment {
  id: string;
  amount: string;
  principal?: string;
  interest?: string;
  penalties?: string;
  remainingBalance?: string;
  repaymentDate: string;
  paymentMethod?: string;
  referenceNumber?: string;
  notes?: string;
  createdAt: string;
  recordedById?: string;
  user?: { fullName: string } | null;
}

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
  ipAddress?: string;
  user?: { fullName: string; email: string } | null;
  metadata?: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | string | null | undefined) {
  const num = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  if (isNaN(num)) return '—';
  return num.toLocaleString('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const OBLIGATION_LABELS: Record<string, string> = {
  BANK_LOAN: 'Bank Loan', OVERDRAFT: 'Overdraft', SUPPLIER_CREDIT: 'Supplier Credit',
  ASSET_FINANCE: 'Asset Finance', MORTGAGE: 'Mortgage', DIRECTOR_LOAN: 'Director Loan',
  INTER_COMPANY_LOAN: 'Inter-Company Loan', INSTITUTIONAL_DEBT: 'Institutional Debt', OTHER: 'Other',
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-800', SETTLED: 'bg-blue-100 text-blue-800',
    DEFAULTED: 'bg-red-100 text-red-800', RESTRUCTURED: 'bg-purple-100 text-purple-800',
    CANCELLED: 'bg-slate-100 text-slate-600', WRITTEN_OFF: 'bg-gray-100 text-gray-500',
  };
  return <span className={`inline-flex px-2.5 py-0.5 rounded text-xs font-semibold ${map[status] ?? 'bg-slate-100 text-slate-600'}`}>{status.replace(/_/g, ' ')}</span>;
}

function RiskBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    LOW: 'bg-green-100 text-green-700', MEDIUM: 'bg-yellow-100 text-yellow-700',
    HIGH: 'bg-red-100 text-red-700', CRITICAL: 'bg-red-200 text-red-900 font-bold',
  };
  return <span className={`inline-flex px-2.5 py-0.5 rounded text-xs ${map[level] ?? 'bg-slate-100 text-slate-600'}`}>{level}</span>;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-4 py-2.5 border-b border-slate-100 last:border-0">
      <dt className="text-sm text-slate-500 w-48 shrink-0">{label}</dt>
      <dd className="text-sm text-slate-900 font-medium">{value ?? '—'}</dd>
    </div>
  );
}

function RecordRepaymentModal({ loan, onClose, onSaved }: { loan: LoanDetail; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ amount: '', principalPortion: '', interestPortion: '', penaltyAmount: '', paymentDate: new Date().toISOString().split('T')[0], paymentMethod: '', reference: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/backend/loans/${loan.id}/repayments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: form.amount,
          principal: form.principalPortion || undefined,
          interest: form.interestPortion || undefined,
          penalties: form.penaltyAmount || undefined,
          repaymentDate: form.paymentDate,
          paymentMethod: form.paymentMethod || undefined,
          referenceNumber: form.reference || undefined,
          notes: form.notes || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(Array.isArray(err.message) ? err.message.join(', ') : err.message ?? 'Failed to record repayment');
        return;
      }
      onSaved();
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Record Repayment</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Total Amount <span className="text-red-500">*</span></label>
            <input required type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder={`Max: ${loan.outstandingBalance}`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Principal Portion</label>
              <input type="number" step="0.01" min="0" value={form.principalPortion} onChange={(e) => setForm({ ...form, principalPortion: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Interest Portion</label>
              <input type="number" step="0.01" min="0" value={form.interestPortion} onChange={(e) => setForm({ ...form, interestPortion: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Payment Date <span className="text-red-500">*</span></label>
              <input required type="date" value={form.paymentDate} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method</label>
              <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none bg-white">
                <option value="">Select…</option>
                {['BANK_TRANSFER', 'CHEQUE', 'CASH', 'MOBILE_MONEY', 'OTHER'].map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Reference / Receipt No</label>
            <input type="text" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LoanDetailPage() {
  useAuth();
  const { id } = useParams<{ id: string }>();

  const [loan, setLoan] = useState<LoanDetail | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'details' | 'repayments' | 'audit'>('details');
  const [showRepaymentModal, setShowRepaymentModal] = useState(false);

  async function loadLoan() {
    setLoading(true);
    try {
      const res = await fetch(`/api/backend/loans/${id}`);
      const json = await res.json();
      setLoan(json.data ?? null);
    } finally { setLoading(false); }
  }

  async function loadAudit() {
    const res = await fetch(`/api/backend/loans/${id}/audit-history`);
    const json = await res.json();
    setAudit(Array.isArray(json.data) ? json.data : []);
  }

  useEffect(() => {
    if (id) {
      loadLoan();
      loadAudit();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const pctPaid = loan ? (1 - Number(loan.outstandingBalance) / Number(loan.principalAmount)) * 100 : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="flex justify-center py-24 text-slate-400 text-sm">Loading…</div>
      </div>
    );
  }

  if (!loan) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <p className="text-slate-500">Loan record not found.</p>
          <Link href="/group-control/loans-debts" className="text-brand-600 hover:underline text-sm">← Back to Registry</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-screen-xl mx-auto px-6 py-8 space-y-6">

        {/* Breadcrumb */}
        <div className="text-sm text-slate-500 flex items-center gap-2">
          <Link href="/group-control" className="hover:underline">Group Control</Link>
          <span>/</span>
          <Link href="/group-control/loans-debts" className="hover:underline">Loans & Debts</Link>
          <span>/</span>
          <span className="text-slate-800 font-medium">{loan.lenderName}</span>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <PageHeader
              title={loan.lenderName}
              description={`${OBLIGATION_LABELS[loan.obligationType] ?? loan.obligationType} · ${loan.borrowerLevel === 'GROUP' ? 'Group-level' : (loan.company?.name ?? 'Company')} · Ref: ${loan.loanReference ?? 'N/A'}`}
            />
            <div className="flex gap-2 mt-2">
              <StatusBadge status={loan.status} />
              <RiskBadge level={loan.riskLevel} />
            </div>
          </div>
          {loan.status === 'ACTIVE' && (
            <button onClick={() => setShowRepaymentModal(true)}
              className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700">
              + Record Repayment
            </button>
          )}
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="text-xs text-slate-500 mb-1">Principal Amount</div>
            <div className="text-xl font-bold text-slate-900">{loan.currency} {fmt(loan.principalAmount)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-slate-500 mb-1">Outstanding Balance</div>
            <div className="text-xl font-bold text-slate-900">{loan.currency} {fmt(loan.outstandingBalance)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-slate-500 mb-1">Interest Rate</div>
            <div className="text-xl font-bold text-slate-900">{(parseFloat(loan.interestRate) * 100).toFixed(2)}% p.a.</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-slate-500 mb-1">Repayment</div>
            <div className="text-xl font-bold text-slate-900">
              {loan.repaymentAmount ? `${loan.currency} ${fmt(loan.repaymentAmount)}` : '—'}
            </div>
            <div className="text-xs text-slate-400">{loan.repaymentFrequency?.replace(/_/g, ' ') ?? ''}</div>
          </Card>
        </div>

        {/* Repayment Progress Bar */}
        {pctPaid > 0 && (
          <Card className="p-4">
            <div className="flex justify-between text-sm text-slate-600 mb-2">
              <span>Repayment Progress</span>
              <span>{pctPaid.toFixed(1)}% paid</span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.min(pctPaid, 100)}%` }} />
            </div>
            <div className="flex justify-between text-xs text-slate-400 mt-1">
              <span>{loan.currency} {fmt(Number(loan.principalAmount) - Number(loan.outstandingBalance))} paid</span>
              <span>{loan.currency} {fmt(loan.outstandingBalance)} remaining</span>
            </div>
          </Card>
        )}

        {/* Tabs */}
        <div>
          <div className="flex gap-1 border-b border-slate-200 mb-5">
            {(['details', 'repayments', 'audit'] as const).map((t) => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${activeTab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {t === 'repayments' ? `Repayment History (${loan.repayments?.length ?? 0})` : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {activeTab === 'details' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-5">
                <h3 className="font-semibold text-slate-800 mb-3">Loan Information</h3>
                <dl>
                  <DetailRow label="Obligation Type" value={OBLIGATION_LABELS[loan.obligationType] ?? loan.obligationType} />
                  <DetailRow label="Lender Name" value={loan.lenderName} />
                  <DetailRow label="Lender Type" value={loan.lenderType?.replace(/_/g, ' ')} />
                  <DetailRow label="Loan Reference" value={loan.loanReference} />
                  <DetailRow label="Purpose" value={loan.purpose} />
                  <DetailRow label="Start Date" value={fmtDate(loan.startDate)} />
                  <DetailRow label="Maturity Date" value={fmtDate(loan.maturityDate)} />
                  <DetailRow label="Repayment Frequency" value={loan.repaymentFrequency?.replace(/_/g, ' ')} />
                </dl>
              </Card>

              <Card className="p-5">
                <h3 className="font-semibold text-slate-800 mb-3">Ownership & Risk</h3>
                <dl>
                  <DetailRow label="Borrower Level" value={<span className="px-2 py-0.5 bg-slate-100 rounded text-xs">{loan.borrowerLevel}</span>} />
                  <DetailRow label="Borrower" value={loan.company?.name ?? loan.group?.name ?? '—'} />
                  <DetailRow label="Risk Level" value={<RiskBadge level={loan.riskLevel} />} />
                  <DetailRow label="Status" value={<StatusBadge status={loan.status} />} />
                  <DetailRow label="Currency" value={loan.currency} />
                  <DetailRow label="Created At" value={fmtDateTime(loan.createdAt)} />
                  <DetailRow label="Last Updated" value={fmtDateTime(loan.updatedAt)} />
                </dl>
              </Card>

              {(loan.collateralDescription || loan.guarantor || loan.guaranteeDetails) && (
                <Card className="p-5">
                  <h3 className="font-semibold text-slate-800 mb-3">Collateral & Guarantees</h3>
                  <dl>
                    <DetailRow label="Collateral Description" value={loan.collateralDescription} />
                    <DetailRow label="Guarantor" value={loan.guarantor} />
                    <DetailRow label="Guarantee Details" value={loan.guaranteeDetails} />
                    {(loan.linkedAssetIds?.length ?? 0) > 0 && (
                      <DetailRow label="Linked Asset IDs" value={
                        <div className="flex flex-wrap gap-1">
                          {loan.linkedAssetIds!.map((aid) => (
                            <Link key={aid} href={`/group-control/fixed-assets/${aid}`} className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded hover:bg-brand-50 hover:text-brand-700">{aid.slice(0, 8)}…</Link>
                          ))}
                        </div>
                      } />
                    )}
                  </dl>
                </Card>
              )}

              {loan.notes && (
                <Card className="p-5">
                  <h3 className="font-semibold text-slate-800 mb-2">Notes</h3>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{loan.notes}</p>
                </Card>
              )}
            </div>
          )}

          {activeTab === 'repayments' && (
            <Card>
              {!loan.repayments?.length ? (
                <div className="py-12 text-center text-sm text-slate-400">No repayments recorded yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-500 border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="px-5 py-2">Date</th>
                      <th className="px-5 py-2">Total Amount</th>
                      <th className="px-5 py-2">Principal</th>
                      <th className="px-5 py-2">Interest</th>
                      <th className="px-5 py-2">Penalty</th>
                      <th className="px-5 py-2">Method</th>
                      <th className="px-5 py-2">Reference</th>
                      <th className="px-5 py-2">Recorded By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loan.repayments.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="px-5 py-2 text-slate-700">{fmtDate(r.repaymentDate)}</td>
                        <td className="px-5 py-2 font-semibold text-slate-900">{loan.currency} {fmt(r.amount)}</td>
                        <td className="px-5 py-2 text-slate-600">{r.principal ? fmt(r.principal) : '—'}</td>
                        <td className="px-5 py-2 text-slate-600">{r.interest ? fmt(r.interest) : '—'}</td>
                        <td className="px-5 py-2 text-slate-600">{r.penalties && parseFloat(r.penalties) > 0 ? fmt(r.penalties) : '—'}</td>
                        <td className="px-5 py-2 text-slate-500 text-xs">{r.paymentMethod?.replace(/_/g, ' ') ?? '—'}</td>
                        <td className="px-5 py-2 font-mono text-xs text-slate-500">{r.referenceNumber ?? '—'}</td>
                        <td className="px-5 py-2 text-slate-500 text-xs">{r.user?.fullName ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}

          {activeTab === 'audit' && (
            <Card>
              {!audit.length ? (
                <div className="py-12 text-center text-sm text-slate-400">No audit entries found.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-500 border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="px-5 py-2">Timestamp</th>
                      <th className="px-5 py-2">Action</th>
                      <th className="px-5 py-2">User</th>
                      <th className="px-5 py-2">IP Address</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {audit.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50">
                        <td className="px-5 py-2 text-slate-500 text-xs whitespace-nowrap">{fmtDateTime(a.createdAt)}</td>
                        <td className="px-5 py-2">
                          <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-700">{a.action}</span>
                        </td>
                        <td className="px-5 py-2 text-slate-700">
                          {a.user ? <><div className="font-medium">{a.user.fullName}</div><div className="text-xs text-slate-400">{a.user.email}</div></> : '—'}
                        </td>
                        <td className="px-5 py-2 text-slate-500 font-mono text-xs">{a.ipAddress ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}
        </div>
      </div>

      {showRepaymentModal && (
        <RecordRepaymentModal
          loan={loan}
          onClose={() => setShowRepaymentModal(false)}
          onSaved={loadLoan}
        />
      )}
    </div>
  );
}
