'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppIcon, type AppIconName, Card } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { Modal } from '@/components/aurora/overlays/Modal';
import { FormInput } from '@/components/aurora/forms/FormInput';
import { FormSelect } from '@/components/aurora/forms/FormSelect';
import { FormTextarea } from '@/components/aurora/forms/FormTextarea';

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'DORMANT', label: 'Dormant' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'DISSOLVED', label: 'Dissolved' },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompanyProfile {
  id: string;
  registeredName: string;
  tradingName: string | null;
  brelaRegNumber: string;
  tin: string;
  vrn: string | null;
  businessLicenseNumber: string | null;
  incorporationDate: string | null;
  registeredAddress: string;
  postalAddress: string | null;
  taxOffice: string | null;
  natureOfBusiness: string | null;
  authorizedCapital: string | null;
  currency: string;
  status: string;
  notes: string | null;
}

interface Branch {
  id: string;
  name: string;
  code: string;
  type: string;
  location: string | null;
  address: string | null;
  phone: string | null;
  isActive: boolean;
}

interface Division {
  id: string;
  name: string;
  code: string;
  type: string;
  description: string | null;
  isActive: boolean;
  _count: { branches: number };
  branches: Branch[];
}

interface Document {
  id: string;
  title: string;
  mimeType: string;
  createdAt: string;
  ownerType: string;
}

interface CompanyDetail {
  id: string;
  code: string;
  name: string;
  industryType: string | null;
  status: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  createdAt: string;
  group: { id: string; name: string; code: string };
  profile: CompanyProfile | null;
  divisions: Division[];
  documents: Document[];
  _count: {
    divisions: number;
    bankAccounts: number;
    loans: number;
    debts: number;
    contracts: number;
    fixedAssets: number;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  DORMANT: 'bg-slate-100 text-slate-600',
  SUSPENDED: 'bg-amber-100 text-amber-700',
  DISSOLVED: 'bg-red-100 text-red-700',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  );
}

const BRANCH_TYPE_ICONS: Record<string, AppIconName> = {
  BRANCH: 'branch',
  SITE: 'branch',
  PROJECT: 'document',
  FARM: 'inventory',
  WAREHOUSE: 'inventory',
  FUEL_STATION: 'cash',
  OFFICE: 'company',
  PARKING_FACILITY: 'branch',
  HOSPITALITY_FACILITY: 'company',
  OTHER: 'branch',
};

const DIVISION_TYPE_COLORS: Record<string, string> = {
  PETROLEUM: 'bg-orange-50 border-orange-200 text-orange-800',
  LOGISTICS: 'bg-blue-50 border-blue-200 text-blue-800',
  AGRICULTURE: 'bg-green-50 border-green-200 text-green-800',
  CONSTRUCTION: 'bg-amber-50 border-amber-200 text-amber-800',
  BEVERAGES: 'bg-purple-50 border-purple-200 text-purple-800',
  HARDWARE_BUILDING: 'bg-slate-50 border-slate-200 text-slate-800',
  TRUCK_PARKING: 'bg-cyan-50 border-cyan-200 text-cyan-800',
  RENTAL_SHOPS: 'bg-pink-50 border-pink-200 text-pink-800',
  HOSPITALITY: 'bg-indigo-50 border-indigo-200 text-indigo-800',
  REAL_ESTATE: 'bg-teal-50 border-teal-200 text-teal-800',
  OTHER: 'bg-gray-50 border-gray-200 text-gray-800',
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-TZ', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'divisions' | 'documents' | 'profile'>('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [deletingCompany, setDeletingCompany] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function loadCompany(options: { showLoading?: boolean } = {}) {
    if (!id) return;
    const showLoading = options.showLoading ?? !company;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/backend/companies/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setCompany(json.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load company');
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    void loadCompany();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return (
    <>
      <main className="p-6 flex-1 bg-slate-50 min-h-screen">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-1/3" />
          <div className="h-4 bg-slate-100 rounded w-1/2" />
          <div className="grid grid-cols-4 gap-4 mt-6">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 bg-white rounded-xl border border-slate-200" />)}
          </div>
        </div>
      </main>
    </>
  );

  if (error || !company) return (
    <>
      <main className="p-6 flex-1 bg-slate-50 min-h-screen">
        <Card className="p-6">
          <div className="text-red-600">{error ?? 'Company not found'}</div>
          <button onClick={() => router.back()} className="mt-3 text-sm text-blue-600 hover:underline">← Back</button>
        </Card>
      </main>
    </>
  );

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'divisions', label: `Divisions (${company._count.divisions})` },
    { id: 'documents', label: `Documents (${company.documents.length})` },
    { id: 'profile', label: 'Legal Profile' },
  ] as const;

  async function deleteCompany() {
    const targetCompany = company;
    if (!targetCompany) return;
    if (
      !confirm(
        `Delete ${targetCompany.name} from the registry? This archives its divisions and branches/stations so historical records remain intact.`,
      )
    ) {
      return;
    }
    setDeletingCompany(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/backend/companies/${targetCompany.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          (Array.isArray(json?.message) && json.message.join(', ')) ||
          json?.message ||
          `HTTP ${res.status}`;
        throw new Error(message);
      }
      router.push('/companies');
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete company');
    } finally {
      setDeletingCompany(false);
    }
  }

  return (
    <>
      <main className="p-6 flex-1 bg-slate-50 min-h-screen">

        {/* Breadcrumb */}
        <div className="text-xs text-slate-400 mb-4 flex items-center gap-1.5">
          <Link href="/companies" className="hover:text-blue-600">Companies</Link>
          <span>/</span>
          <span className="text-slate-600">{company.name}</span>
        </div>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{company.name}</h1>
              <StatusBadge status={company.status} />
            </div>
            <div className="text-sm text-slate-500 mt-1 flex items-center gap-3">
              <span className="font-mono">{company.code}</span>
              {company.industryType && <span>· {company.industryType}</span>}
              <span>· {company.group.name}</span>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {hasPermission('companies.update') && (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Edit Company
              </button>
            )}
            {hasPermission('companies.delete') && (
              <button
                type="button"
                onClick={deleteCompany}
                disabled={deletingCompany}
                className="px-3 py-1.5 text-sm border border-red-200 rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                {deletingCompany ? 'Deleting...' : 'Delete Company'}
              </button>
            )}
            {/* Link to Group Control for sensitive records */}
            {hasPermission('bank-accounts.read') && (
              <Link
                href={`/group-control?companyId=${company.id}`}
                className="px-3 py-1.5 text-sm bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors flex items-center gap-1.5"
              >
                <AppIcon name="lock" size={14} />
                Sensitive Records
              </Link>
            )}
          </div>
        </div>

        {deleteError && (
          <Card className="p-3 mb-5 border-red-200 bg-red-50 text-sm text-red-700">
            {deleteError}
          </Card>
        )}

        {/* Summary Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {[
            { label: 'Divisions', value: company._count.divisions, icon: 'company' as AppIconName },
            { label: 'Bank Accounts', value: company._count.bankAccounts, icon: 'bank' as AppIconName, sensitive: true },
            { label: 'Loans', value: company._count.loans, icon: 'loan' as AppIconName, sensitive: true },
            { label: 'Debts', value: company._count.debts, icon: 'trendDown' as AppIconName, sensitive: true },
            { label: 'Contracts', value: company._count.contracts, icon: 'document' as AppIconName, sensitive: true },
            { label: 'Fixed Assets', value: company._count.fixedAssets, icon: 'inventory' as AppIconName, sensitive: true },
          ].map(({ label, value, icon, sensitive }) => {
            if (sensitive && !hasPermission('bank-accounts.read')) return null;
            return (
              <Card key={label} className="p-3 text-center">
                <AppIcon name={icon} size={22} className="mx-auto text-slate-500" />
                <div className="text-xl font-bold text-slate-900 mt-0.5">{value}</div>
                <div className="text-xs text-slate-400">{label}</div>
              </Card>
            );
          })}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-200 mb-5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && <OverviewTab company={company} />}
        {activeTab === 'divisions' && (
          <DivisionsTab companyId={company.id} divisions={company.divisions} onChanged={loadCompany} />
        )}
        {activeTab === 'documents' && <DocumentsTab documents={company.documents} companyId={company.id} />}
        {activeTab === 'profile' && (
          <LegalProfileTab
            profile={company.profile}
            companyId={company.id}
            companyName={company.name}
            onChanged={loadCompany}
          />
        )}

        {hasPermission('companies.update') && (
          <EditCompanyModal
            open={editOpen}
            company={company}
            onClose={() => setEditOpen(false)}
            onSaved={() => {
              setEditOpen(false);
              void loadCompany({ showLoading: false });
            }}
          />
        )}
      </main>
    </>
  );
}

// ── Edit Company Modal ────────────────────────────────────────────────────────

interface EditCompanyModalProps {
  open: boolean;
  company: CompanyDetail;
  onClose: () => void;
  onSaved: () => void;
}

function EditCompanyModal({ open, company, onClose, onSaved }: EditCompanyModalProps) {
  const [form, setForm] = useState({
    name: company.name,
    code: company.code,
    industryType: company.industryType ?? '',
    status: company.status,
    phone: company.phone ?? '',
    email: company.email ?? '',
    website: company.website ?? '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset form whenever the modal opens for a (potentially) different record.
  useEffect(() => {
    if (open) {
      setForm({
        name: company.name,
        code: company.code,
        industryType: company.industryType ?? '',
        status: company.status,
        phone: company.phone ?? '',
        email: company.email ?? '',
        website: company.website ?? '',
      });
      setSubmitError(null);
    }
  }, [open, company]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Send only fields that actually changed; the backend DTO is PartialType
      // so it accepts any subset. Empty strings on optional fields become undefined
      // rather than being sent — sending '' would fail @IsEmail / @IsUrl validation.
      const payload: Record<string, string | undefined> = {};
      if (form.name !== company.name) payload.name = form.name;
      if (form.code !== company.code) payload.code = form.code;
      if (form.industryType !== (company.industryType ?? '')) {
        payload.industryType = form.industryType.trim() || undefined;
      }
      if (form.status !== company.status) payload.status = form.status;
      if (form.phone !== (company.phone ?? '')) {
        payload.phone = form.phone.trim() || undefined;
      }
      if (form.email !== (company.email ?? '')) {
        payload.email = form.email.trim() || undefined;
      }
      if (form.website !== (company.website ?? '')) {
        payload.website = form.website.trim() || undefined;
      }

      if (Object.keys(payload).length === 0) {
        onClose();
        return;
      }

      const res = await fetch(`/api/backend/companies/${company.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          (Array.isArray(json?.message) && json.message.join(', ')) ||
          json?.message ||
          `HTTP ${res.status}`;
        throw new Error(message);
      }
      onSaved();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to save changes');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => (submitting ? undefined : onClose())}
      title="Edit Company"
      description="Update the company's display details. Legal-profile changes (BRELA, TIN, address) live on the Legal Profile tab."
      size="lg"
    >
      <form onSubmit={onSubmit} className="p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormInput
            label="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <FormInput
            label="Code"
            required
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            help="Short identifier — used in document numbering."
          />
          <FormInput
            label="Industry"
            value={form.industryType}
            onChange={(e) => setForm({ ...form, industryType: e.target.value })}
            placeholder="e.g. Petroleum, Wholesale, Logistics"
          />
          <FormSelect
            label="Status"
            required
            options={STATUS_OPTIONS}
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          />
          <FormInput
            label="Phone"
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <FormInput
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <FormInput
            label="Website"
            type="url"
            value={form.website}
            onChange={(e) => setForm({ ...form, website: e.target.value })}
            placeholder="https://"
            className="sm:col-span-2"
          />
        </div>

        {submitError && (
          <div
            role="alert"
            className="text-sm rounded-lg p-3 border"
            style={{
              color: 'var(--aurora-danger)',
              borderColor: 'var(--aurora-danger)',
              background: 'var(--aurora-danger-bg, #fef2f2)',
            }}
          >
            {submitError}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--aurora-border)' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ company }: { company: CompanyDetail }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Company info */}
      <Card className="p-5">
        <h3 className="font-semibold text-slate-900 mb-4">Company Information</h3>
        <dl className="space-y-2.5 text-sm">
          <ProfileRow label="Name" value={company.name} />
          <ProfileRow label="Code" value={company.code} mono />
          <ProfileRow label="Industry" value={company.industryType} />
          <ProfileRow label="Status" value={<StatusBadge status={company.status} />} />
          <ProfileRow label="Group" value={company.group.name} />
          <ProfileRow label="Email" value={company.email} />
          <ProfileRow label="Phone" value={company.phone} />
          {company.website && (
            <div className="flex gap-3">
              <dt className="text-slate-500 w-32 shrink-0">Website</dt>
              <dd><a href={company.website} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs">{company.website}</a></dd>
            </div>
          )}
          <ProfileRow label="Registered" value={formatDate(company.createdAt)} />
        </dl>
      </Card>

      {/* Quick legal summary */}
      <Card className="p-5">
        <h3 className="font-semibold text-slate-900 mb-4">Legal Summary</h3>
        {company.profile ? (
          <dl className="space-y-2.5 text-sm">
            <ProfileRow label="Legal Name" value={company.profile.registeredName} />
            <ProfileRow label="Trading Name" value={company.profile.tradingName} />
            <ProfileRow label="BRELA No." value={company.profile.brelaRegNumber} mono />
            <ProfileRow label="TIN" value={company.profile.tin} mono />
            <ProfileRow label="VRN" value={company.profile.vrn} mono />
            <ProfileRow label="Tax Office" value={company.profile.taxOffice} />
            <ProfileRow label="Incorporated" value={formatDate(company.profile.incorporationDate)} />
            <ProfileRow label="Biz License" value={company.profile.businessLicenseNumber} mono />
          </dl>
        ) : (
          <div className="text-sm text-amber-600 flex items-center gap-2">
            <AppIcon name="alert" size={15} />
            Legal profile not yet configured.
          </div>
        )}
      </Card>
    </div>
  );
}

function ProfileRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  if (!value && value !== 0) return (
    <div className="flex gap-3">
      <dt className="text-slate-400 w-32 shrink-0">{label}</dt>
      <dd className="text-slate-300">—</dd>
    </div>
  );
  return (
    <div className="flex gap-3">
      <dt className="text-slate-500 w-32 shrink-0">{label}</dt>
      <dd className={`text-slate-800 ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}

// ── Divisions Tab ─────────────────────────────────────────────────────────────

function DivisionsTab({
  companyId,
  divisions,
  onChanged,
}: {
  companyId: string;
  divisions: Division[];
  onChanged: () => void;
}) {
  const { hasPermission } = useAuth();
  const canCreateDivision = hasPermission('divisions.create');
  const canUpdateDivision = hasPermission('divisions.update');
  const canDeleteDivision = hasPermission('divisions.delete');
  const canCreateBranch = hasPermission('branches.create');
  const canUpdateBranch = hasPermission('branches.update');
  const canDeleteBranch = hasPermission('branches.delete');
  const [selectedDivisionId, setSelectedDivisionId] = useState<string | null>(divisions[0]?.id ?? null);
  const [addingDivision, setAddingDivision] = useState(false);
  const [editingDivision, setEditingDivision] = useState<Division | null>(null);
  const [addingForDivision, setAddingForDivision] = useState<Division | null>(null);
  const [editingBranch, setEditingBranch] = useState<{ division: Division; branch: Branch } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (divisions.length === 0) {
      setSelectedDivisionId(null);
      return;
    }
    if (!selectedDivisionId || !divisions.some((division) => division.id === selectedDivisionId)) {
      setSelectedDivisionId(divisions[0].id);
    }
  }, [divisions, selectedDivisionId]);

  const selectedDivision = divisions.find((division) => division.id === selectedDivisionId) ?? divisions[0] ?? null;

  async function setDivisionActive(division: Division, isActive: boolean) {
    if (!isActive && !confirm(`Deactivate division ${division.name}? Its active branches/stations will also be deactivated.`)) return;
    setBusyAction(`division:${division.id}:active`);
    setActionError(null);
    try {
      const res = await fetch(`/api/backend/divisions/${division.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json, res.status));
      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to update division status');
    } finally {
      setBusyAction(null);
    }
  }

  async function archiveDivision(division: Division) {
    if (
      !confirm(
        `Delete division ${division.name} from the registry? This archives its branches/stations so historical records remain intact.`,
      )
    ) {
      return;
    }
    setBusyAction(`division:${division.id}:delete`);
    setActionError(null);
    try {
      const res = await fetch(`/api/backend/divisions/${division.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json, res.status));
      if (selectedDivisionId === division.id) setSelectedDivisionId(null);
      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to delete division');
    } finally {
      setBusyAction(null);
    }
  }

  async function setBranchActive(branch: Branch, isActive: boolean) {
    setBusyAction(`branch:${branch.id}:active`);
    setActionError(null);
    try {
      const res = await fetch(`/api/backend/branches/${branch.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json, res.status));
      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to update branch status');
    } finally {
      setBusyAction(null);
    }
  }

  async function archiveBranch(branch: Branch) {
    if (!confirm(`Delete branch/station ${branch.name} from the registry? Historical records remain intact.`)) return;
    setBusyAction(`branch:${branch.id}:delete`);
    setActionError(null);
    try {
      const res = await fetch(`/api/backend/branches/${branch.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json, res.status));
      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to delete branch');
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <>
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Divisions and branches</h2>
            <p className="text-sm text-slate-500">Registry structure for operating divisions, branches, stations, and sites.</p>
          </div>
          {canCreateDivision && (
            <button
              type="button"
              onClick={() => setAddingDivision(true)}
              className="self-start sm:self-auto px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              + Add Division
            </button>
          )}
        </div>

        {actionError && (
          <div role="alert" className="text-sm rounded-lg p-3 border border-red-200 bg-red-50 text-red-700">
            {actionError}
          </div>
        )}

        {divisions.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="text-slate-400 text-sm">No divisions configured for this company.</div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] gap-5">
            <div className="space-y-3">
              {divisions.map((division) => {
                const selected = selectedDivision?.id === division.id;
                return (
                  <Card key={division.id} className={`p-4 transition-colors ${selected ? 'border-blue-300 bg-blue-50/60' : ''}`}>
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        data-testid={`division-select-${division.code}`}
                        onClick={() => setSelectedDivisionId(division.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-slate-900">{division.name}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded border font-medium ${DIVISION_TYPE_COLORS[division.type] ?? DIVISION_TYPE_COLORS.OTHER}`}>
                            {enumLabel(division.type)}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${division.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                            {division.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="text-xs font-mono text-slate-400 mt-0.5">{division.code}</div>
                        {division.description && (
                          <p className="text-sm text-slate-600 mt-2 line-clamp-2">{division.description}</p>
                        )}
                        <div className="mt-3 text-xs text-slate-500">
                          {division._count.branches} branch{division._count.branches !== 1 ? 'es' : ''}
                        </div>
                      </button>
                      <div className="flex shrink-0 flex-col gap-1.5">
                        <button
                          type="button"
                          data-testid={`division-view-${division.code}`}
                          onClick={() => setSelectedDivisionId(division.id)}
                          className="px-2.5 py-1 text-xs border border-slate-200 rounded-md text-slate-700 hover:bg-white transition-colors"
                        >
                          View
                        </button>
                        {canUpdateDivision && (
                          <>
                            <button
                              type="button"
                              data-testid={`division-edit-${division.code}`}
                              onClick={() => setEditingDivision(division)}
                              className="px-2.5 py-1 text-xs border border-slate-200 rounded-md text-slate-700 hover:bg-white transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              data-testid={`division-toggle-${division.code}`}
                              onClick={() => setDivisionActive(division, !division.isActive)}
                              disabled={busyAction === `division:${division.id}:active`}
                              className="px-2.5 py-1 text-xs border border-slate-200 rounded-md text-slate-700 hover:bg-white disabled:opacity-50 transition-colors"
                            >
                              {busyAction === `division:${division.id}:active`
                                ? 'Saving'
                                : division.isActive
                                  ? 'Deactivate'
                                  : 'Activate'}
                            </button>
                          </>
                        )}
                        {canDeleteDivision && (
                          <button
                            type="button"
                            data-testid={`division-archive-${division.code}`}
                            onClick={() => archiveDivision(division)}
                            disabled={busyAction === `division:${division.id}:delete`}
                            className="px-2.5 py-1 text-xs border border-red-200 rounded-md text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                          >
                            {busyAction === `division:${division.id}:delete` ? 'Deleting' : 'Delete'}
                          </button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>

            <Card className="overflow-hidden">
              {selectedDivision ? (
                <>
                  <div className="p-5 border-b border-slate-100 flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-slate-900">{selectedDivision.name}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${DIVISION_TYPE_COLORS[selectedDivision.type] ?? DIVISION_TYPE_COLORS.OTHER}`}>
                          {enumLabel(selectedDivision.type)}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${selectedDivision.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                          {selectedDivision.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-slate-400 mt-0.5">{selectedDivision.code}</div>
                      {selectedDivision.description && (
                        <p className="text-sm text-slate-600 mt-2">{selectedDivision.description}</p>
                      )}
                    </div>
                    {canCreateBranch && (
                      <button
                        type="button"
                        data-testid="add-branch-button"
                        onClick={() => setAddingForDivision(selectedDivision)}
                        className="self-start px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        + Add Branch
                      </button>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium">Code</th>
                          <th className="px-4 py-3 text-left font-medium">Branch / Station</th>
                          <th className="px-4 py-3 text-left font-medium">Type</th>
                          <th className="px-4 py-3 text-left font-medium">Location</th>
                          <th className="px-4 py-3 text-left font-medium">Contact</th>
                          <th className="px-4 py-3 text-left font-medium">Status</th>
                          <th className="px-4 py-3 text-right font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {selectedDivision.branches.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                              No branches, stations, or sites configured for this division.
                            </td>
                          </tr>
                        ) : (
                          selectedDivision.branches.map((branch) => (
                            <tr key={branch.id} data-testid={`branch-row-${branch.code}`} className="hover:bg-slate-50">
                              <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{branch.code}</td>
                              <td className="px-4 py-3">
                                <div className="font-medium text-slate-900">{branch.name}</div>
                                {branch.address && <div className="text-xs text-slate-500">{branch.address}</div>}
                              </td>
                              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                                <AppIcon
                                  name={BRANCH_TYPE_ICONS[branch.type] ?? 'branch'}
                                  size={14}
                                  className="mr-1.5 inline-block align-[-2px]"
                                />
                                {enumLabel(branch.type)}
                              </td>
                              <td className="px-4 py-3 text-slate-600">{branch.location || '—'}</td>
                              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{branch.phone || '—'}</td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${branch.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                                  {branch.isActive ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex justify-end gap-2">
                                  {canUpdateBranch && (
                                    <>
                                      <button
                                        type="button"
                                        data-testid={`branch-edit-${branch.code}`}
                                        onClick={() => setEditingBranch({ division: selectedDivision, branch })}
                                        className="text-xs text-blue-600 hover:underline"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        data-testid={`branch-toggle-${branch.code}`}
                                        onClick={() => setBranchActive(branch, !branch.isActive)}
                                        disabled={busyAction === `branch:${branch.id}:active` || (!branch.isActive && !selectedDivision.isActive)}
                                        title={!branch.isActive && !selectedDivision.isActive ? 'Activate the parent division first' : undefined}
                                        className="text-xs text-slate-600 hover:underline disabled:opacity-50"
                                      >
                                        {busyAction === `branch:${branch.id}:active`
                                          ? 'Saving'
                                          : branch.isActive
                                            ? 'Deactivate'
                                            : 'Activate'}
                                      </button>
                                    </>
                                  )}
                                  {canDeleteBranch && (
                                    <button
                                      type="button"
                                      data-testid={`branch-archive-${branch.code}`}
                                      onClick={() => archiveBranch(branch)}
                                      disabled={busyAction === `branch:${branch.id}:delete`}
                                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                                    >
                                      {busyAction === `branch:${branch.id}:delete` ? 'Deleting' : 'Delete'}
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="p-8 text-center text-sm text-slate-400">No division selected.</div>
              )}
            </Card>
          </div>
        )}
      </div>

      {addingDivision && (
        <DivisionEditorModal
          companyId={companyId}
          onClose={() => setAddingDivision(false)}
          onSaved={() => {
            setAddingDivision(false);
            onChanged();
          }}
        />
      )}

      {editingDivision && (
        <DivisionEditorModal
          companyId={companyId}
          division={editingDivision}
          onClose={() => setEditingDivision(null)}
          onSaved={() => {
            setEditingDivision(null);
            onChanged();
          }}
        />
      )}

      {addingForDivision && (
        <BranchEditorModal
          division={addingForDivision}
          onClose={() => setAddingForDivision(null)}
          onSaved={() => {
            setAddingForDivision(null);
            onChanged();
          }}
        />
      )}

      {editingBranch && (
        <BranchEditorModal
          division={editingBranch.division}
          branch={editingBranch.branch}
          onClose={() => setEditingBranch(null)}
          onSaved={() => {
            setEditingBranch(null);
            onChanged();
          }}
        />
      )}
    </>
  );
}

function apiErrorMessage(json: Record<string, unknown>, status: number) {
  const message = json?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.trim()) return message;
  return `HTTP ${status}`;
}

function enumLabel(value: string) {
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// ── Division / Branch Modals ─────────────────────────────────────────────────

const DIVISION_TYPES: Array<{ value: string; label: string }> = [
  { value: 'PETROLEUM', label: 'Petroleum' },
  { value: 'LOGISTICS', label: 'Logistics' },
  { value: 'AGRICULTURE', label: 'Agriculture' },
  { value: 'CONSTRUCTION', label: 'Construction' },
  { value: 'BEVERAGES', label: 'Beverages' },
  { value: 'HARDWARE_BUILDING', label: 'Hardware Building' },
  { value: 'TRUCK_PARKING', label: 'Truck Parking' },
  { value: 'RENTAL_SHOPS', label: 'Rental Shops' },
  { value: 'HOSPITALITY', label: 'Hospitality' },
  { value: 'REAL_ESTATE', label: 'Real Estate' },
  { value: 'OTHER', label: 'Other' },
];

const BRANCH_TYPES: Array<{ value: string; label: string }> = [
  { value: 'BRANCH', label: 'Branch' },
  { value: 'SITE', label: 'Site' },
  { value: 'PROJECT', label: 'Project' },
  { value: 'FARM', label: 'Farm' },
  { value: 'WAREHOUSE', label: 'Warehouse' },
  { value: 'FUEL_STATION', label: 'Fuel Station' },
  { value: 'OFFICE', label: 'Office' },
  { value: 'PARKING_FACILITY', label: 'Parking Facility' },
  { value: 'HOSPITALITY_FACILITY', label: 'Hospitality Facility' },
  { value: 'OTHER', label: 'Other' },
];

function DivisionEditorModal({
  companyId,
  division,
  onClose,
  onSaved,
}: {
  companyId: string;
  division?: Division;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!division;
  const [form, setForm] = useState({
    name: division?.name ?? '',
    code: division?.code ?? '',
    type: division?.type ?? 'OTHER',
    description: division?.description ?? '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!form.name.trim() || !form.code.trim()) {
      setSubmitError('Name and code are required.');
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, string | undefined> = {
        name: form.name.trim(),
        code: form.code.trim(),
        type: form.type,
        description: form.description.trim() || undefined,
      };
      if (!editing) payload.companyId = companyId;
      const res = await fetch(editing ? `/api/backend/divisions/${division!.id}` : '/api/backend/divisions', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json, res.status));
      onSaved();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to save division');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={true}
      onClose={() => (submitting ? undefined : onClose())}
      title={editing ? `Edit Division - ${division!.name}` : 'Add Division'}
      description="Create or update the operating division that branches, stations, and sites belong to."
      size="md"
    >
      <form onSubmit={onSubmit} className="p-5 space-y-4">
        <FormInput
          label="Division Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="e.g. Petroleum Division"
        />
        <FormInput
          label="Code"
          required
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          placeholder="e.g. PET"
        />
        <FormSelect
          label="Type"
          required
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value })}
          options={DIVISION_TYPES}
        />
        <FormTextarea
          label="Description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Short description for this division"
        />

        {submitError && (
          <div role="alert" className="text-sm rounded-lg p-3 border border-red-200 bg-red-50 text-red-700">
            {submitError}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--aurora-border)' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Saving...' : editing ? 'Save Division' : 'Create Division'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function defaultBranchTypeForDivision(divisionType: string) {
  if (divisionType === 'PETROLEUM') return 'FUEL_STATION';
  if (divisionType === 'TRUCK_PARKING') return 'PARKING_FACILITY';
  if (divisionType === 'HOSPITALITY') return 'HOSPITALITY_FACILITY';
  if (divisionType === 'LOGISTICS') return 'WAREHOUSE';
  return 'BRANCH';
}

function BranchEditorModal({
  division,
  branch,
  onClose,
  onSaved,
}: {
  division: Division;
  branch?: Branch;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!branch;
  const [form, setForm] = useState({
    name: branch?.name ?? '',
    code: branch?.code ?? '',
    type: branch?.type ?? defaultBranchTypeForDivision(division.type),
    location: branch?.location ?? '',
    address: branch?.address ?? '',
    phone: branch?.phone ?? '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!form.name.trim() || !form.code.trim()) {
      setSubmitError('Name and code are required.');
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, string | undefined> = {
        name: form.name.trim(),
        code: form.code.trim(),
        type: form.type,
        location: form.location.trim() || undefined,
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined,
      };
      if (!editing) payload.divisionId = division.id;
      const res = await fetch(editing ? `/api/backend/branches/${branch!.id}` : '/api/backend/branches', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json, res.status));
      onSaved();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to save branch');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={true}
      onClose={() => (submitting ? undefined : onClose())}
      title={editing ? `Edit Branch - ${branch!.name}` : `Add Branch to ${division.name}`}
      description="Create or update a branch, station, site, warehouse, or office under this division."
      size="md"
    >
      <form onSubmit={onSubmit} className="p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormInput
            label="Branch Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Tunduma Main Station"
            className="sm:col-span-2"
          />
          <FormInput
            label="Code"
            required
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            placeholder="e.g. TDM-01"
          />
          <FormSelect
            label="Type"
            required
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            options={BRANCH_TYPES}
          />
          <FormInput
            label="Location"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            placeholder="e.g. Tunduma, Songwe"
          />
          <FormInput
            label="Phone"
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <FormInput
            label="Address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Street, ward, or plot details"
            className="sm:col-span-2"
          />
        </div>

        {submitError && (
          <div role="alert" className="text-sm rounded-lg p-3 border border-red-200 bg-red-50 text-red-700">
            {submitError}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--aurora-border)' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Saving...' : editing ? 'Save Branch' : 'Create Branch'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Documents Tab ─────────────────────────────────────────────────────────────

function DocumentsTab({ documents, companyId }: { documents: Document[]; companyId: string }) {
  const MIME_ICONS: Record<string, AppIconName> = {
    'application/pdf': 'document',
    'image/jpeg': 'document',
    'image/png': 'document',
    'application/msword': 'document',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  };

  if (documents.length === 0) return (
    <Card className="p-8 text-center">
      <div className="text-slate-400 text-sm">No documents attached to this company yet.</div>
      <div className="text-xs text-slate-300 mt-1">Documents can be uploaded via the Group Control Center.</div>
    </Card>
  );

  return (
    <Card>
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500 border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="px-5 py-3">Document</th>
            <th className="px-5 py-3">Type</th>
            <th className="px-5 py-3">Owner Type</th>
            <th className="px-5 py-3">Uploaded</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {documents.map((doc) => (
            <tr key={doc.id} className="hover:bg-slate-50">
              <td className="px-5 py-3 font-medium text-slate-800">
                <span className="inline-flex items-center gap-2">
                  <AppIcon name={MIME_ICONS[doc.mimeType] ?? 'document'} size={14} />
                  {doc.title}
                </span>
              </td>
              <td className="px-5 py-3 text-slate-500 text-xs font-mono">{doc.mimeType}</td>
              <td className="px-5 py-3 text-slate-500">{doc.ownerType}</td>
              <td className="px-5 py-3 text-slate-500">{formatDate(doc.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ── Legal Profile Tab ─────────────────────────────────────────────────────────

function LegalProfileTab({
  profile,
  companyId,
  companyName,
  onChanged,
}: {
  profile: CompanyProfile | null;
  companyId: string;
  companyName: string;
  onChanged: () => void;
}) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('company-profiles.update');
  const [editorOpen, setEditorOpen] = useState(false);

  if (!profile) {
    return (
      <>
        <Card className="p-8">
          <div className="text-center mb-4">
            <AppIcon name="document" size={36} className="mx-auto mb-2 text-slate-400" />
            <div className="font-semibold text-slate-700">No Legal Profile</div>
            <div className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
              This company does not yet have a legal profile configured. Add the BRELA
              registration details, TIN, registered address, and other statutory information here.
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => setEditorOpen(true)}
                className="mt-5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                + Add Legal Profile
              </button>
            )}
          </div>
        </Card>

        {editorOpen && (
          <LegalProfileEditorModal
            companyId={companyId}
            companyName={companyName}
            profile={null}
            onClose={() => setEditorOpen(false)}
            onSaved={() => {
              setEditorOpen(false);
              onChanged();
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {canEdit && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Edit Legal Profile
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card className="p-5">
            <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <AppIcon name="document" size={16} />
              Registration Details
            </h3>
            <dl className="space-y-2.5 text-sm">
              <ProfileRow label="Registered Name" value={profile.registeredName} />
              <ProfileRow label="Trading Name" value={profile.tradingName} />
              <ProfileRow label="BRELA No." value={profile.brelaRegNumber} mono />
              <ProfileRow label="TIN" value={profile.tin} mono />
              <ProfileRow label="VRN" value={profile.vrn} mono />
              <ProfileRow label="Business License" value={profile.businessLicenseNumber} mono />
              <ProfileRow label="Incorporation Date" value={formatDate(profile.incorporationDate)} />
              <ProfileRow label="Status" value={<StatusBadge status={profile.status} />} />
            </dl>
          </Card>

          <Card className="p-5">
            <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <AppIcon name="company" size={16} />
              Address & Tax
            </h3>
            <dl className="space-y-2.5 text-sm">
              <ProfileRow label="Registered Address" value={profile.registeredAddress} />
              <ProfileRow label="Postal Address" value={profile.postalAddress} />
              <ProfileRow label="Tax Office" value={profile.taxOffice} />
              <ProfileRow label="Nature of Business" value={profile.natureOfBusiness} />
              {profile.authorizedCapital && (
                <ProfileRow
                  label="Authorized Capital"
                  value={`${profile.currency} ${parseFloat(profile.authorizedCapital).toLocaleString('en-TZ')}`}
                />
              )}
              {profile.notes && (
                <div>
                  <dt className="text-slate-500 mb-1">Notes</dt>
                  <dd className="text-slate-700 text-xs bg-slate-50 p-2 rounded border border-slate-100">{profile.notes}</dd>
                </div>
              )}
            </dl>
          </Card>
        </div>
      </div>

      {editorOpen && (
        <LegalProfileEditorModal
          companyId={companyId}
          companyName={companyName}
          profile={profile}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}

// ── Legal Profile Editor Modal ────────────────────────────────────────────────

const CURRENCY_OPTIONS = ['TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX'].map((c) => ({
  value: c,
  label: c,
}));

const COMPANY_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'DORMANT', label: 'Dormant' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'DISSOLVED', label: 'Dissolved' },
];

interface LegalProfileEditorModalProps {
  companyId: string;
  companyName: string;
  profile: CompanyProfile | null;
  onClose: () => void;
  onSaved: () => void;
}

function LegalProfileEditorModal({
  companyId,
  companyName,
  profile,
  onClose,
  onSaved,
}: LegalProfileEditorModalProps) {
  const isCreate = !profile;
  const [form, setForm] = useState({
    registeredName: profile?.registeredName ?? companyName,
    tradingName: profile?.tradingName ?? '',
    brelaRegNumber: profile?.brelaRegNumber ?? '',
    tin: profile?.tin ?? '',
    vrn: profile?.vrn ?? '',
    businessLicenseNumber: profile?.businessLicenseNumber ?? '',
    incorporationDate: profile?.incorporationDate?.slice(0, 10) ?? '',
    registeredAddress: profile?.registeredAddress ?? '',
    postalAddress: profile?.postalAddress ?? '',
    taxOffice: profile?.taxOffice ?? '',
    natureOfBusiness: profile?.natureOfBusiness ?? '',
    authorizedCapital: profile?.authorizedCapital ?? '',
    currency: profile?.currency ?? 'TZS',
    status: profile?.status ?? 'ACTIVE',
    notes: profile?.notes ?? '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    // Required fields per UpsertCompanyProfileDto.
    if (!form.registeredName.trim() || !form.brelaRegNumber.trim() || !form.tin.trim() || !form.registeredAddress.trim()) {
      setSubmitError('Registered Name, BRELA No., TIN, and Registered Address are required.');
      return;
    }

    setSubmitting(true);
    try {
      // Build the payload — strip empty optional strings to undefined so the
      // backend's @IsString() validator (when present) doesn't reject `''`.
      const payload: Record<string, unknown> = {
        registeredName: form.registeredName.trim(),
        brelaRegNumber: form.brelaRegNumber.trim(),
        tin: form.tin.trim(),
        registeredAddress: form.registeredAddress.trim(),
      };
      const optStr = (v: string) => (v.trim() === '' ? undefined : v.trim());
      payload.tradingName = optStr(form.tradingName);
      payload.vrn = optStr(form.vrn);
      payload.businessLicenseNumber = optStr(form.businessLicenseNumber);
      payload.postalAddress = optStr(form.postalAddress);
      payload.taxOffice = optStr(form.taxOffice);
      payload.natureOfBusiness = optStr(form.natureOfBusiness);
      payload.notes = optStr(form.notes);
      if (form.incorporationDate) payload.incorporationDate = form.incorporationDate;
      if (form.authorizedCapital !== '' && form.authorizedCapital !== null) {
        // Backend expects a stringified decimal.
        payload.authorizedCapital = String(form.authorizedCapital);
      }
      if (form.currency) payload.currency = form.currency;
      if (form.status) payload.status = form.status;

      const res = await fetch(`/api/backend/companies/${companyId}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          (Array.isArray(json?.message) && json.message.join(', ')) ||
          json?.message ||
          `HTTP ${res.status}`;
        throw new Error(message);
      }
      onSaved();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to save legal profile');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={true}
      onClose={() => (submitting ? undefined : onClose())}
      title={isCreate ? `Add Legal Profile — ${companyName}` : `Edit Legal Profile — ${companyName}`}
      description="BRELA, TIN, statutory address, and tax-office details."
      size="lg"
    >
      <form onSubmit={onSubmit} className="flex flex-col max-h-[80vh]">
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        <section>
          <h4 className="text-sm font-semibold text-slate-800 mb-3">Registration</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormInput
              label="Registered Name"
              required
              value={form.registeredName}
              onChange={(e) => setForm({ ...form, registeredName: e.target.value })}
              help="Exact name on the BRELA certificate."
            />
            <FormInput
              label="Trading Name"
              value={form.tradingName}
              onChange={(e) => setForm({ ...form, tradingName: e.target.value })}
              help="Optional. Public-facing name if different from registered."
            />
            <FormInput
              label="BRELA No."
              required
              value={form.brelaRegNumber}
              onChange={(e) => setForm({ ...form, brelaRegNumber: e.target.value })}
            />
            <FormInput
              label="TIN"
              required
              value={form.tin}
              onChange={(e) => setForm({ ...form, tin: e.target.value })}
            />
            <FormInput
              label="VRN"
              value={form.vrn}
              onChange={(e) => setForm({ ...form, vrn: e.target.value })}
              help="VAT registration number, if registered for VAT."
            />
            <FormInput
              label="Business License Number"
              value={form.businessLicenseNumber}
              onChange={(e) => setForm({ ...form, businessLicenseNumber: e.target.value })}
            />
            <FormInput
              label="Incorporation Date"
              type="date"
              value={form.incorporationDate}
              onChange={(e) => setForm({ ...form, incorporationDate: e.target.value })}
            />
            <FormSelect
              label="Status"
              required
              options={COMPANY_STATUS_OPTIONS}
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            />
          </div>
        </section>

        <section>
          <h4 className="text-sm font-semibold text-slate-800 mb-3">Address & Tax</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormInput
              label="Registered Address"
              required
              value={form.registeredAddress}
              onChange={(e) => setForm({ ...form, registeredAddress: e.target.value })}
              className="sm:col-span-2"
            />
            <FormInput
              label="Postal Address"
              value={form.postalAddress}
              onChange={(e) => setForm({ ...form, postalAddress: e.target.value })}
            />
            <FormInput
              label="Tax Office"
              value={form.taxOffice}
              onChange={(e) => setForm({ ...form, taxOffice: e.target.value })}
              help="e.g. Ilala Tax Region, TRA Mwanza"
            />
            <FormInput
              label="Nature of Business"
              value={form.natureOfBusiness}
              onChange={(e) => setForm({ ...form, natureOfBusiness: e.target.value })}
              className="sm:col-span-2"
              help="Free-text description per the BRELA filing."
            />
          </div>
        </section>

        <section>
          <h4 className="text-sm font-semibold text-slate-800 mb-3">Capital</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormInput
              label="Authorized Capital"
              type="number"
              step="0.01"
              value={form.authorizedCapital}
              onChange={(e) => setForm({ ...form, authorizedCapital: e.target.value })}
              className="sm:col-span-2"
            />
            <FormSelect
              label="Currency"
              options={CURRENCY_OPTIONS}
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            />
          </div>
        </section>

        <section>
          <h4 className="text-sm font-semibold text-slate-800 mb-3">Notes</h4>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
            placeholder="Internal notes — only visible to authorized users."
            className="aurora-input w-full px-3 py-2 text-sm rounded-lg"
          />
        </section>

        {submitError && (
          <div
            role="alert"
            className="text-sm rounded-lg p-3 border"
            style={{
              color: 'var(--aurora-danger)',
              borderColor: 'var(--aurora-danger)',
              background: 'var(--aurora-danger-bg, #fef2f2)',
            }}
          >
            {submitError}
          </div>
        )}
        </div>

        <div
          className="flex-shrink-0 flex justify-end gap-2 px-5 py-3 border-t"
          style={{
            borderColor: 'var(--aurora-border)',
            background: 'var(--aurora-bg-subtle)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Saving…' : isCreate ? 'Create Legal Profile' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
