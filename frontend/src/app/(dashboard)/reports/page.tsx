'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BarChart3,
  Building2,
  ClipboardList,
  FileBarChart,
  FileSearch,
  Filter,
  Landmark,
  PackageSearch,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Card, PageHeader, SkeletonCardGrid, showToast } from '@/components/ui';
import { backendGet } from '@/lib/api-client';

type ReportSector =
  | 'FINANCE'
  | 'HR'
  | 'OPERATIONS'
  | 'PETROLEUM'
  | 'WESTSIDES'
  | 'COMPLIANCE'
  | 'ITEMBA'
  | 'AGRICULTURE'
  | 'CONSTRUCTION'
  | 'LOGISTICS'
  | 'BI';

type ReportScope = 'GROUP' | 'COMPANY' | 'DIVISION';
type ReportType =
  | 'FINANCIAL_STATEMENT'
  | 'OPERATIONAL'
  | 'ANALYTICAL'
  | 'COMPLIANCE'
  | 'AUDIT'
  | 'DASHBOARD'
  | 'SELF_SERVICE';
type ReportLifecycleStatus = 'DRAFT' | 'VALIDATED' | 'CERTIFIED' | 'OFFICIAL' | 'ARCHIVED';
type SecurityClassification = 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED' | 'SENSITIVE';

interface CatalogEntry {
  id: string;
  sector: ReportSector;
  category: string;
  name: string;
  description: string;
  scopes: ReportScope[];
  permission: string;
  apiPath: string;
  frontendPath: string;
  reportType: ReportType;
  lifecycleStatus: ReportLifecycleStatus;
  owner: string;
  dataFreshness: string;
  securityClassification: SecurityClassification;
  outputFormats: string[];
  tags: string[];
  businessQuestions: string[];
  drillPaths: string[];
  relatedCapabilities: string[];
}

interface CatalogResponse {
  total: number;
  filtered: number;
  sectors: ReportSector[];
  sectorCounts: Record<string, number>;
  typeCounts: Record<string, number>;
  lifecycleCounts: Record<string, number>;
  categoryCounts?: Record<string, number>;
  generatedAt: string;
  entries: CatalogEntry[];
}

const SECTOR_LABELS: Record<ReportSector, string> = {
  FINANCE: 'Finance',
  HR: 'HR and Payroll',
  OPERATIONS: 'Operations',
  PETROLEUM: 'Petroleum',
  WESTSIDES: 'Westsides',
  COMPLIANCE: 'Compliance',
  ITEMBA: 'Group',
  AGRICULTURE: 'Agriculture',
  CONSTRUCTION: 'Construction',
  LOGISTICS: 'Logistics',
  BI: 'Custom / BI',
};

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  FINANCIAL_STATEMENT: 'Financial',
  OPERATIONAL: 'Operational',
  ANALYTICAL: 'Analytical',
  COMPLIANCE: 'Compliance',
  AUDIT: 'Audit',
  DASHBOARD: 'Dashboard',
  SELF_SERVICE: 'Custom',
};

const LIFECYCLE_LABELS: Record<ReportLifecycleStatus, string> = {
  DRAFT: 'Draft',
  VALIDATED: 'Validated',
  CERTIFIED: 'Certified',
  OFFICIAL: 'Official',
  ARCHIVED: 'Archived',
};

const QUICK_REPORT_ROOMS = [
  {
    title: 'Sales and Stock Reports',
    description: 'Sales, product movement, stock valuation, purchase summaries, and branch operations.',
    href: '/operations/reports',
    icon: <PackageSearch className="h-5 w-5" />,
  },
  {
    title: 'Westsides Reports',
    description: 'Readable customer, product, sales, purchase, supplier, quotation, package, and damage reports.',
    href: '/westsides/reports',
    icon: <BarChart3 className="h-5 w-5" />,
  },
  {
    title: 'Finance Reports',
    description: 'Trial balance, profit and loss, balance sheet, cash flow, AR, AP, and group financials.',
    href: '/finance/reports',
    icon: <Landmark className="h-5 w-5" />,
  },
  {
    title: 'HR Reports',
    description: 'Employees, attendance, payroll, leave, statutory, and WCF exposure reports.',
    href: '/hr/reports',
    icon: <Users className="h-5 w-5" />,
  },
  {
    title: 'Compliance Reports',
    description: 'Tax, obligations, documents, control evidence, and compliance readiness.',
    href: '/compliance/reports',
    icon: <ShieldCheck className="h-5 w-5" />,
  },
];

const PRIORITY_REPORT_IDS = [
  'group.sales',
  'ops.sales-summary',
  'ops.stock-valuation',
  'ops.purchase-summary',
  'finance.profit-and-loss',
  'finance.receivables-aging',
  'finance.payables-aging',
  'westsides.sales-by-product',
  'westsides.daily-sales-summary',
  'hr.payroll',
  'compliance.tax-transactions-summary',
];

const KNOWN_MODULE_PATHS = new Set([
  '/accounting-engine/financial-statements',
  '/compliance/reports',
  '/finance/reports',
  '/hr/reports',
  '/hr/reports/statutory',
  '/hr/reports/wcf-exposure',
  '/operations/reports',
  '/westsides/reports',
]);

const EMPTY_ENTRIES: CatalogEntry[] = [];

export default function SimpleReportsPage() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sector, setSector] = useState<'ALL' | ReportSector>('ALL');
  const [reportType, setReportType] = useState<'ALL' | ReportType>('ALL');

  useEffect(() => {
    let cancelled = false;
    async function loadCatalog() {
      setLoading(true);
      setError('');
      try {
        const data = await backendGet<CatalogResponse>('/reports/catalog');
        if (!cancelled) setCatalog(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load reports';
        if (!cancelled) {
          setError(message);
          showToast('error', 'Reports unavailable', message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  const entries = catalog?.entries ?? EMPTY_ENTRIES;

  const filteredReports = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries
      .filter((entry) => sector === 'ALL' || entry.sector === sector)
      .filter((entry) => reportType === 'ALL' || entry.reportType === reportType)
      .filter((entry) => {
        if (!term) return true;
        return [
          entry.name,
          entry.description,
          entry.category,
          SECTOR_LABELS[entry.sector],
          REPORT_TYPE_LABELS[entry.reportType],
          entry.owner,
          ...entry.tags,
          ...entry.businessQuestions,
        ]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(term));
      })
      .sort((a, b) => {
        const sectorCompare = SECTOR_LABELS[a.sector].localeCompare(SECTOR_LABELS[b.sector]);
        if (sectorCompare) return sectorCompare;
        const categoryCompare = a.category.localeCompare(b.category);
        if (categoryCompare) return categoryCompare;
        return a.name.localeCompare(b.name);
      });
  }, [entries, reportType, search, sector]);

  const priorityReports = useMemo(() => {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    return PRIORITY_REPORT_IDS.map((id) => byId.get(id)).filter(Boolean) as CatalogEntry[];
  }, [entries]);

  const groupedReports = useMemo(() => {
    const groups = new Map<ReportSector, CatalogEntry[]>();
    for (const entry of filteredReports) {
      const current = groups.get(entry.sector) ?? [];
      current.push(entry);
      groups.set(entry.sector, current);
    }
    return Array.from(groups.entries()).sort(([left], [right]) =>
      SECTOR_LABELS[left].localeCompare(SECTOR_LABELS[right]),
    );
  }, [filteredReports]);

  const sectors = [
    ...(catalog?.sectors?.length ? catalog.sectors : Array.from(new Set(entries.map((entry) => entry.sector)))),
  ].sort((a, b) => SECTOR_LABELS[a].localeCompare(SECTOR_LABELS[b]));

  const reportTypes = Array.from(new Set(entries.map((entry) => entry.reportType))).sort((a, b) =>
    REPORT_TYPE_LABELS[a].localeCompare(REPORT_TYPE_LABELS[b]),
  );

  const runnableCount = entries.filter(canRunInViewer).length;
  const officialCount = entries.filter((entry) => ['CERTIFIED', 'OFFICIAL'].includes(entry.lifecycleStatus)).length;
  const generatedAt = catalog?.generatedAt ? new Date(catalog.generatedAt).toLocaleString() : 'Not loaded yet';

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="Reports"
        subtitle="Simple report library for sales, stock, purchases, finance, HR, compliance, and company operations."
        breadcrumbs={[{ label: 'Reports' }]}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <SummaryTile icon={<FileBarChart className="h-4 w-4" />} label="Total reports" value={String(catalog?.total ?? entries.length)} />
        <SummaryTile icon={<Search className="h-4 w-4" />} label="Matching now" value={String(filteredReports.length)} />
        <SummaryTile icon={<ClipboardList className="h-4 w-4" />} label="Runnable here" value={String(runnableCount)} />
        <SummaryTile icon={<ShieldCheck className="h-4 w-4" />} label="Certified / official" value={String(officialCount)} />
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,1fr)_180px_180px_auto] lg:items-end">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-slate-600">Find a report</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search sales, stock, purchases, cash, customers, payroll..."
                className="aurora-input w-full rounded-lg px-9 py-2 text-[13px] transition-all focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-slate-600">Area</span>
            <select
              value={sector}
              onChange={(event) => setSector(event.target.value as 'ALL' | ReportSector)}
              className="aurora-input w-full rounded-lg px-3 py-2 text-[13px] transition-all focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="ALL">All areas</option>
              {sectors.map((item) => (
                <option key={item} value={item}>
                  {SECTOR_LABELS[item]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-slate-600">Type</span>
            <select
              value={reportType}
              onChange={(event) => setReportType(event.target.value as 'ALL' | ReportType)}
              className="aurora-input w-full rounded-lg px-3 py-2 text-[13px] transition-all focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="ALL">All types</option>
              {reportTypes.map((item) => (
                <option key={item} value={item}>
                  {REPORT_TYPE_LABELS[item]}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => {
              setSearch('');
              setSector('ALL');
              setReportType('ALL');
            }}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
          >
            <Filter className="h-4 w-4" />
            Clear
          </button>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <SkeletonCardGrid count={8} className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" />
      ) : (
        <>
          <section className="space-y-3">
            <SectionHeading
              title="Common report rooms"
              description="Use these when you already know the business area you want."
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              {QUICK_REPORT_ROOMS.map((room) => (
                <QuickRoomCard key={room.href} {...room} />
              ))}
            </div>
          </section>

          {priorityReports.length > 0 && (
            <section className="space-y-3">
              <SectionHeading
                title="Most useful reports"
                description="Fast access to the reports people usually need first."
              />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {priorityReports.map((entry) => (
                  <ReportCard key={entry.id} entry={entry} compact />
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <SectionHeading
              title="All reports"
              description={`Showing ${filteredReports.length} report${filteredReports.length === 1 ? '' : 's'}. Catalog refreshed ${generatedAt}.`}
            />

            {groupedReports.length === 0 ? (
              <Card className="p-8 text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <FileSearch className="h-5 w-5" />
                </div>
                <div className="mt-3 text-sm font-semibold text-slate-900">No reports match this search.</div>
                <p className="mt-1 text-sm text-slate-500">Clear the filters or search for a broader term like sales, stock, cash, payroll, or tax.</p>
              </Card>
            ) : (
              <div className="space-y-5">
                {groupedReports.map(([groupSector, reports]) => (
                  <div key={groupSector} className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-slate-500" />
                        <h2 className="text-sm font-semibold text-slate-900">{SECTOR_LABELS[groupSector]}</h2>
                      </div>
                      <div className="text-xs text-slate-500">
                        {reports.length} report{reports.length === 1 ? '' : 's'}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {reports.map((entry) => (
                        <ReportCard key={entry.id} entry={entry} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function SummaryTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700">{icon}</div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{value}</div>
        </div>
      </div>
    </Card>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}

function QuickRoomCard({
  title,
  description,
  href,
  icon,
}: {
  title: string;
  description: string;
  href: string;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:bg-slate-50"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700 group-hover:bg-brand-50 group-hover:text-brand-700">
        {icon}
      </div>
      <div className="mt-4 text-sm font-semibold text-slate-950">{title}</div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>
    </Link>
  );
}

function ReportCard({ entry, compact = false }: { entry: CatalogEntry; compact?: boolean }) {
  const runHref = `/reports/run?reportId=${encodeURIComponent(entry.id)}`;
  const canRun = canRunInViewer(entry);
  const moduleHref = KNOWN_MODULE_PATHS.has(entry.frontendPath) ? entry.frontendPath : '';
  const primaryHref = canRun ? runHref : moduleHref || '#';

  return (
    <Card className="flex h-full flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge>{SECTOR_LABELS[entry.sector]}</Badge>
            <Badge>{REPORT_TYPE_LABELS[entry.reportType]}</Badge>
            {['CERTIFIED', 'OFFICIAL'].includes(entry.lifecycleStatus) && (
              <Badge tone="good">{LIFECYCLE_LABELS[entry.lifecycleStatus]}</Badge>
            )}
          </div>
          <h3 className="mt-3 text-sm font-semibold leading-5 text-slate-950">{entry.name}</h3>
        </div>
      </div>

      <p className={`mt-2 text-xs leading-5 text-slate-500 ${compact ? 'line-clamp-2' : ''}`}>
        {entry.description}
      </p>

      {!compact && (
        <div className="mt-3 space-y-2 text-[11px] text-slate-500">
          <div>
            <span className="font-semibold text-slate-600">Category:</span> {entry.category}
          </div>
          <div>
            <span className="font-semibold text-slate-600">Output:</span>{' '}
            {entry.outputFormats?.length ? entry.outputFormats.join(', ') : 'View / export'}
          </div>
          <div>
            <span className="font-semibold text-slate-600">Scope:</span> {entry.scopes.join(', ')}
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {primaryHref !== '#' ? (
          <Link
            href={primaryHref}
            className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
          >
            {canRun ? 'Run report' : 'Open'}
          </Link>
        ) : (
          <span className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500">
            Catalog only
          </span>
        )}

        {moduleHref && canRun && (
          <Link
            href={moduleHref}
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Module
          </Link>
        )}
      </div>
    </Card>
  );
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' }) {
  const cls =
    tone === 'good'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-slate-200 bg-slate-50 text-slate-600';
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {children}
    </span>
  );
}

function canRunInViewer(entry: CatalogEntry) {
  return Boolean(entry.apiPath && !entry.apiPath.includes('{id}'));
}
