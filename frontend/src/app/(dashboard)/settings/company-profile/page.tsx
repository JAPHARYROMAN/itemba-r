'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, FormInput, FormSelect, FormTextarea, DateInput, Btn } from '@/components/ui';

interface Company { id: string; name: string; code: string; }

interface CompanyProfile {
  id?: string;
  companyId?: string;
  registeredName: string;
  tradingName?: string;
  brelaRegNumber: string;
  tin: string;
  vrn?: string;
  businessLicenseNumber?: string;
  incorporationDate?: string;
  registeredAddress: string;
  postalAddress?: string;
  taxOffice?: string;
  natureOfBusiness?: string;
  authorizedCapital?: string;
  currency?: string;
  status?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

const CURRENCIES = [
  { value: 'TZS', label: 'TZS — Tanzanian Shilling' },
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'KES', label: 'KES — Kenyan Shilling' },
  { value: 'UGX', label: 'UGX — Ugandan Shilling' },
];

const STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'SUSPENDED', label: 'Suspended' },
];

const EMPTY_PROFILE: CompanyProfile = {
  registeredName: '',
  tradingName: '',
  brelaRegNumber: '',
  tin: '',
  vrn: '',
  businessLicenseNumber: '',
  incorporationDate: '',
  registeredAddress: '',
  postalAddress: '',
  taxOffice: '',
  natureOfBusiness: '',
  authorizedCapital: '',
  currency: 'TZS',
  status: 'ACTIVE',
  notes: '',
};

export default function CompanyProfilePage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [profile, setProfile] = useState<CompanyProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [isNew, setIsNew] = useState(false);

  // Load companies once.
  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => {
        const inner = j.data?.data ?? j.data;
        const rows: Company[] = Array.isArray(inner) ? inner : Array.isArray(inner?.data) ? inner.data : [];
        setCompanies(rows);
      })
      .catch(() => {});
  }, []);

  const loadProfile = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError(''); setInfo('');
    try {
      const res = await fetch(`/api/backend/companies/${companyId}/profile`);
      if (res.status === 404) {
        // Profile doesn't exist yet — start with empty. Keep companyId so save creates it.
        setProfile({ ...EMPTY_PROFILE });
        setIsNew(true);
        setInfo('No profile yet — fill in the legal details and save to create one.');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const data = json.data ?? json;
      setProfile({
        ...EMPTY_PROFILE,
        ...data,
        incorporationDate: data.incorporationDate ? String(data.incorporationDate).slice(0, 10) : '',
        authorizedCapital: data.authorizedCapital !== null && data.authorizedCapital !== undefined ? String(data.authorizedCapital) : '',
      });
      setIsNew(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const update = <K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) => {
    setProfile((p) => ({ ...p, [key]: value }));
    setInfo('');
  };

  const save = async () => {
    if (!companyId) return;
    setSaving(true); setError(''); setInfo('');
    try {
      const body: Record<string, unknown> = { ...profile };
      // Strip undefined / empty optional strings the backend doesn't want.
      if (!body.tradingName) delete body.tradingName;
      if (!body.vrn) delete body.vrn;
      if (!body.businessLicenseNumber) delete body.businessLicenseNumber;
      if (!body.incorporationDate) delete body.incorporationDate;
      if (!body.postalAddress) delete body.postalAddress;
      if (!body.taxOffice) delete body.taxOffice;
      if (!body.natureOfBusiness) delete body.natureOfBusiness;
      if (!body.authorizedCapital) delete body.authorizedCapital;
      if (!body.notes) delete body.notes;
      // Drop server-managed fields.
      delete body.id;
      delete body.companyId;
      delete body.createdAt;
      delete body.updatedAt;

      const res = await fetch(`/api/backend/companies/${companyId}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${res.status}`);
      }
      setInfo(isNew ? 'Profile created.' : 'Profile saved.');
      setIsNew(false);
      // Re-fetch to surface server-side normalized values.
      await loadProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Company Profile"
        subtitle="Legal identity, tax registration, and currency for a single company."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Company Profile' }]}
        actions={
          <div className="flex items-center gap-2">
            <Btn variant="secondary" onClick={loadProfile} disabled={!companyId || loading}>Reload</Btn>
            <Btn onClick={save} disabled={!companyId || saving || loading}>{saving ? 'Saving…' : isNew ? 'Create Profile' : 'Save'}</Btn>
          </div>
        }
      />

      <Card className="p-4">
        <FormSelect
          label="Company"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          required
          placeholder="— Select Company —"
          options={companies.map((c) => ({ value: c.id, label: c.name }))}
        />
      </Card>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {info && <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700">{info}</div>}
      {loading && <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}

      {companyId && !loading && (
        <>
          <Card className="p-5 space-y-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Legal identity</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormInput
                label="Registered Name"
                value={profile.registeredName}
                onChange={(e) => update('registeredName', e.target.value)}
                required
              />
              <FormInput
                label="Trading Name"
                value={profile.tradingName ?? ''}
                onChange={(e) => update('tradingName', e.target.value)}
                hint="As-marketed name if different from registered."
              />
              <FormInput
                label="BRELA Reg. Number"
                value={profile.brelaRegNumber}
                onChange={(e) => update('brelaRegNumber', e.target.value)}
                required
              />
              <FormInput
                label="Business License No."
                value={profile.businessLicenseNumber ?? ''}
                onChange={(e) => update('businessLicenseNumber', e.target.value)}
              />
              <DateInput
                label="Incorporation Date"
                value={profile.incorporationDate ?? ''}
                onChange={(e) => update('incorporationDate', e.target.value)}
              />
              <FormInput
                label="Nature of Business"
                value={profile.natureOfBusiness ?? ''}
                onChange={(e) => update('natureOfBusiness', e.target.value)}
              />
            </div>
          </Card>

          <Card className="p-5 space-y-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Tax registration</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormInput
                label="TIN"
                value={profile.tin}
                onChange={(e) => update('tin', e.target.value)}
                required
                hint="Taxpayer Identification Number (TRA)."
              />
              <FormInput
                label="VRN"
                value={profile.vrn ?? ''}
                onChange={(e) => update('vrn', e.target.value)}
                hint="VAT Registration Number — only if VAT-registered."
              />
              <FormInput
                label="Tax Office"
                value={profile.taxOffice ?? ''}
                onChange={(e) => update('taxOffice', e.target.value)}
                hint="The TRA office that handles this company."
              />
            </div>
          </Card>

          <Card className="p-5 space-y-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Address</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormTextarea
                label="Registered Address"
                value={profile.registeredAddress}
                onChange={(e) => update('registeredAddress', e.target.value)}
                required
                rows={2}
              />
              <FormTextarea
                label="Postal Address"
                value={profile.postalAddress ?? ''}
                onChange={(e) => update('postalAddress', e.target.value)}
                rows={2}
              />
            </div>
          </Card>

          <Card className="p-5 space-y-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Financial defaults</div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <FormSelect
                label="Default Currency"
                value={profile.currency ?? 'TZS'}
                onChange={(e) => update('currency', e.target.value)}
                options={CURRENCIES}
              />
              <FormInput
                label="Authorized Capital"
                value={profile.authorizedCapital ?? ''}
                onChange={(e) => update('authorizedCapital', e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
              />
              <FormSelect
                label="Status"
                value={profile.status ?? 'ACTIVE'}
                onChange={(e) => update('status', e.target.value)}
                options={STATUSES}
              />
            </div>
          </Card>

          <Card className="p-5 space-y-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</div>
            <FormTextarea
              value={profile.notes ?? ''}
              onChange={(e) => update('notes', e.target.value)}
              rows={3}
              placeholder="Internal notes about this company's setup, regulatory caveats, etc."
            />
          </Card>

          {profile.updatedAt && (
            <div className="text-[11px] text-slate-400">
              Last updated {new Date(profile.updatedAt).toLocaleString()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
