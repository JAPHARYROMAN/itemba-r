'use client';
import '@/components/workspace/workspace.css';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormGuard, useGuardedRouter } from '@/components/workspace/unsaved-work-provider';
import { Card, ErrorState, PageHeader, PermissionDeniedState } from '@/components/ui';
import { FormInput } from '@/components/aurora/forms/FormInput';
import { FormSelect } from '@/components/aurora/forms/FormSelect';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';
import { backendGet, backendPost } from '@/lib/api-client';

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'DORMANT', label: 'Dormant' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'DISSOLVED', label: 'Dissolved' },
];

interface Group {
  id: string;
  name: string;
  code: string;
}

interface CreatedCompany {
  id: string;
}

export default function NewCompanyPage() {
  const router = useGuardedRouter();
  const { hasPermission, loading: authLoading } = useAuth();
  const canCreate = hasPermission('companies.create');
  const beginRequest = useRequestGuard();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    groupId: '',
    name: '',
    code: '',
    industryType: '',
    status: 'ACTIVE',
    phone: '',
    email: '',
    website: '',
  });

  const draft = useFormGuard(form, setForm);

  const loadGroups = useCallback(async () => {
    if (authLoading || !canCreate) {
      setLoadingGroups(false);
      return;
    }
    const request = beginRequest();
    setLoadingGroups(true);
    setLoadError(null);
    try {
      const data = await backendGet<Group[]>('/groups', { signal: request.signal });
      if (!request.current()) return;
      const rows = Array.isArray(data) ? data : [];
      setGroups(rows);
      setForm((current) => ({
        ...current,
        groupId: current.groupId || rows[0]?.id || '',
      }));
    } catch (err) {
      if (!request.current()) return;
      setLoadError(err instanceof Error ? err.message : 'Failed to load groups');
    } finally {
      if (request.current()) setLoadingGroups(false);
    }
  }, [authLoading, beginRequest, canCreate]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.groupId || !form.name.trim() || !form.code.trim()) {
      setError('Group, company name, and company code are required.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        groupId: form.groupId,
        name: form.name.trim(),
        code: form.code.trim(),
        status: form.status,
        industryType: optionalString(form.industryType),
        phone: optionalString(form.phone),
        email: optionalString(form.email),
        website: optionalString(form.website),
      };
      const created = await backendPost<CreatedCompany>('/companies', payload);
      draft.markSaved();
      router.push(`/companies/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create company');
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading) {
    return (
      <main className="p-6 flex-1 bg-slate-50 min-h-screen">
        <PageHeader title="Add Company" description="Loading" />
      </main>
    );
  }

  if (!canCreate) {
    return (
      <main className="p-6 flex-1 bg-slate-50 min-h-screen">
        <PageHeader title="Add Company" description="Create a legal company record." />
        <Card className="p-8">
          <PermissionDeniedState />
        </Card>
      </main>
    );
  }

  return (
    <main className="business-workspace workspace-form">
      <PageHeader
        title="Add Company"
        description="Create a legally separate company record under the group."
        action={
          <Link
            href="/companies"
            className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-white transition-colors"
          >
            Back to Companies
          </Link>
        }
      />

      <Card className="max-w-3xl p-5">
        <form {...draft.capture} onSubmit={onSubmit} className="space-y-5">
          <fieldset className="workspace-form-section grid grid-cols-1 sm:grid-cols-2 gap-4">
            <legend>Company identity</legend>
            <FormSelect
              label="Group"
              required
              value={form.groupId}
              disabled={loadingGroups || submitting}
              onChange={(e) => setForm({ ...form, groupId: e.target.value })}
              options={groups.map((group) => ({
                value: group.id,
                label: `${group.name} (${group.code})`,
              }))}
            />
            <FormSelect
              label="Status"
              required
              value={form.status}
              disabled={submitting}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              options={STATUS_OPTIONS}
            />
            <FormInput
              label="Company Name"
              required
              value={form.name}
              disabled={submitting}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <FormInput
              label="Company Code"
              required
              value={form.code}
              disabled={submitting}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              help="Short identifier used in numbering and reports."
            />
            <FormInput
              label="Industry"
              value={form.industryType}
              disabled={submitting}
              onChange={(e) => setForm({ ...form, industryType: e.target.value })}
              placeholder="Petroleum, logistics, agriculture"
            />
          </fieldset>
          <fieldset className="workspace-form-section grid grid-cols-1 sm:grid-cols-2 gap-4">
            <legend>Contact details</legend>
            <FormInput
              label="Phone"
              type="tel"
              value={form.phone}
              disabled={submitting}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <FormInput
              label="Email"
              type="email"
              value={form.email}
              disabled={submitting}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <FormInput
              label="Website"
              type="url"
              value={form.website}
              disabled={submitting}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              placeholder="https://example.com"
            />
          </fieldset>

          {loadError && <ErrorState message={loadError} onRetry={() => void loadGroups()} />}

          {error && (
            <div
              role="alert"
              className="text-sm rounded-lg p-3 border border-red-200 bg-red-50 text-red-700"
            >
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Link
              href="/companies"
              className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting || loadingGroups || groups.length === 0}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Creating...' : 'Create Company'}
            </button>
          </div>
        </form>
      </Card>
    </main>
  );
}

function optionalString(value: string) {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
