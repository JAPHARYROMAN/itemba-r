'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { Building2, Eye, FileText, Landmark, MapPin, RefreshCw, RotateCcw, Save, Upload } from 'lucide-react';
import { Card, PageHeader, FormInput, FormSelect, FormTextarea, DateInput, Btn } from '@/components/ui';
import { backendGet, backendPage, backendPatch, backendPut, backendUpload } from '@/lib/api-client';
import { documentOrganization } from '@/components/documents';

interface CompanySummary {
  id: string;
  name: string;
  code: string;
}

interface CompanyDetail extends CompanySummary {
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  group?: {
    id: string;
    name?: string | null;
    code?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
  } | null;
  profile?: CompanyProfile | null;
  divisions?: Array<{
    id: string;
    name: string;
    branches?: Branch[];
  }>;
}

interface Branch {
  id: string;
  name?: string | null;
  code?: string | null;
  location?: string | null;
  address?: string | null;
  phone?: string | null;
  isActive?: boolean;
}

interface CompanyIdentityForm {
  name: string;
  phone: string;
  email: string;
  website: string;
  logoUrl: string;
}

interface BranchForm {
  name: string;
  location: string;
  address: string;
  phone: string;
}

interface CompanyProfile {
  id?: string;
  companyId?: string;
  registeredName: string;
  tradingName?: string | null;
  brelaRegNumber: string;
  tin: string;
  vrn?: string | null;
  businessLicenseNumber?: string | null;
  incorporationDate?: string | null;
  registeredAddress: string;
  postalAddress?: string | null;
  taxOffice?: string | null;
  natureOfBusiness?: string | null;
  authorizedCapital?: string | null;
  currency?: string | null;
  status?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface UploadedDocument {
  id: string;
  fileName: string;
  mimeType: string;
}

const CURRENCIES = [
  { value: 'TZS', label: 'TZS - Tanzanian Shilling' },
  { value: 'USD', label: 'USD - US Dollar' },
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'GBP', label: 'GBP - British Pound' },
  { value: 'KES', label: 'KES - Kenyan Shilling' },
  { value: 'UGX', label: 'UGX - Ugandan Shilling' },
];

const STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'SUSPENDED', label: 'Suspended' },
];

const EMPTY_COMPANY: CompanyIdentityForm = {
  name: '',
  phone: '',
  email: '',
  website: '',
  logoUrl: '',
};

const EMPTY_BRANCH: BranchForm = {
  name: '',
  location: '',
  address: '',
  phone: '',
};

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
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [companyForm, setCompanyForm] = useState<CompanyIdentityForm>(EMPTY_COMPANY);
  const [profile, setProfile] = useState<CompanyProfile>(EMPTY_PROFILE);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [branchForm, setBranchForm] = useState<BranchForm>(EMPTY_BRANCH);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [isNewProfile, setIsNewProfile] = useState(false);

  useEffect(() => {
    backendPage<CompanySummary>('/companies', { query: { limit: 100 } })
      .then((page) => setCompanies(page.data))
      .catch(() => setCompanies([]));
  }, []);

  const loadLetterhead = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const detail = await backendGet<CompanyDetail>(`/companies/${companyId}`);
      const flattenedBranches = (detail.divisions ?? [])
        .flatMap((division) => division.branches ?? [])
        .filter((branch) => branch.id);
      const firstBranch = flattenedBranches[0] ?? null;

      setCompany(detail);
      setCompanyForm({
        name: detail.name ?? '',
        phone: detail.phone ?? '',
        email: detail.email ?? '',
        website: detail.website ?? '',
        logoUrl: detail.logoUrl ?? '',
      });
      setProfile(toProfileForm(detail.profile));
      setIsNewProfile(!detail.profile);
      setBranches(flattenedBranches);
      setBranchId(firstBranch?.id ?? '');
      setBranchForm(toBranchForm(firstBranch));
      if (!detail.profile) setInfo('Fill the letterhead fields and save to create this company profile.');
    } catch (err) {
      setCompany(null);
      setBranches([]);
      setBranchId('');
      setError(err instanceof Error ? err.message : 'Failed to load company letterhead');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadLetterhead();
  }, [loadLetterhead]);

  const selectedBranch = branches.find((branch) => branch.id === branchId) ?? null;
  const previewCompany = useMemo(
    () => ({
      ...company,
      ...companyForm,
      profile,
    }),
    [company, companyForm, profile],
  );
  const previewBranch = useMemo(
    () => selectedBranch ? { ...selectedBranch, ...branchForm } : null,
    [branchForm, selectedBranch],
  );
  const organization = documentOrganization(previewCompany, previewBranch);
  const selectedCompanyName = companyForm.name || company?.name || 'No company selected';
  const requiredComplete = Boolean(
    companyForm.name.trim()
      && profile.registeredName.trim()
      && profile.brelaRegNumber.trim()
      && profile.tin.trim()
      && profile.registeredAddress.trim(),
  );
  const letterheadStatus = !companyId
    ? 'Select a company'
    : requiredComplete
      ? isNewProfile ? 'Ready to create' : 'Ready'
      : 'Needs required fields';

  function updateCompany<K extends keyof CompanyIdentityForm>(key: K, value: CompanyIdentityForm[K]) {
    setCompanyForm((current) => ({ ...current, [key]: value }));
    setInfo('');
  }

  function updateProfile<K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
    setInfo('');
  }

  function updateBranch<K extends keyof BranchForm>(key: K, value: BranchForm[K]) {
    setBranchForm((current) => ({ ...current, [key]: value }));
    setInfo('');
  }

  function selectBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    setBranchForm(toBranchForm(branches.find((branch) => branch.id === nextBranchId) ?? null));
    setInfo('');
  }

  function resetDraft() {
    if (!company) return;
    setCompanyForm({
      name: company.name ?? '',
      phone: company.phone ?? '',
      email: company.email ?? '',
      website: company.website ?? '',
      logoUrl: company.logoUrl ?? '',
    });
    setProfile(toProfileForm(company.profile));
    setBranchForm(toBranchForm(selectedBranch));
    setError('');
    setInfo('Unsaved changes were reset to the last loaded company profile.');
  }

  async function uploadLogo(file: File | null) {
    if (!file || !companyId) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setError('Logo must be a PNG or JPEG image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Logo image must be 2 MB or smaller.');
      return;
    }

    setUploadingLogo(true);
    setError('');
    setInfo('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', `${companyForm.name || company?.name || 'Company'} Letterhead Logo`);
      formData.append('category', 'OTHER');
      formData.append('ownerType', 'COMPANY');
      formData.append('ownerId', companyId);
      formData.append('companyId', companyId);
      formData.append('description', 'Company letterhead logo');

      const document = await backendUpload<UploadedDocument>('/documents/upload', formData);
      const logoUrl = `/api/backend/documents/${document.id}/download?inline=1`;
      setCompanyForm((current) => ({ ...current, logoUrl }));
      setCompany((current) => current ? { ...current, logoUrl } : current);
      await backendPatch(`/companies/${companyId}`, { logoUrl });
      setInfo('Logo uploaded and linked to this company.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload logo');
    } finally {
      setUploadingLogo(false);
    }
  }

  async function save() {
    if (!companyId) return;
    if (!companyForm.name.trim()) {
      setError('Company name is required.');
      return;
    }
    if (!profile.registeredName.trim() || !profile.brelaRegNumber.trim() || !profile.tin.trim() || !profile.registeredAddress.trim()) {
      setError('Registered name, BRELA number, TIN, and registered address are required.');
      return;
    }
    if (branchId && !branchForm.name.trim()) {
      setError('Branch name is required when a branch is selected.');
      return;
    }

    setSaving(true);
    setError('');
    setInfo('');
    try {
      await backendPatch(`/companies/${companyId}`, {
        name: cleanRequired(companyForm.name),
        phone: cleanOptional(companyForm.phone),
        email: cleanOptional(companyForm.email),
        website: cleanOptional(companyForm.website),
        logoUrl: cleanOptional(companyForm.logoUrl),
      });

      await backendPut(`/companies/${companyId}/profile`, {
        registeredName: cleanRequired(profile.registeredName),
        tradingName: cleanOptional(profile.tradingName),
        brelaRegNumber: cleanRequired(profile.brelaRegNumber),
        tin: cleanRequired(profile.tin),
        vrn: cleanOptional(profile.vrn),
        businessLicenseNumber: cleanOptional(profile.businessLicenseNumber),
        incorporationDate: cleanOptional(profile.incorporationDate),
        registeredAddress: cleanRequired(profile.registeredAddress),
        postalAddress: cleanOptional(profile.postalAddress),
        taxOffice: cleanOptional(profile.taxOffice),
        natureOfBusiness: cleanOptional(profile.natureOfBusiness),
        authorizedCapital: cleanOptional(profile.authorizedCapital),
        currency: profile.currency || 'TZS',
        status: profile.status || 'ACTIVE',
        notes: cleanOptional(profile.notes),
      });

      if (branchId) {
        await backendPatch(`/branches/${branchId}`, {
          name: cleanRequired(branchForm.name),
          location: cleanOptional(branchForm.location),
          address: cleanOptional(branchForm.address),
          phone: cleanOptional(branchForm.phone),
        });
      }

      setInfo(isNewProfile ? 'Letterhead profile created.' : 'Letterhead settings saved.');
      setIsNewProfile(false);
      await loadLetterhead();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save letterhead settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="Company Letterhead"
        subtitle="Edit the identity used by document previews, generated PDFs, invoices, orders, and print views."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Company Letterhead' }]}
        actions={
          <div className="flex items-center gap-2">
            <Btn
              variant="secondary"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={loadLetterhead}
              disabled={!companyId || loading}
            >
              Reload
            </Btn>
            <Btn
              variant="secondary"
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={resetDraft}
              disabled={!companyId || loading || saving || !company}
            >
              Reset form
            </Btn>
            <Btn
              icon={<Save className="h-3.5 w-3.5" />}
              onClick={save}
              disabled={!companyId || saving || loading}
            >
              {saving ? 'Saving...' : 'Save letterhead'}
            </Btn>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <ProfileSummary
          icon={<Building2 className="h-4 w-4" />}
          label="Selected company"
          value={selectedCompanyName}
          note={company?.code ? `Code ${company.code}` : 'Choose a company to edit its documents.'}
        />
        <ProfileSummary
          icon={<FileText className="h-4 w-4" />}
          label="Letterhead status"
          value={letterheadStatus}
          note="Used on invoices, orders, reports, PDFs, and print views."
        />
        <ProfileSummary
          icon={<MapPin className="h-4 w-4" />}
          label="Branch line"
          value={previewBranch?.name || 'No branch selected'}
          note={branchId ? 'Branch details appear on matching documents.' : 'Optional for group/company documents.'}
        />
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(260px,1fr)_minmax(0,2fr)] lg:items-end">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Start here</div>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Pick the company whose legal identity, logo, contact line, and document header should be maintained.
            </p>
          </div>
          <FormSelect
            label="Company"
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
            required
            placeholder="- Select Company -"
            options={companies.map((item) => ({ value: item.id, label: `${item.name} (${item.code})` }))}
          />
        </div>
      </Card>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {info && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{info}</div>}
      {loading && <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div>}

      {companyId && !loading && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-5">
            <Card className="space-y-4 p-5">
              <SectionTitle
                icon={<Landmark className="h-4 w-4" />}
                title="Brand and contact line"
                description="Controls the logo, company display name, telephone, email, and website printed on documents."
              />
              <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center border border-slate-300 bg-white p-1 text-xs font-bold uppercase text-slate-700">
                    {companyForm.logoUrl ? (
                      <Image
                        src={companyForm.logoUrl}
                        alt="Company logo"
                        width={56}
                        height={56}
                        className="h-full w-full object-contain"
                        unoptimized
                      />
                    ) : (
                      initials(companyForm.name || company?.group?.name || 'IR')
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Managed Logo</div>
                    <div className="text-xs text-slate-500">PNG or JPEG, up to 2 MB.</div>
                  </div>
                </div>
                <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                  <Upload className="h-3.5 w-3.5" />
                  {uploadingLogo ? 'Uploading...' : 'Upload Logo'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="sr-only"
                    disabled={uploadingLogo}
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      event.currentTarget.value = '';
                      void uploadLogo(file);
                    }}
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormInput
                  label="Logo URL or Managed Path"
                  value={companyForm.logoUrl}
                  onChange={(event) => updateCompany('logoUrl', event.target.value)}
                  placeholder="https://itembagrouptz.com/logo.png"
                />
                <FormInput
                  label="Company Display Name"
                  value={companyForm.name}
                  onChange={(event) => updateCompany('name', event.target.value)}
                  required
                  placeholder="Mwanjalisi Oil Company Ltd"
                />
                <FormInput
                  label="Telephone"
                  value={companyForm.phone}
                  onChange={(event) => updateCompany('phone', event.target.value)}
                  placeholder="+255 XXX XXX XXX"
                />
                <FormInput
                  label="Email"
                  value={companyForm.email}
                  onChange={(event) => updateCompany('email', event.target.value)}
                  placeholder="info@itembagrouptz.com"
                />
                <FormInput
                  label="Website"
                  value={companyForm.website}
                  onChange={(event) => updateCompany('website', event.target.value)}
                  placeholder="https://itembagrouptz.com"
                />
                <FormInput
                  label="Group"
                  value={company?.group?.name ?? ''}
                  disabled
                  placeholder="ITEMBA GROUP"
                />
              </div>
            </Card>

            <Card className="space-y-4 p-5">
              <SectionTitle
                icon={<FileText className="h-4 w-4" />}
                title="Legal and tax details"
                description="Required details for formal letterheads and official documents."
              />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormInput
                  label="Registered Name"
                  value={profile.registeredName}
                  onChange={(event) => updateProfile('registeredName', event.target.value)}
                  required
                  placeholder="Mwanjalisi Oil Company Ltd"
                />
                <FormInput
                  label="Trading Name"
                  value={profile.tradingName ?? ''}
                  onChange={(event) => updateProfile('tradingName', event.target.value)}
                  placeholder="Itemba Group"
                />
                <FormInput
                  label="BRELA Reg. Number"
                  value={profile.brelaRegNumber}
                  onChange={(event) => updateProfile('brelaRegNumber', event.target.value)}
                  required
                  placeholder="XXX XXX XXX"
                />
                <FormInput
                  label="TIN"
                  value={profile.tin}
                  onChange={(event) => updateProfile('tin', event.target.value)}
                  required
                  placeholder="XXX XXX XXX"
                />
                <FormInput
                  label="VRN"
                  value={profile.vrn ?? ''}
                  onChange={(event) => updateProfile('vrn', event.target.value)}
                  placeholder="XXX XXX XXX"
                />
                <FormInput
                  label="Business License No."
                  value={profile.businessLicenseNumber ?? ''}
                  onChange={(event) => updateProfile('businessLicenseNumber', event.target.value)}
                  placeholder="XXX XXX XXX"
                />
                <DateInput
                  label="Incorporation Date"
                  value={profile.incorporationDate ?? ''}
                  onChange={(event) => updateProfile('incorporationDate', event.target.value)}
                />
                <FormInput
                  label="Tax Office"
                  value={profile.taxOffice ?? ''}
                  onChange={(event) => updateProfile('taxOffice', event.target.value)}
                  placeholder="TRA office"
                />
              </div>
            </Card>

            <Card className="space-y-4 p-5">
              <SectionTitle
                icon={<Building2 className="h-4 w-4" />}
                title="Address and company defaults"
                description="Registered address, postal line, status, currency, and business description."
              />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormTextarea
                  label="Registered Address"
                  value={profile.registeredAddress}
                  onChange={(event) => updateProfile('registeredAddress', event.target.value)}
                  required
                  rows={2}
                  placeholder="Tunduma - Mpemba Area, Songwe, Tanzania"
                />
                <FormTextarea
                  label="Postal Address"
                  value={profile.postalAddress ?? ''}
                  onChange={(event) => updateProfile('postalAddress', event.target.value)}
                  rows={2}
                  placeholder="P.O. Box ..."
                />
                <FormInput
                  label="Nature of Business"
                  value={profile.natureOfBusiness ?? ''}
                  onChange={(event) => updateProfile('natureOfBusiness', event.target.value)}
                  placeholder="Oil and petroleum products"
                />
                <FormInput
                  label="Authorized Capital"
                  value={profile.authorizedCapital ?? ''}
                  onChange={(event) => updateProfile('authorizedCapital', event.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                />
                <FormSelect
                  label="Default Currency"
                  value={profile.currency ?? 'TZS'}
                  onChange={(event) => updateProfile('currency', event.target.value)}
                  options={CURRENCIES}
                />
                <FormSelect
                  label="Status"
                  value={profile.status ?? 'ACTIVE'}
                  onChange={(event) => updateProfile('status', event.target.value)}
                  options={STATUSES}
                />
              </div>
            </Card>

            <Card className="space-y-4 p-5">
              <SectionTitle
                icon={<MapPin className="h-4 w-4" />}
                title="Branch line"
                description="Optional branch-specific name, location, phone, and address for branch documents."
              />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormSelect
                  label="Branch"
                  value={branchId}
                  onChange={(event) => selectBranch(event.target.value)}
                  placeholder="- No branch -"
                  options={branches.map((branch) => ({ value: branch.id, label: branch.name ?? branch.code ?? branch.id }))}
                />
                <FormInput
                  label="Branch Name"
                  value={branchForm.name}
                  onChange={(event) => updateBranch('name', event.target.value)}
                  disabled={!branchId}
                  placeholder="Tunduma Main Branch"
                />
                <FormInput
                  label="Branch Location"
                  value={branchForm.location}
                  onChange={(event) => updateBranch('location', event.target.value)}
                  disabled={!branchId}
                  placeholder="Tunduma"
                />
                <FormInput
                  label="Branch Phone"
                  value={branchForm.phone}
                  onChange={(event) => updateBranch('phone', event.target.value)}
                  disabled={!branchId}
                  placeholder="+255 XXX XXX XXX"
                />
                <FormTextarea
                  label="Branch Address"
                  value={branchForm.address}
                  onChange={(event) => updateBranch('address', event.target.value)}
                  disabled={!branchId}
                  rows={2}
                  className="md:col-span-2"
                  placeholder="Tunduma - Mpemba Area, Songwe, Tanzania"
                />
              </div>
            </Card>

            <Card className="space-y-4 p-5">
              <SectionTitle
                icon={<FileText className="h-4 w-4" />}
                title="Internal notes"
                description="Notes are for administrators only and do not print on customer documents."
              />
              <FormTextarea
                value={profile.notes ?? ''}
                onChange={(event) => updateProfile('notes', event.target.value)}
                rows={3}
                placeholder="Internal notes"
              />
            </Card>
          </div>

          <div className="xl:sticky xl:top-5 xl:self-start">
            <LetterheadPreview organization={organization} />
          </div>
        </div>
      )}
    </div>
  );
}

function LetterheadPreview({ organization }: { organization: ReturnType<typeof documentOrganization> }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Eye className="h-4 w-4" />
        Preview
      </div>
      <div className="border border-slate-200 bg-white p-5 text-slate-900 shadow-sm">
        <div className="flex gap-4 border-b-2 border-slate-900 pb-4">
          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center border-2 border-slate-900 p-1 text-sm font-bold uppercase">
            {organization.logoUrl ? (
              <Image
                src={organization.logoUrl}
                alt="Letterhead logo"
                width={64}
                height={64}
                className="h-full w-full object-contain"
                unoptimized
              />
            ) : (
              initials(organization.groupName ?? organization.name)
            )}
          </div>
          <div className="min-w-0 text-xs leading-5">
            <div className="text-lg font-extrabold uppercase leading-tight text-slate-950">{organization.groupName}</div>
            <div className="mt-0.5 text-sm font-bold leading-tight text-slate-900">{organization.name}</div>
            {organization.branchName && <div className="mt-0.5 text-sm text-slate-700">{organization.branchName}</div>}
            {organization.address && <div className="mt-2 text-slate-600">Address: {organization.address}</div>}
            {(organization.phone || organization.email) && (
              <div className="text-slate-600">
                {[organization.phone ? `Tel: ${organization.phone}` : null, organization.email ? `Email: ${organization.email}` : null].filter(Boolean).join(' | ')}
              </div>
            )}
            {(organization.tin || organization.vrn) && (
              <div className="text-slate-600">
                {[organization.tin ? `TIN: ${organization.tin}` : null, organization.vrn ? `VRN: ${organization.vrn}` : null].filter(Boolean).join(' | ')}
              </div>
            )}
          </div>
        </div>
        <div className="mt-5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Document</div>
          <div className="mt-1 text-2xl font-bold text-slate-950">Sales Order</div>
          <div className="mt-1 text-sm text-slate-500">SO-2026-000001</div>
        </div>
      </div>
    </Card>
  );
}

function ProfileSummary({
  icon,
  label,
  value,
  note,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-900">{value}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">{note}</div>
        </div>
      </div>
    </Card>
  );
}

function SectionTitle({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
        {icon}
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function toProfileForm(profile: CompanyProfile | null | undefined): CompanyProfile {
  if (!profile) return { ...EMPTY_PROFILE };
  return {
    ...EMPTY_PROFILE,
    ...profile,
    tradingName: profile.tradingName ?? '',
    vrn: profile.vrn ?? '',
    businessLicenseNumber: profile.businessLicenseNumber ?? '',
    incorporationDate: profile.incorporationDate ? String(profile.incorporationDate).slice(0, 10) : '',
    postalAddress: profile.postalAddress ?? '',
    taxOffice: profile.taxOffice ?? '',
    natureOfBusiness: profile.natureOfBusiness ?? '',
    authorizedCapital: profile.authorizedCapital !== null && profile.authorizedCapital !== undefined ? String(profile.authorizedCapital) : '',
    currency: profile.currency ?? 'TZS',
    status: profile.status ?? 'ACTIVE',
    notes: profile.notes ?? '',
  };
}

function toBranchForm(branch: Branch | null | undefined): BranchForm {
  if (!branch) return { ...EMPTY_BRANCH };
  return {
    name: branch.name ?? '',
    location: branch.location ?? '',
    address: branch.address ?? '',
    phone: branch.phone ?? '',
  };
}

function cleanRequired(value: unknown) {
  return String(value ?? '').trim();
}

function cleanOptional(value: unknown) {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function initials(name: string) {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return 'IR';
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}
