'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FixedAsset {
  id: string; assetCode: string; name: string; category: string; description?: string;
  ownershipLevel: string; collateralStatus: string; insuranceStatus: string;
  financingStatus: string; condition?: string; status: string;
  acquisitionCost: string; currentBookValue: string; currency: string;
  acquisitionDate: string; depreciationRate?: string; usefulLifeYears?: number;
  residualValue?: string; disposalDate?: string; disposalValue?: string;
  serialNumber?: string; registrationNo?: string; make?: string; model?: string;
  location?: string; notes?: string; createdAt: string; updatedAt: string;
  company?: { id: string; name: string; code: string } | null;
  group?: { id: string; name: string; code: string } | null;
  division?: { id: string; name: string; code: string } | null;
  branch?: { id: string; name: string } | null;
  documents: Array<{
    id: string; title: string; fileName: string; mimeType: string;
    fileSizeBytes?: number; isConfidential: boolean; createdAt: string;
  }>;
}

interface AuditEntry {
  id: string; action: string; createdAt: string; ipAddress?: string;
  oldValue?: Record<string, unknown>; newValue?: Record<string, unknown>;
  user?: { fullName: string; email: string } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | string | undefined | null) {
  if (n == null) return '—';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return '—';
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 2 }).format(num);
}
function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtPct(v?: string | null) {
  if (!v) return '—';
  const n = parseFloat(v);
  return isNaN(n) ? '—' : `${(n * 100).toFixed(1)}%`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-700',
    UNDER_MAINTENANCE: 'bg-yellow-100 text-yellow-800',
    DISPOSED: 'bg-slate-100 text-slate-600',
    SOLD: 'bg-purple-100 text-purple-700',
    LOST: 'bg-red-100 text-red-700',
    WRITTEN_OFF: 'bg-gray-100 text-gray-600',
    TRANSFERRED: 'bg-blue-100 text-blue-700',
    INSURED: 'bg-green-100 text-green-700',
    NOT_INSURED: 'bg-red-100 text-red-600',
    EXPIRED: 'bg-yellow-100 text-yellow-700',
    USED_AS_COLLATERAL: 'bg-rose-100 text-rose-700',
    PARTIALLY_COLLATERAL: 'bg-orange-100 text-orange-700',
    NOT_COLLATERAL: 'bg-slate-100 text-slate-500',
    OWNED_OUTRIGHT: 'bg-green-50 text-green-600',
    FINANCED: 'bg-blue-100 text-blue-700',
    LEASED: 'bg-indigo-100 text-indigo-700',
    HIRE_PURCHASE: 'bg-violet-100 text-violet-700',
    EXCELLENT: 'bg-green-100 text-green-700',
    GOOD: 'bg-emerald-100 text-emerald-700',
    FAIR: 'bg-yellow-100 text-yellow-700',
    POOR: 'bg-orange-100 text-orange-700',
    BEYOND_REPAIR: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">{label}</dt>
      <dd className="text-sm font-medium text-slate-800">{value ?? '—'}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 pb-1 border-b border-slate-100">
        {title}
      </h3>
      <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">{children}</dl>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FixedAssetDetailPage() {
  useAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [asset, setAsset] = useState<FixedAsset | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'valuation' | 'documents' | 'audit'>('overview');

  const [disposing, setDisposing] = useState(false);
  const [disposeStatus, setDisposeStatus] = useState('DISPOSED');
  const [disposeDate, setDisposeDate] = useState('');
  const [disposeValue, setDisposeValue] = useState('');

  const [settingCollateral, setSettingCollateral] = useState(false);
  const [collateralStatus, setCollateralStatus] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [assetRes, auditRes] = await Promise.all([
        fetch(`/api/backend/fixed-assets/${id}`),
        fetch(`/api/backend/fixed-assets/${id}/audit-history`),
      ]);
      const [assetJson, auditJson] = await Promise.all([assetRes.json(), auditRes.json()]);
      setAsset(assetJson.data ?? null);
      setAudit(auditJson.data ?? []);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleDispose() {
    if (!disposeDate) return;
    const res = await fetch(`/api/backend/fixed-assets/${id}/dispose`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disposalStatus: disposeStatus, disposalDate: disposeDate, disposalValue: disposeValue || undefined }),
    });
    if (res.ok) { setDisposing(false); load(); }
  }

  async function handleCollateral() {
    if (!collateralStatus) return;
    const res = await fetch(`/api/backend/fixed-assets/${id}/collateral`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collateralStatus }),
    });
    if (res.ok) { setSettingCollateral(false); load(); }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="flex justify-center items-center h-64">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-3xl mx-auto px-6 py-16 text-center">
          <p className="text-slate-500 text-lg">Asset not found.</p>
          <Link href="/group-control/fixed-assets" className="mt-4 inline-block text-brand-600 hover:underline">
            ← Back to Registry
          </Link>
        </div>
      </div>
    );
  }

  const isActive = asset.status === 'ACTIVE' || asset.status === 'UNDER_MAINTENANCE';
  const ownerName = asset.company?.name ?? asset.group?.name ?? '—';

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-screen-xl mx-auto px-6 py-8 space-y-6">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link href="/group-control" className="hover:text-brand-600">Group Control</Link>
          <span>/</span>
          <Link href="/group-control/fixed-assets" className="hover:text-brand-600">Fixed Assets</Link>
          <span>/</span>
          <span className="text-slate-800 font-mono">{asset.assetCode}</span>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{asset.name}</h1>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="font-mono text-sm text-slate-500">{asset.assetCode}</span>
              <StatusBadge status={asset.status} />
              <StatusBadge status={asset.collateralStatus} />
              <StatusBadge status={asset.insuranceStatus} />
            </div>
          </div>
          {isActive && (
            <div className="flex gap-2">
              <button onClick={() => setSettingCollateral(true)}
                className="px-4 py-2 text-sm border border-rose-200 text-rose-700 rounded-lg hover:bg-rose-50 transition-colors">
                Update Collateral
              </button>
              <button onClick={() => setDisposing(true)}
                className="px-4 py-2 text-sm bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors">
                Dispose / Sell
              </button>
            </div>
          )}
        </div>

        {/* Quick facts bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Acquisition Cost', value: `${asset.currency} ${fmt(asset.acquisitionCost)}` },
            { label: 'Book Value', value: `${asset.currency} ${fmt(asset.currentBookValue)}` },
            { label: 'Owner', value: ownerName },
            { label: 'Category', value: asset.category.replace(/_/g, ' ') },
          ].map((c) => (
            <div key={c.label} className="bg-white rounded-xl border border-slate-200 px-5 py-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide">{c.label}</p>
              <p className="text-sm font-semibold text-slate-800 mt-0.5">{c.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-200">
          {(['overview', 'valuation', 'documents', 'audit'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                tab === t
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}>
              {t === 'audit' ? 'Audit History' : t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'documents' && asset.documents.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">
                  {asset.documents.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Panels */}
        {tab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <div className="p-6 space-y-6">
                <Section title="Identity & Classification">
                  <Field label="Asset Code" value={<span className="font-mono">{asset.assetCode}</span>} />
                  <Field label="Asset Name" value={asset.name} />
                  <Field label="Category" value={asset.category.replace(/_/g,' ')} />
                  <Field label="Make / Brand" value={asset.make} />
                  <Field label="Model" value={asset.model} />
                  <Field label="Serial Number" value={asset.serialNumber} />
                  <Field label="Registration No." value={asset.registrationNo} />
                  <Field label="Location" value={asset.location} />
                  <Field label="Condition" value={asset.condition ? <StatusBadge status={asset.condition} /> : '—'} />
                </Section>
              </div>
            </Card>

            <Card>
              <div className="p-6 space-y-6">
                <Section title="Ownership & Assignment">
                  <Field label="Ownership Level" value={<StatusBadge status={asset.ownershipLevel} />} />
                  <Field label="Owning Entity" value={ownerName} />
                  <Field label="Assigned Division" value={asset.division?.name} />
                  <Field label="Assigned Branch" value={asset.branch?.name} />
                </Section>

                <Section title="Governance Flags">
                  <Field label="Collateral Status" value={<StatusBadge status={asset.collateralStatus} />} />
                  <Field label="Insurance Status" value={<StatusBadge status={asset.insuranceStatus} />} />
                  <Field label="Financing" value={<StatusBadge status={asset.financingStatus} />} />
                  <Field label="Operational Status" value={<StatusBadge status={asset.status} />} />
                </Section>

                {asset.description && (
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Notes</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">{asset.description}</p>
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}

        {tab === 'valuation' && (
          <Card>
            <div className="p-6 space-y-6">
              <Section title="Acquisition">
                <Field label="Acquisition Date" value={fmtDate(asset.acquisitionDate)} />
                <Field label="Acquisition Cost" value={`${asset.currency} ${fmt(asset.acquisitionCost)}`} />
                <Field label="Currency" value={asset.currency} />
              </Section>

              <Section title="Current Valuation">
                <Field label="Current Book Value" value={`${asset.currency} ${fmt(asset.currentBookValue)}`} />
                <Field label="Depreciation Rate" value={fmtPct(asset.depreciationRate)} />
                <Field label="Useful Life" value={asset.usefulLifeYears ? `${asset.usefulLifeYears} years` : undefined} />
                <Field label="Residual Value" value={asset.residualValue ? `${asset.currency} ${fmt(asset.residualValue)}` : undefined} />
              </Section>

              {(asset.disposalDate || asset.disposalValue) && (
                <Section title="Disposal">
                  <Field label="Disposal Date" value={fmtDate(asset.disposalDate)} />
                  <Field label="Disposal Value" value={asset.disposalValue ? `${asset.currency} ${fmt(asset.disposalValue)}` : undefined} />
                  <Field label="Disposal Status" value={<StatusBadge status={asset.status} />} />
                </Section>
              )}

              <Section title="Record Timestamps">
                <Field label="Created" value={fmtDate(asset.createdAt)} />
                <Field label="Last Updated" value={fmtDate(asset.updatedAt)} />
              </Section>
            </div>
          </Card>
        )}

        {tab === 'documents' && (
          <Card>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Attached Documents</h3>
              <span className="text-xs text-slate-400">{asset.documents.length} files</span>
            </div>
            {asset.documents.length === 0 ? (
              <div className="px-5 py-12 text-center text-slate-400">
                <div className="text-3xl mb-2">📎</div>
                <p>No documents attached to this asset yet.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="px-5 py-3">Title</th>
                    <th className="px-5 py-3">File</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Confidential</th>
                    <th className="px-5 py-3">Uploaded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {asset.documents.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium">{d.title}</td>
                      <td className="px-5 py-3 text-slate-500 text-xs font-mono">{d.fileName}</td>
                      <td className="px-5 py-3 text-slate-400 text-xs">{d.mimeType}</td>
                      <td className="px-5 py-3">
                        {d.isConfidential
                          ? <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">Confidential</span>
                          : <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-500">Open</span>}
                      </td>
                      <td className="px-5 py-3 text-slate-400 text-xs">{fmtDate(d.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}

        {tab === 'audit' && (
          <Card>
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">Audit History</h3>
              <p className="text-xs text-slate-400 mt-0.5">All recorded actions on this asset</p>
            </div>
            {audit.length === 0 ? (
              <div className="px-5 py-12 text-center text-slate-400">No audit records found.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {audit.map((e) => (
                  <div key={e.id} className="px-5 py-4 flex items-start gap-4">
                    <div className="mt-0.5 w-2 h-2 rounded-full bg-brand-400 flex-shrink-0 mt-1.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                          {e.action}
                        </span>
                        <span className="text-xs text-slate-500">{e.user?.fullName ?? 'System'}</span>
                        <span className="text-xs text-slate-400">{fmtDate(e.createdAt)}</span>
                        {e.ipAddress && <span className="text-xs text-slate-300">{e.ipAddress}</span>}
                      </div>
                      {(e.oldValue || e.newValue) && (
                        <div className="mt-2 flex gap-4 text-xs">
                          {e.oldValue && (
                            <div>
                              <span className="text-slate-400">Before: </span>
                              <span className="text-slate-600 font-mono">{JSON.stringify(e.oldValue)}</span>
                            </div>
                          )}
                          {e.newValue && (
                            <div>
                              <span className="text-slate-400">After: </span>
                              <span className="text-slate-600 font-mono">{JSON.stringify(e.newValue)}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Dispose Modal */}
        {disposing && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
              <h2 className="text-lg font-semibold text-slate-800">Dispose / Sell Asset</h2>
              <p className="text-sm text-slate-500">This action will mark the asset as no longer active.</p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wide block mb-1">Disposal Type</label>
                  <select value={disposeStatus} onChange={(e) => setDisposeStatus(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                    <option value="DISPOSED">Disposed</option>
                    <option value="SOLD">Sold</option>
                    <option value="WRITTEN_OFF">Written Off</option>
                    <option value="LOST">Lost</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wide block mb-1">Disposal Date *</label>
                  <input type="date" value={disposeDate} onChange={(e) => setDisposeDate(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wide block mb-1">Disposal Value (optional)</label>
                  <input type="number" placeholder="0.00" value={disposeValue} onChange={(e) => setDisposeValue(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setDisposing(false)}
                  className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
                <button onClick={handleDispose} disabled={!disposeDate}
                  className="flex-1 px-4 py-2 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-900 disabled:opacity-50">
                  Confirm Disposal
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Collateral Modal */}
        {settingCollateral && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
              <h2 className="text-lg font-semibold text-slate-800">Update Collateral Status</h2>
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wide block mb-1">Collateral Status</label>
                <select value={collateralStatus} onChange={(e) => setCollateralStatus(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                  <option value="">— Select —</option>
                  <option value="NOT_COLLATERAL">Not Collateral</option>
                  <option value="USED_AS_COLLATERAL">Used as Collateral</option>
                  <option value="PARTIALLY_COLLATERAL">Partially Collateral</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setSettingCollateral(false)}
                  className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
                <button onClick={handleCollateral} disabled={!collateralStatus}
                  className="flex-1 px-4 py-2 bg-rose-600 text-white rounded-lg text-sm hover:bg-rose-700 disabled:opacity-50">
                  Update
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
