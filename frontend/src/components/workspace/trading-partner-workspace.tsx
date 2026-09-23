'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Btn,
  FormSelect,
  Modal,
  PageHeader,
  PageToolbar,
  PermissionDeniedState,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendDelete, backendPatch } from '@/lib/api-client';
import { RecordBrowser } from './record-browser';
import { TradingPartnerEditor } from './trading-partner-editor';
import {
  partnerCode,
  partnerHumanize,
  partnerLabel,
  partnerMoney,
  partnerStatuses,
  partnerTypes,
  type PartnerKind,
  type PartnerChoice,
  type PartnerCategory,
  type TradingPartner,
} from './trading-partner-types';
import './workspace.css';
import './trading-partner.css';
interface PartnerSummary {
  total: number;
  active: number;
  inactive: number;
  blocked: number;
  creditLimit?: number;
  currentBalance: number;
  openReceivableBalance?: number;
  overdueReceivableBalance?: number;
  openPayableBalance?: number;
  overduePayableBalance?: number;
}
export function TradingPartnerWorkspace({ kind }: { kind: PartnerKind }) {
  const { hasPermission, loading: authLoading } = useAuth();
  const canRead = !authLoading && hasPermission(`${kind}.view`),
    canCreate = hasPermission(`${kind}.create`),
    canUpdate = hasPermission(`${kind}.update`),
    canDelete = hasPermission(`${kind}.delete`);
  const canChoose = hasPermission('companies.read'),
    canDivide = hasPermission('divisions.read'),
    canBranch = hasPermission('branches.read'),
    canCategorize = hasPermission('product_categories.view');
  const supplier = kind === 'suppliers',
    label = partnerLabel(kind),
    title = `${label}s`;
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    companyId: '',
    divisionId: '',
    branchId: '',
    productCategoryId: '',
    type: '',
    status: '',
  });
  const [editor, setEditor] = useState<{ record?: TradingPartner } | null>(null),
    [action, setAction] = useState<{
      record: TradingPartner;
      kind: 'delete' | 'block' | 'unblock';
    } | null>(null),
    [notice, setNotice] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const scope = {
    search: query,
    companyId: filters.companyId,
    divisionId: filters.divisionId,
    status: filters.status,
    ...(supplier
      ? { supplierType: filters.type, productCategoryId: filters.productCategoryId }
      : { customerType: filters.type, branchId: filters.branchId }),
  };
  const params = { ...scope, page, limit: 20 };
  const result = useWorkspaceResource<{ data: TradingPartner[]; total: number }>(
    `/${kind}`,
    params,
    canRead,
  );
  const summary = useWorkspaceResource<PartnerSummary>(
    `/${kind}/workbench-summary`,
    scope,
    canRead,
  );
  const companies = useWorkspaceChoices<PartnerChoice>('/companies', {}, canRead && canChoose);
  const divisions = useWorkspaceChoices<PartnerChoice>(
    '/divisions',
    { companyId: filters.companyId },
    canRead && canDivide && !!filters.companyId,
  );
  const branches = useWorkspaceChoices<PartnerChoice & { divisionId: string }>(
    '/branches',
    { companyId: filters.companyId, activeOnly: true },
    canRead && !supplier && canBranch && !!filters.companyId,
  );
  const categories = useWorkspaceChoices<PartnerCategory>(
    '/product-categories',
    { companyId: filters.companyId || undefined },
    canRead && supplier && canCategorize,
  );
  useEffect(() => {
    if (result.data && !result.data.data.length && page > 1) setPage((p) => p - 1);
  }, [result.data, page]);
  const change = (key: keyof typeof filters, value: string) => {
    setFilters((p) => ({
      ...p,
      [key]: value,
      ...(key === 'companyId'
        ? { divisionId: '', branchId: '', productCategoryId: '' }
        : key === 'divisionId'
          ? { branchId: '' }
          : {}),
    }));
    setPage(1);
  };
  const refresh = () => {
    result.reload();
    summary.reload();
  };
  const saved = (message: string) => {
    setEditor(null);
    setAction(null);
    setNotice(message);
    refresh();
  };
  if (authLoading)
    return (
      <p role="status" className="workspace-notice">
        Loading workspace…
      </p>
    );
  if (!canRead) return <PermissionDeniedState description={`Your role cannot view ${kind}.`} />;
  const stat = (value: number | undefined, money = false) =>
    summary.loading
      ? '…'
      : summary.error
        ? 'Unavailable'
        : money
          ? partnerMoney(value)
          : (value ?? '—');
  return (
    <div className="business-workspace record-workspace partner-workspace">
      <PageHeader
        title={title}
        subtitle={
          supplier
            ? 'Supplier relationships, procurement scope and payment exposure.'
            : 'Customer relationships, sales scope and credit exposure.'
        }
        breadcrumbs={[{ label: 'Operations', href: '/operations' }, { label: title }]}
        actions={canCreate && <Btn onClick={() => setEditor({})}>New {label.toLowerCase()}</Btn>}
      />
      <div className="workspace-summary">
        <div>
          <span>Matching {kind}</span>
          <strong>{stat(summary.data?.total)}</strong>
        </div>
        <div>
          <span>Active</span>
          <strong>{stat(summary.data?.active)}</strong>
        </div>
        <div>
          <span>Blocked</span>
          <strong>{stat(summary.data?.blocked)}</strong>
        </div>
        <div>
          <span>{supplier ? 'Open payables' : 'Open receivables'}</span>
          <strong>
            {stat(
              supplier ? summary.data?.openPayableBalance : summary.data?.openReceivableBalance,
              true,
            )}
          </strong>
        </div>
        <div>
          <span>Overdue</span>
          <strong>
            {stat(
              supplier
                ? summary.data?.overduePayableBalance
                : summary.data?.overdueReceivableBalance,
              true,
            )}
          </strong>
        </div>
      </div>
      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      {summary.error && (
        <p role="alert" className="workspace-notice">
          Summary unavailable. {summary.error}{' '}
          <Btn variant="ghost" onClick={summary.reload}>
            Retry summary
          </Btn>
        </p>
      )}
      {[
        ['Company', companies],
        ['Division', divisions],
        ['Branch', branches],
        ['Category', categories],
      ].map(([name, source]) => {
        const choices = source as typeof companies;
        return choices.error ? (
          <p role="alert" className="workspace-notice" key={name as string}>
            {name as string} choices unavailable. {choices.error}{' '}
            <Btn variant="ghost" onClick={choices.retry}>
              Retry {String(name).toLowerCase()} choices
            </Btn>
          </p>
        ) : null;
      })}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search name, code, contact, phone or tax ID…"
        collapsibleFilters
        activeFilterCount={Object.values(filters).filter(Boolean).length}
        filters={
          <>
            {canChoose && (
              <FormSelect
                label="Company filter"
                value={filters.companyId}
                onChange={(e) => change('companyId', e.target.value)}
                placeholder="All companies"
                disabled={companies.loading || !!companies.error}
                options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
              />
            )}
            {canDivide && (
              <FormSelect
                label="Division filter"
                value={filters.divisionId}
                onChange={(e) => change('divisionId', e.target.value)}
                placeholder="All divisions"
                disabled={!filters.companyId || divisions.loading || !!divisions.error}
                options={divisions.rows.map((c) => ({ value: c.id, label: c.name }))}
              />
            )}
            {!supplier && canBranch && (
              <FormSelect
                label="Branch filter"
                value={filters.branchId}
                onChange={(e) => change('branchId', e.target.value)}
                placeholder="All branches"
                disabled={!filters.companyId || branches.loading || !!branches.error}
                options={branches.rows
                  .filter((b) => !filters.divisionId || b.divisionId === filters.divisionId)
                  .map((c) => ({ value: c.id, label: c.name }))}
              />
            )}
            {supplier && canCategorize && (
              <FormSelect
                label="Category filter"
                value={filters.productCategoryId}
                onChange={(e) => change('productCategoryId', e.target.value)}
                placeholder="All categories"
                disabled={categories.loading || !!categories.error}
                options={categories.rows.map((c) => ({ value: c.id, label: c.name }))}
              />
            )}
            <FormSelect
              label="Type filter"
              value={filters.type}
              onChange={(e) => change('type', e.target.value)}
              placeholder="All types"
              options={partnerTypes[kind].map((value) => ({
                value,
                label: partnerHumanize(value),
              }))}
            />
            <FormSelect
              label="Status filter"
              value={filters.status}
              onChange={(e) => change('status', e.target.value)}
              placeholder="All statuses"
              options={partnerStatuses.map((value) => ({ value, label: partnerHumanize(value) }))}
            />
          </>
        }
        actions={
          <Btn variant="secondary" onClick={refresh} disabled={result.loading || summary.loading}>
            Refresh
          </Btn>
        }
      />
      <RecordBrowser
        key={JSON.stringify(params)}
        title={title}
        records={result.data?.data || []}
        name={(r) => r.name}
        reference={(r) =>
          `${partnerCode(r)} · ${partnerHumanize(r.customerType || r.supplierType || '')}`
        }
        status={(r) => r.status}
        fields={[
          { label: 'Company', value: (r) => r.company?.name || r.companyId },
          { label: 'Current balance', value: (r) => partnerMoney(r.currentBalance) },
        ]}
        details={[
          { label: 'Credit limit', value: (r) => partnerMoney(r.creditLimit) },
          {
            label: 'Contact',
            value: (r) => (
              <>
                {r.contactPerson || 'No contact person'}
                <br />
                {r.phone || '—'}
                <br />
                {r.email || '—'}
              </>
            ),
          },
          { label: 'Payment terms', value: (r) => r.paymentTerms || '—' },
          {
            label: 'Scope',
            value: (r) => (
              <>
                {r.division?.name || 'No division'}
                {!supplier && (
                  <>
                    <br />
                    {r.branch?.name || 'No branch'}
                  </>
                )}
              </>
            ),
          },
          ...(supplier
            ? [
                {
                  label: 'Categories',
                  value: (r: TradingPartner) =>
                    r.productCategories?.map((c) => c.productCategory.name).join(', ') || '—',
                },
              ]
            : []),
          {
            label: 'More details',
            value: (r) => (
              <details className="partner-secondary-details">
                <summary>Identity, tax and notes</summary>
                <p>Legal name: {r.legalName || '—'}</p>
                <p>
                  TIN: {r.tin || '—'}
                  <br />
                  VRN: {r.vrn || '—'}
                </p>
                <p>Address: {r.address || '—'}</p>
                <p>Notes: {r.notes || '—'}</p>
              </details>
            ),
          },
        ]}
        actions={(r) => (
          <>
            <Link href={`/operations/${kind}/${r.id}`}>Open profile</Link>
            {canUpdate && (
              <>
                <Btn variant="secondary" onClick={() => setEditor({ record: r })}>
                  Edit {label.toLowerCase()}
                </Btn>
                <Btn
                  variant="ghost"
                  onClick={() =>
                    setAction({ record: r, kind: r.status === 'BLOCKED' ? 'unblock' : 'block' })
                  }
                >
                  {r.status === 'BLOCKED' ? 'Unblock' : 'Block'} {label.toLowerCase()}
                </Btn>
              </>
            )}
            {canDelete && (
              <Btn variant="ghost" onClick={() => setAction({ record: r, kind: 'delete' })}>
                Delete {label.toLowerCase()}
              </Btn>
            )}
          </>
        )}
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        empty={`No ${kind} match this view.`}
        page={page}
        pageSize={20}
        total={result.data?.total ?? 0}
        onPage={setPage}
      />
      {editor && (
        <TradingPartnerEditor
          kind={kind}
          record={editor.record}
          companyId={filters.companyId}
          onClose={() => setEditor(null)}
          onSaved={() => saved(`${label} saved.`)}
        />
      )}
      {action && (
        <PartnerAction
          partnerKind={kind}
          {...action}
          onClose={() => setAction(null)}
          onSaved={() =>
            saved(
              `${label} ${action.kind === 'delete' ? 'deleted' : action.kind === 'block' ? 'blocked' : 'unblocked'}.`,
            )
          }
        />
      )}
    </div>
  );
}
export function PartnerAction({
  partnerKind,
  record,
  kind,
  onClose,
  onSaved,
}: {
  partnerKind: PartnerKind;
  record: TradingPartner;
  kind: 'block' | 'unblock' | 'delete';
  onClose: () => void;
  onSaved: () => void;
}) {
  const { hasPermission } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const label = partnerLabel(partnerKind).toLowerCase(),
    action = `${kind[0].toUpperCase()}${kind.slice(1)} ${label}`;
  const submit = async () => {
    if (busy || !hasPermission(`${partnerKind}.${kind === 'delete' ? 'delete' : 'update'}`)) return;
    setBusy(true);
    setError('');
    try {
      if (kind === 'delete') await backendDelete(`/${partnerKind}/${record.id}`);
      else
        await backendPatch(`/${partnerKind}/${record.id}`, {
          status: kind === 'block' ? 'BLOCKED' : 'ACTIVE',
        });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to update this ${label}.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={action}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={onClose}>
            Keep {label}
          </Btn>
          <Btn variant={kind === 'delete' ? 'danger' : 'primary'} loading={busy} onClick={submit}>
            {action}
          </Btn>
        </>
      }
    >
      <div className="workspace-notice">
        <strong>{record.name}</strong>
        <p>
          {partnerCode(record)} · {record.company?.name || record.companyId}
        </p>
      </div>
      <p className="mt-4">
        {kind === 'delete'
          ? `Remove this ${label} from the directory? Historical documents are retained.`
          : `Change this ${label} from ${partnerHumanize(record.status)} to ${kind === 'block' ? 'Blocked' : 'Active'}?`}
      </p>
      {error && (
        <p role="alert" className="workspace-notice mt-4">
          {error}
        </p>
      )}
    </Modal>
  );
}
