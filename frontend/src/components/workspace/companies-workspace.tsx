'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { backendDelete, backendPage } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import {
  Btn,
  FormInput,
  Modal,
  PageHeader,
  PageToolbar,
  PermissionDeniedState,
} from '@/components/ui';
import { RecordBrowser } from './record-browser';

type Company = {
  id: string;
  name: string;
  code: string;
  status: string;
  industryType?: string;
  email?: string;
  phone?: string;
  website?: string;
  profile?: { registeredName?: string; brelaRegNumber?: string; tin?: string };
  _count?: { divisions?: number; contracts?: number; fixedAssets?: number };
};
export function CompaniesWorkspace() {
  const { hasPermission, loading: authLoading } = useAuth();
  const allowed = hasPermission('companies.read');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [target, setTarget] = useState<Company | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (authLoading || !allowed) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    backendPage<Company>('/companies', {
      query: { page, limit: 20, search: query },
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (page > 1 && !result.data.length) {
          setPage((p) => p - 1);
          return;
        }
        setData(result.data);
        setTotal(result.total);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Unable to load companies');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [allowed, authLoading, page, query, revision]);
  async function archive() {
    if (!target || !hasPermission('companies.delete') || code.trim() !== target.code || busy)
      return;
    setBusy(true);
    setActionError('');
    try {
      await backendDelete(`/companies/${encodeURIComponent(target.id)}`);
      setTarget(null);
      setRevision((v) => v + 1);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Unable to archive company');
    } finally {
      setBusy(false);
    }
  }
  if (!authLoading && !allowed)
    return (
      <div className="business-workspace">
        <PermissionDeniedState />
      </div>
    );
  return (
    <div className="business-workspace space-y-6">
      <PageHeader
        title="Companies"
        subtitle="The businesses that make up your group."
        actions={
          hasPermission('companies.create') && (
            <Link className="workspace-primary-link" href="/companies/new">
              Add company
            </Link>
          )
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching companies</span>
          <strong>{loading || error ? '—' : total}</strong>
        </div>
        <div>
          <span>Active on this page</span>
          <strong>
            {loading || error ? '—' : data.filter((c) => c.status === 'ACTIVE').length}
          </strong>
        </div>
        <div>
          <span>Divisions on this page</span>
          <strong>
            {loading || error ? '—' : data.reduce((sum, c) => sum + (c._count?.divisions ?? 0), 0)}
          </strong>
        </div>
      </div>
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search companies by name or code…"
        actions={
          <Btn variant="secondary" onClick={() => setRevision((v) => v + 1)} disabled={loading}>
            Refresh
          </Btn>
        }
      />
      <RecordBrowser
        records={data}
        title="Companies"
        name={(c) => c.name}
        reference={(c) => c.code}
        status={(c) => c.status}
        fields={[
          { label: 'Industry', value: (c) => c.industryType || '—' },
          { label: 'Divisions', value: (c) => c._count?.divisions ?? 0 },
        ]}
        details={[
          { label: 'Legal name', value: (c) => c.profile?.registeredName || c.name },
          { label: 'Registration', value: (c) => c.profile?.brelaRegNumber || '—' },
          { label: 'Tax identification', value: (c) => c.profile?.tin || '—' },
          { label: 'Email', value: (c) => c.email || '—' },
          { label: 'Phone', value: (c) => c.phone || '—' },
          {
            label: 'Contracts / assets',
            value: (c) => `${c._count?.contracts ?? 0} / ${c._count?.fixedAssets ?? 0}`,
          },
        ]}
        actions={(c) => (
          <>
            <Link href={`/companies/${c.id}`}>Open company</Link>
            {hasPermission('companies.delete') && (
              <button
                onClick={() => {
                  setTarget(c);
                  setCode('');
                  setActionError('');
                }}
              >
                Archive company
              </button>
            )}
          </>
        )}
        loading={loading || authLoading}
        error={error}
        onRetry={() => setRevision((v) => v + 1)}
        page={page}
        total={total}
        onPage={setPage}
        empty={
          query
            ? 'Try a different company name or code.'
            : 'Add your first company to start building your group.'
        }
      />
      <Modal
        open={!!target}
        onClose={() => {
          if (!busy) setTarget(null);
        }}
        title="Archive company"
        subtitle={target?.name}
        size="sm"
        footer={
          <>
            <Btn variant="secondary" disabled={busy} onClick={() => setTarget(null)}>
              Keep company
            </Btn>
            <Btn
              variant="danger"
              loading={busy}
              disabled={!target || code.trim() !== target.code}
              onClick={() => void archive()}
            >
              Archive company
            </Btn>
          </>
        }
      >
        <p className="text-sm mb-4">
          This archives the company, its divisions and branches. Historical records remain intact.
        </p>
        <FormInput
          label={`Type ${target?.code ?? 'the company code'} to confirm`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
        />
        {actionError && (
          <p role="alert" className="text-sm text-red-600 mt-3">
            {actionError}
          </p>
        )}
      </Modal>
    </div>
  );
}
