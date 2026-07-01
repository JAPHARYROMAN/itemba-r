'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Btn,
  PageHeader,
  PageToolbar,
  StatCard,
  StatusBadge,
  PermissionDeniedState,
  showToast,
} from '@/components/ui';
import { Modal } from '@/components/aurora/overlays';
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from '@/components/aurora/data-display/ResponsiveDataTable';
import {
  FormShell,
  FormSection,
  FormSelect,
  FormDateInput,
  FormActions,
} from '@/components/aurora/forms';
import { useAuth } from '@/hooks/use-auth';
import { backendList, backendPage, backendPost } from '@/lib/api-client';

// The generate service uses the literal 'ALL' sentinel for a company-wide run
// (no specific customer). Surface it as a friendly label instead of a raw id.
const ALL_CUSTOMERS = 'ALL';

interface Company {
  id: string;
  name: string;
  code?: string | null;
}

interface Customer {
  id: string;
  name: string;
  customerCode?: string | null;
}

interface StatementRun extends Record<string, unknown> {
  id: string;
  statementRunNumber: string;
  companyId: string;
  customerId: string;
  periodStart: string;
  periodEnd: string;
  totalDebits?: number | string | null;
  totalCredits?: number | string | null;
  closingBalance?: number | string | null;
  status: string;
  createdAt?: string | null;
  // Included by the backend list endpoint.
  company?: { id: string; name: string; code?: string | null } | null;
  generatedBy?: { id: string; fullName?: string | null; email?: string | null } | null;
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

const PAGE_SIZE = 20;

function emptyPage<T>(page = 1): Paginated<T> {
  return { data: [], total: 0, page, totalPages: 1 };
}

function asNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number | string | null | undefined, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(asNumber(value))}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function monthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export default function CustomerStatementsPage() {
  const { hasPermission } = useAuth();

  const canView =
    hasPermission('customer_statements.list') || hasPermission('customer_statements.view');
  const canGenerate = hasPermission('customer_statements.generate');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [data, setData] = useState<Paginated<StatementRun> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [companyId, setCompanyId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [page, setPage] = useState(1);

  // Generate modal state
  const [generateOpen, setGenerateOpen] = useState(false);
  const [genCompanyId, setGenCompanyId] = useState('');
  const [genCustomerId, setGenCustomerId] = useState('');
  const [genCustomers, setGenCustomers] = useState<Customer[]>([]);
  const [genStart, setGenStart] = useState(isoDate(monthStart()));
  const [genEnd, setGenEnd] = useState(isoDate(new Date()));
  const [genErrors, setGenErrors] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);

  // Name-resolution lookups: the list endpoint returns raw FK ids for the
  // customer (only the company relation is included).
  const companyMap = useMemo(() => {
    const map = new Map<string, Company>();
    companies.forEach((c) => map.set(c.id, c));
    return map;
  }, [companies]);

  const customerMap = useMemo(() => {
    const map = new Map<string, Customer>();
    customers.forEach((c) => map.set(c.id, c));
    return map;
  }, [customers]);

  const companyName = useCallback(
    (row: StatementRun) => row.company?.name ?? companyMap.get(row.companyId)?.name ?? row.companyId,
    [companyMap],
  );

  const isAllCustomers = useCallback(
    (row: StatementRun) => !row.customerId || row.customerId === ALL_CUSTOMERS,
    [],
  );

  const customerName = useCallback(
    (row: StatementRun) => {
      if (isAllCustomers(row)) return 'All customers';
      return customerMap.get(row.customerId)?.name ?? row.customerId;
    },
    [customerMap, isAllCustomers],
  );

  // Load companies for filters, name resolution, and the generate form.
  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    backendList<Company>('/companies', { query: { limit: 200 } })
      .then((items) => {
        if (!cancelled) setCompanies(items);
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canView]);

  // Load customers (scoped to the selected filter company, or all) for name
  // resolution and the filter dropdown. Requires customers.view; failures are
  // non-fatal — rows fall back to showing the raw customer id.
  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    backendList<Customer>('/customers', {
      query: { companyId: companyId || undefined, limit: 1000 },
    })
      .then((items) => {
        if (!cancelled) setCustomers(items);
      })
      .catch(() => {
        if (!cancelled) setCustomers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canView, companyId]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const result = await backendPage<StatementRun>('/customer-statements', {
        query: {
          page,
          limit: PAGE_SIZE,
          companyId: companyId || undefined,
          customerId: customerId || undefined,
        },
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customer statements');
      setData(emptyPage<StatementRun>(page));
    } finally {
      setLoading(false);
    }
  }, [canView, companyId, customerId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Customers scoped to the company chosen inside the generate modal. The modal
  // company can differ from the filter company, so load its customers on demand.
  useEffect(() => {
    if (!canGenerate || !generateOpen || !genCompanyId) {
      setGenCustomers([]);
      return;
    }
    let cancelled = false;
    backendList<Customer>('/customers', { query: { companyId: genCompanyId, limit: 1000 } })
      .then((items) => {
        if (!cancelled) setGenCustomers(items);
      })
      .catch(() => {
        if (!cancelled) setGenCustomers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canGenerate, generateOpen, genCompanyId]);

  const openGenerate = () => {
    setGenCompanyId(companyId || (companies.length === 1 ? companies[0].id : ''));
    setGenCustomerId(customerId || '');
    setGenStart(isoDate(monthStart()));
    setGenEnd(isoDate(new Date()));
    setGenErrors({});
    setGenerateOpen(true);
  };

  const closeGenerate = () => {
    if (generating) return;
    setGenerateOpen(false);
  };

  const validateGenerate = () => {
    const errs: Record<string, string> = {};
    if (!genCompanyId) errs.companyId = 'Select a company';
    if (!genStart) errs.periodStart = 'Start date is required';
    if (!genEnd) errs.periodEnd = 'End date is required';
    if (genStart && genEnd && new Date(genStart) > new Date(genEnd)) {
      errs.periodEnd = 'End date cannot be before start date';
    }
    setGenErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submitGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateGenerate()) return;
    setGenerating(true);
    try {
      await backendPost('/customer-statements/generate', {
        companyId: genCompanyId,
        customerId: genCustomerId || undefined,
        periodStart: genStart,
        periodEnd: genEnd,
      });
      const target = genCustomerId
        ? customerMap.get(genCustomerId)?.name ?? 'customer'
        : 'all customers';
      showToast('success', 'Customer statement generated', `Statement generated for ${target}.`);
      setGenerateOpen(false);
      // Reset filters to reflect the freshly generated run at the top of the list.
      setPage(1);
      await load();
    } catch (err) {
      showToast(
        'error',
        'Could not generate statement',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setGenerating(false);
    }
  };

  const rows = useMemo(() => data?.data ?? [], [data]);

  const stats = useMemo(() => {
    const generated = rows.filter((r) => r.status === 'GENERATED' || r.status === 'SENT').length;
    const totalClosing = rows.reduce((sum, r) => sum + asNumber(r.closingBalance), 0);
    return { generated, totalClosing };
  }, [rows]);

  const columns: ResponsiveColumn<StatementRun>[] = [
    {
      key: 'statementRunNumber',
      header: 'Run #',
      priority: 1,
      accessor: (r) => <span className="font-mono text-xs">{r.statementRunNumber}</span>,
    },
    {
      key: 'customerId',
      header: 'Customer',
      priority: 1,
      accessor: (r) => {
        if (isAllCustomers(r)) {
          return (
            <span className="font-medium" style={{ color: 'var(--aurora-text-muted)' }}>
              All customers
            </span>
          );
        }
        return (
          <Link
            href={`/operations/customers/${r.customerId}`}
            className="font-medium hover:underline"
            style={{ color: 'var(--aurora-primary)' }}
            title="Open customer 360"
          >
            {customerName(r)}
          </Link>
        );
      },
    },
    {
      key: 'companyId',
      header: 'Company',
      priority: 2,
      accessor: (r) => <span className="text-sm">{companyName(r)}</span>,
    },
    {
      key: 'period',
      header: 'Period',
      priority: 2,
      accessor: (r) => (
        <span className="text-sm">
          {formatDate(r.periodStart)} – {formatDate(r.periodEnd)}
        </span>
      ),
    },
    {
      key: 'totalDebits',
      header: 'Debits',
      priority: 3,
      align: 'right',
      accessor: (r) => <span className="text-sm">{money(r.totalDebits)}</span>,
    },
    {
      key: 'totalCredits',
      header: 'Credits',
      priority: 3,
      align: 'right',
      accessor: (r) => <span className="text-sm">{money(r.totalCredits)}</span>,
    },
    {
      key: 'closingBalance',
      header: 'Closing Balance',
      priority: 1,
      align: 'right',
      accessor: (r) => <span className="font-medium">{money(r.closingBalance)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      priority: 1,
      accessor: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      priority: 1,
      align: 'right',
      exportExclude: true,
      accessor: (r) =>
        isAllCustomers(r) ? (
          <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            —
          </span>
        ) : (
          <Link
            href={`/operations/customers/${r.customerId}`}
            className="text-xs font-medium hover:underline"
            style={{ color: 'var(--aurora-primary)' }}
            title="Open the customer 360 to view / print statements"
          >
            View
          </Link>
        ),
    },
  ];

  if (!canView) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader
          title="Customer Statements"
          subtitle="View customer account statements by period"
        />
        <PermissionDeniedState />
      </div>
    );
  }

  const totalPages = data?.totalPages ?? 1;

  const filterSelectCls =
    'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = {
    borderColor: 'var(--aurora-border)',
    background: 'var(--aurora-card)',
    color: 'var(--aurora-text)',
  } as const;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Customer Statements"
        subtitle="Generate and review customer account statements by period"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Statement Runs" value={data?.total ?? 0} />
        <StatCard label="Generated / Sent" value={stats.generated} variant="green" />
        <StatCard label="Closing (page)" value={money(stats.totalClosing)} />
      </div>

      <PageToolbar
        filters={
          <>
            <select
              aria-label="Filter by company"
              value={companyId}
              onChange={(event) => {
                setCompanyId(event.target.value);
                setCustomerId('');
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Companies</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by customer"
              value={customerId}
              onChange={(event) => {
                setCustomerId(event.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Customers</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </>
        }
        actions={
          canGenerate ? (
            <Btn variant="primary" onClick={openGenerate}>
              Generate statement
            </Btn>
          ) : undefined
        }
      />

      <ResponsiveDataTable<StatementRun>
        columns={columns}
        data={rows}
        keyField="id"
        loading={loading}
        error={error}
        onRetry={() => void load()}
        errorTitle="Could not load customer statements"
        emptyTitle="No customer statements found"
        emptyDescription={
          canGenerate
            ? 'Adjust your filters or generate a new statement run.'
            : 'Adjust your filters or ask an administrator to generate a statement run.'
        }
        exportable
        exportFileName="customer-statements"
        pagination={{
          page,
          limit: PAGE_SIZE,
          total: data?.total ?? 0,
          onPageChange: (next) => {
            if (next >= 1 && next <= totalPages) setPage(next);
          },
        }}
      />

      {canGenerate && (
        <Modal
          open={generateOpen}
          onClose={closeGenerate}
          title="Generate customer statement"
          description="Aggregate receivables for a company (and optionally a single customer) over a date range."
          size="md"
        >
          <div className="p-5">
            <FormShell onSubmit={submitGenerate}>
              <FormSection columns={1}>
                <FormSelect
                  label="Company"
                  required
                  placeholder="Select a company"
                  value={genCompanyId}
                  error={genErrors.companyId}
                  onChange={(e) => {
                    setGenCompanyId(e.target.value);
                    setGenCustomerId('');
                  }}
                  options={companies.map((c) => ({ value: c.id, label: c.name }))}
                />
                <FormSelect
                  label="Customer"
                  help="Leave blank to generate a company-wide statement for all customers."
                  placeholder="All customers"
                  value={genCustomerId}
                  disabled={!genCompanyId}
                  onChange={(e) => setGenCustomerId(e.target.value)}
                  options={genCustomers.map((c) => ({ value: c.id, label: c.name }))}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormDateInput
                    label="Period start"
                    required
                    value={genStart}
                    error={genErrors.periodStart}
                    max={genEnd || undefined}
                    onChange={(e) => setGenStart(e.target.value)}
                  />
                  <FormDateInput
                    label="Period end"
                    required
                    value={genEnd}
                    error={genErrors.periodEnd}
                    min={genStart || undefined}
                    onChange={(e) => setGenEnd(e.target.value)}
                  />
                </div>
              </FormSection>
              <FormActions
                primaryLabel="Generate"
                primaryType="submit"
                loading={generating}
                onSecondary={closeGenerate}
              />
            </FormShell>
          </div>
        </Modal>
      )}
    </div>
  );
}
