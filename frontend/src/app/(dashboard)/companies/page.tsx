'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppIcon, PageHeader, Card, EmptyState, ErrorState, PermissionDeniedState } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useApiList } from '@/hooks/use-api-resource';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompanyProfile {
  registeredName: string;
  tradingName: string | null;
  brelaRegNumber: string;
  tin: string;
  incorporationDate: string | null;
  status: string;
}

interface Company {
  id: string;
  code: string;
  name: string;
  industryType: string | null;
  status: 'ACTIVE' | 'DORMANT' | 'SUSPENDED' | 'DISSOLVED';
  phone: string | null;
  email: string | null;
  website: string | null;
  createdAt: string;
  profile: CompanyProfile | null;
  _count: {
    divisions: number;
    bankAccounts: number;
    loans: number;
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
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600'}`}
    >
      {status}
    </span>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CompaniesPage() {
  const { hasPermission } = useAuth();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [deletingCompanyId, setDeletingCompanyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(
    () => ({
      limit: 20,
      search: debouncedSearch,
    }),
    [debouncedSearch],
  );

  const { data: companies, response, loading, error, reload } = useApiList<Company>(
    '/companies',
    { query },
  );

  async function deleteCompany(company: Company) {
    if (
      !confirm(
        `Delete ${company.name} from the registry? This archives the company and its divisions and branches so historical records remain intact.`,
      )
    ) {
      return;
    }

    const typedCode = prompt(`Type ${company.code} to confirm this registry delete.`);
    if (typedCode?.trim() !== company.code) {
      return;
    }

    setDeletingCompanyId(company.id);
    setActionError(null);

    try {
      const res = await fetch(`/api/backend/companies/${company.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(apiErrorMessage(json, res.status));
      }

      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to delete company');
    } finally {
      setDeletingCompanyId(null);
    }
  }

  return (
    <>
      <main className="p-6 flex-1 bg-slate-50 min-h-screen">
        <PageHeader
          title="Company Registry"
          description="Each company is a legally separate BRELA-registered entity under the Itemba Group."
          action={
            hasPermission('companies.create') ? (
              <Link
                href="/companies/new"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                + Add Company
              </Link>
            ) : (
              <div className="text-xs text-slate-500">Create access required</div>
            )
          }
        />

        {/* Search */}
        <div className="mb-5">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search companies by name or code…"
            className="w-full max-w-sm px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <Card className="p-4">
            <div className="text-sm text-slate-500">Total Companies</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{response?.total ?? '—'}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-slate-500">Active</div>
            <div className="text-2xl font-bold text-green-700 mt-1">
              {companies.filter((c) => c.status === 'ACTIVE').length}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-slate-500">Total Divisions</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {companies.reduce((sum, c) => sum + c._count.divisions, 0)}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-slate-500">Group</div>
            <div className="text-sm font-semibold text-slate-700 mt-1">Itemba Group</div>
          </Card>
        </div>

        {/* Company Cards */}
        {actionError && (
          <Card className="mb-5 border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {actionError}
          </Card>
        )}

        {loading && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="p-5 animate-pulse">
                <div className="h-5 bg-slate-200 rounded w-3/4 mb-3" />
                <div className="h-3 bg-slate-100 rounded w-1/2 mb-2" />
                <div className="h-3 bg-slate-100 rounded w-2/3" />
              </Card>
            ))}
          </div>
        )}

        {error && (
          <Card className="p-6">
            <ErrorState message={error} onRetry={reload} />
          </Card>
        )}

        {!loading && !error && companies.length === 0 && (
          <Card className="p-8">
            <EmptyState
              title={search ? 'No matching companies' : 'No companies found'}
              description={
                search
                  ? 'Adjust the search term or clear the filter.'
                  : 'Create access is required before a new company can be added.'
              }
              action={
                hasPermission('companies.create') ? (
                  <Link
                    href="/companies/new"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    Add Company
                  </Link>
                ) : (
                  <PermissionDeniedState />
                )
              }
            />
          </Card>
        )}

        {!loading && !error && companies.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {companies.map((company) => (
              <CompanyCard
                key={company.id}
                company={company}
                canDelete={hasPermission('companies.delete')}
                deleting={deletingCompanyId === company.id}
                onDelete={() => deleteCompany(company)}
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

// ── Company Card ──────────────────────────────────────────────────────────────

function CompanyCard({
  company,
  canDelete,
  deleting,
  onDelete,
}: {
  company: Company;
  canDelete: boolean;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <Card className="p-5 hover:shadow-md transition-shadow flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-900 text-base leading-tight">{company.name}</div>
          <div className="text-xs font-mono text-slate-400 mt-0.5">{company.code}</div>
        </div>
        <StatusBadge status={company.status} />
      </div>

      {/* Industry */}
      {company.industryType && (
        <div className="text-xs text-slate-500 flex items-center gap-1.5">
          <AppIcon name="company" size={14} />
          <span>{company.industryType}</span>
        </div>
      )}

      {/* Legal name from profile */}
      {company.profile?.registeredName && company.profile.registeredName !== company.name && (
        <div className="text-xs text-slate-500">
          Legal: <span className="font-medium">{company.profile.registeredName}</span>
        </div>
      )}

      {/* Stats row */}
      <div className="flex gap-4 pt-1 border-t border-slate-100">
        <div className="text-center">
          <div className="text-lg font-bold text-slate-800">{company._count.divisions}</div>
          <div className="text-xs text-slate-400">Divisions</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-slate-800">{company._count.contracts}</div>
          <div className="text-xs text-slate-400">Contracts</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-slate-800">{company._count.fixedAssets}</div>
          <div className="text-xs text-slate-400">Assets</div>
        </div>
      </div>

      {/* Contact */}
      {(company.email || company.phone) && (
        <div className="text-xs text-slate-500 space-y-0.5">
          {company.email && <div>Email: {company.email}</div>}
          {company.phone && <div>Phone: {company.phone}</div>}
        </div>
      )}

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
        {company.profile?.brelaRegNumber && (
          <div className="text-xs text-slate-400 font-mono">{company.profile.brelaRegNumber}</div>
        )}
        <div className="ml-auto flex items-center gap-3">
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50 transition-colors"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          )}
          <Link
            href={`/companies/${company.id}`}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
          >
            View Details →
          </Link>
        </div>
      </div>
    </Card>
  );
}

function apiErrorMessage(json: unknown, fallbackStatus: number) {
  if (json && typeof json === 'object' && 'message' in json) {
    const message = (json as { message?: unknown }).message;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof message === 'string') return message;
  }
  return `Request failed with status ${fallbackStatus}`;
}
