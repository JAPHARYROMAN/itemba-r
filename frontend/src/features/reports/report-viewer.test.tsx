import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportLibrary } from './report-library';
import { ReportViewer } from './report-viewer';
import { ReportsApp } from './reports-app';
import { WorkspaceSessionProvider } from '@/components/workspace/workspace-session';
import { WorkspaceDraftsProvider } from '@/components/workspace/workspace-drafts';
import {
  UnsavedWorkProvider,
  UnsavedWorkScope,
} from '@/components/workspace/unsaved-work-provider';
import {
  WorkspaceLink,
  WorkspaceNavigationProvider,
  useWorkspacePathname,
} from '@/components/workspace/workspace-navigation';
import type { CatalogEntry, SavedReportView } from './report-viewer-types';
import { dateFieldValue, getDateField, setDateField } from '@/test/date-field';
import { DEFAULT_VALUATION, VALUATION_PRESETS } from '@/features/inventory/stock-valuation-format';
const state = vi.hoisted(() => ({
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  download: vi.fn(),
  pdf: vi.fn(),
  binary: vi.fn(),
  print: vi.fn(),
  permissions: new Set<string>(),
  entries: [] as CatalogEntry[],
  views: [] as SavedReportView[],
  data: {} as unknown,
}));
vi.mock('@/hooks/use-document-letterhead', () => ({
  useDocumentLetterhead: () => ({ groupName: 'ITEMBA GROUP' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/reports/run',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'operator', companyId: 'company' },
    loading: false,
    hasPermission: (permission: string) => state.permissions.has(permission),
  }),
}));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  backendGet: state.get,
  backendPage: state.page,
  backendPost: state.post,
  backendPatch: state.patch,
  backendDelete: state.remove,
}));
vi.mock('@/lib/report-export', async (original) => ({
  ...(await original<typeof import('@/lib/report-export')>()),
  downloadTextFile: state.download,
}));
vi.mock('@/lib/export-download', async (original) => ({
  ...(await original<typeof import('@/lib/export-download')>()),
  downloadTablePdf: state.pdf,
  downloadBinaryExport: state.binary,
}));
vi.mock('@/components/workspace/print-workspace', () => ({ printWorkspace: state.print }));
const route = '/reports/run?reportId=sales';
const makeEntry = (id = 'sales'): CatalogEntry => ({
  id,
  name: id === 'sales' ? 'Sales summary' : 'Stock valuation',
  description: 'Business results by company and division.',
  sector: 'OPERATIONS',
  category: 'Sales',
  scopes: ['COMPANY', 'DIVISION'],
  permission: 'reports.read',
  apiPath: '/source/{companyId}?section=SALES',
  frontendPath: '/operations/reports',
  reportType: 'OPERATIONAL',
  businessQuestions: ['How much did we sell?'],
});
const makeView = (): SavedReportView => ({
  id: 'saved',
  name: 'September sales',
  reportDefinitionId: 'definition',
  companyId: 'company',
  userId: 'operator',
  filters: {
    companyId: 'company',
    divisionId: 'division',
    dateFrom: '2026-09-01',
    dateTo: '2026-09-30',
  },
  chartConfig: { viewMode: 'table', metricColumns: [] },
  isDefault: false,
});
function Pages() {
  const path = useWorkspacePathname();
  return (
    <>
      <nav>
        <WorkspaceLink href="/reports">Reports home</WorkspaceLink>
        <WorkspaceLink href="/reports/library">Browse library</WorkspaceLink>
        <WorkspaceLink href={route}>Sales report</WorkspaceLink>
        <WorkspaceLink href="/reports/run?reportId=stock">Stock report</WorkspaceLink>
      </nav>
      {path === '/reports/library' ? (
        <ReportLibrary />
      ) : path === '/reports/run' ? (
        <ReportViewer />
      ) : (
        <ReportsApp />
      )}
    </>
  );
}
function Pane({ id = 'main', initial = route }: { id?: string; initial?: string }) {
  return (
    <section aria-label={`${id} window`}>
      <UnsavedWorkScope id={id}>
        <WorkspaceNavigationProvider
          appId={`reports-${id}`}
          initialHref={initial}
          ownsPath={(path) => path.startsWith('/reports')}
        >
          <Pages />
        </WorkspaceNavigationProvider>
      </UnsavedWorkScope>
    </section>
  );
}
function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceSessionProvider>
      <UnsavedWorkProvider>
        <WorkspaceDraftsProvider>{children}</WorkspaceDraftsProvider>
      </UnsavedWorkProvider>
    </WorkspaceSessionProvider>
  );
}
function App({ initial = route }: { initial?: string }) {
  return (
    <Providers>
      <Pane initial={initial} />
    </Providers>
  );
}
const read = async (path: string) => {
  if (path === '/reports/catalog')
    return { entries: structuredClone(state.entries), generatedAt: '2026-09-20T12:00:00Z' };
  if (path.startsWith('/source/')) return structuredClone(state.data);
  if (path.includes('/lineage/')) return { lineage: [], drillThrough: [], sourceSystems: [] };
  if (path.includes('/data-quality-warnings/'))
    return {
      warnings: [],
      surface: {
        readinessScore: 100,
        trustStatus: 'READY',
        officialUse: 'Review current checks.',
        remediationActions: [],
      },
    };
  if (path.includes('/explain/'))
    return {
      summary: 'Sales recorded in this period.',
      basis: 'Recorded transactions',
      drivers: [],
      caveats: [],
      recommendedDrillDowns: [],
    };
  if (path.includes('/export-audit/')) return { total: 0, exports: [] };
  if (path === '/bi/saved-report-views/saved') {
    const view = state.views.find((row) => row.id === 'saved');
    if (!view) throw new Error('View unavailable');
    return structuredClone(view);
  }
  throw new Error(`Unexpected read ${path}`);
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  state.permissions = new Set([
    'report_runs.create',
    'reports.read',
    'companies.view',
    'divisions.view',
    'saved_report_views.view',
    'saved_report_views.manage',
  ]);
  state.entries = [makeEntry(), makeEntry('stock')];
  state.views = [];
  state.data = {
    count: 75,
    rows: Array.from({ length: 75 }, (_, index) => ({
      customer: `Customer ${index + 1}`,
      total: `${index + 1}.1250`,
    })),
  };
  state.get.mockReset().mockImplementation(read);
  state.page.mockReset().mockImplementation(async (path: string) => {
    const data =
      path === '/companies'
        ? [
            { id: 'company', name: 'Company A' },
            { id: 'second', name: 'Company B' },
          ]
        : path === '/divisions'
          ? [{ id: 'division', companyId: 'company', name: 'Retail' }]
          : path === '/bi/saved-report-views'
            ? structuredClone(state.views)
            : [];
    return { data, total: data.length, page: 1, limit: 100 };
  });
  state.post.mockReset().mockImplementation(async (path: string) =>
    path.includes('run-manifest')
      ? {
          runId: 'run',
          status: 'COMPLETED',
          generatedAt: '2026-09-20T12:00:00Z',
          manifestHash: 'manifest',
          metrics: { rowCount: 75 },
        }
      : { id: 'created', audit: { auditHash: 'audit' } },
  );
  state.patch.mockReset().mockResolvedValue({});
  state.remove.mockReset().mockResolvedValue({});
  state.download.mockReset();
  state.pdf.mockReset().mockResolvedValue(undefined);
  state.binary.mockReset().mockResolvedValue(undefined);
  state.print.mockReset();
});
async function ready() {
  await screen.findByRole('button', { name: 'Run report' });
  await screen.findByRole('option', { name: 'Company A' });
}
async function run() {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
  await screen.findByRole('button', { name: 'Export report' });
}
async function acknowledge() {
  const dialog = within(screen.getByRole('dialog'));
  for (const box of await dialog.findAllByRole('checkbox'))
    if (!(box as HTMLInputElement).checked) fireEvent.click(box);
}
async function newView() {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Save this view' }));
  await screen.findByRole('textbox', { name: 'View name' });
  await screen.findByText(/Applying this view restores/);
}

describe('Report library and viewer workspace', () => {
  it('uses a saved stock format for the preview, every export and the audit without altering the source run', async () => {
    state.entries = [{ ...makeEntry('ops.stock-valuation'), category: 'Inventory' }];
    state.data = Array.from({ length: 24 }, (_, index) => ({
      productCode: `P-${index}`,
      product: `Stock ${index}`,
      category: index === 23 ? 'Food' : 'Drinks',
      branch: 'Main',
      quantityOnHand: 12.0001,
      totalValue: 1200.25,
      averageCost: 100,
      stockStatus: 'OK',
      unit: 'btl',
    }));
    state.views = [
      {
        ...makeView(),
        name: 'Compact drinks',
        reportDefinitionId: 'ops.stock-valuation',
        chartConfig: {
          stockValuation: {
            ...DEFAULT_VALUATION,
            columns: VALUATION_PRESETS.compact,
            category: 'Drinks',
          },
        },
      },
    ];
    render(<App initial="/reports/run?reportId=ops.stock-valuation&dateFrom=2026-01-01" />);
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'Apply Compact drinks' }));
    expect(screen.queryByLabelText('Date from')).toBeNull();
    await run();
    expect(screen.getByLabelText('Category filter')).toHaveValue('Drinks');
    expect(screen.queryByRole('columnheader', { name: 'Category' })).toBeNull();
    expect(screen.queryByRole('cell', { name: 'Stock 23', exact: true })).toBeNull();
    expect(screen.queryByRole('cell', { name: 'Stock 22', exact: true })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
    await waitFor(() => expect(state.pdf).toHaveBeenCalled());
    expect(state.pdf.mock.calls[0][0].rows).toHaveLength(23);
    expect(state.pdf.mock.calls[0][0].columns).not.toContain('Category');
    await screen.findByText('Report export prepared. Export activity recorded.');
    const audit = state.post.mock.calls.find(([path]) => path === '/reports/export-audit')![1];
    expect(audit.rowCount).toBe(23);
    expect(audit.dataHash).not.toBe('manifest');
    expect(audit.parameters.sourceManifestHash).toBe('manifest');
    expect(audit.parameters.stockValuation.columns).not.toContain('category');
    for (const format of ['xlsx', 'docx', 'txt', 'csv', 'json']) {
      state.post.mockClear();
      fireEvent.change(screen.getByLabelText('Export format'), { target: { value: format } });
      fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
      await waitFor(() =>
        expect(state.post).toHaveBeenCalledWith(
          '/reports/export-audit',
          expect.anything(),
          expect.anything(),
        ),
      );
    }
    for (const [, body] of state.binary.mock.calls) {
      expect(body.columns).not.toContain('Category');
      expect(body.rows).toHaveLength(23);
    }
    expect(state.download.mock.calls.find(([name]) => name.endsWith('.csv'))![2]).toContain(
      'Stock 22',
    );
    const json = JSON.parse(state.download.mock.calls.find(([name]) => name.endsWith('.json'))![2]);
    expect(json).toHaveLength(23);
    expect(json[0]).not.toHaveProperty('Category');
    expect(state.data).toHaveLength(24);
    fireEvent.click(screen.getByRole('button', { name: 'Print stock valuation' }));
    await waitFor(() => expect(state.print).toHaveBeenCalled());
    await newView();
    await acknowledge();
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(
        '/bi/saved-report-views',
        expect.objectContaining({
          chartConfig: expect.objectContaining({
            stockValuation: expect.objectContaining({
              category: 'Drinks',
              columns: VALUATION_PRESETS.compact,
            }),
          }),
        }),
      ),
    );
  });
  it('retains library search and selection through local report navigation', async () => {
    render(<App initial="/reports/library" />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Find a report' }), {
      target: { value: 'Sales summary' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Details for Sales summary' }));
    expect(screen.getByText('How much did we sell?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Open report' }));
    await ready();
    expect(state.get.mock.calls.some(([path]) => path.startsWith('/source/'))).toBe(false);
    await userEvent.click(screen.getByRole('link', { name: 'Browse library' }));
    expect(await screen.findByRole('textbox', { name: 'Find a report' })).toHaveValue(
      'Sales summary',
    );
    await screen.findByRole('heading', { name: 'Sales summary' });
  });
  it('reports catalogue failures distinctly and retries instead of showing no results', async () => {
    state.get.mockRejectedValueOnce(new Error('Library unavailable'));
    render(<App initial="/reports/library" />);
    await screen.findByText('Library unavailable');
    expect(screen.queryByText('No reports match these filters.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry library' }));
    await screen.findByRole('button', { name: 'Details for Sales summary' });
  });
  it('pages library entries and supports additional catalogue sectors', async () => {
    state.entries = Array.from({ length: 31 }, (_, index) => ({
      ...makeEntry(String(index)),
      name: `Report ${String(index).padStart(2, '0')}`,
      sector: 'PETROLEUM',
    }));
    render(<App initial="/reports/library" />);
    await screen.findByRole('button', { name: 'Details for Report 00' });
    expect(screen.queryByRole('button', { name: 'Details for Report 30' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next reports' }));
    await screen.findByRole('button', { name: 'Details for Report 30' });
    expect(screen.getAllByText('Petroleum').length).toBeGreaterThan(0);
  });
  it('does not fetch protected data or expose run controls without the report permission', async () => {
    state.permissions.delete('reports.read');
    render(<App />);
    await screen.findByText('Your current role cannot run this report.');
    expect(screen.queryByRole('button', { name: 'Run report' })).not.toBeInTheDocument();
    expect(state.get.mock.calls.every(([path]) => path === '/reports/catalog')).toBe(true);
  });
  it('runs an exact scope, preserves existing endpoint parameters and renders every row through pagination', async () => {
    render(<App />);
    await ready();
    await setDateField('Date from', '2026-09-01');
    fireEvent.change(screen.getByRole('combobox', { name: 'Division' }), {
      target: { value: 'division' },
    });
    await run();
    expect(state.get).toHaveBeenCalledWith(
      '/source/company',
      expect.objectContaining({
        query: { section: 'SALES', divisionId: 'division', dateFrom: '2026-09-01' },
      }),
    );
    expect(screen.getByText('Customer 1')).toBeInTheDocument();
    expect(screen.queryByText('Customer 75')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next rows' }));
    expect(screen.getByText('Customer 75')).toBeInTheDocument();
    expect(state.post).toHaveBeenCalledWith(
      '/reports/viewer/sales/run-manifest',
      expect.objectContaining({ dataQualityAttached: true, lineageAttached: true }),
      expect.anything(),
    );
  });
  it('blocks invalid periods without executing the report', async () => {
    render(<App />);
    await ready();
    await setDateField('Date from', '2026-10-01');
    await setDateField('Date to', '2026-09-01');
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await screen.findByText('The start date must be on or before the end date.');
    expect(state.get.mock.calls.some(([path]) => path.startsWith('/source/'))).toBe(false);
  });
  it('invalidates results and exports immediately when scope changes', async () => {
    render(<App />);
    await run();
    fireEvent.change(screen.getByRole('combobox', { name: 'Company' }), {
      target: { value: 'second' },
    });
    expect(screen.queryByText('Customer 1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export report' })).not.toBeInTheDocument();
    expect(screen.getByText(/Filters changed/)).toBeInTheDocument();
    expect(state.download).not.toHaveBeenCalled();
  });
  it('ignores a late scope response and prevents double run clicks', async () => {
    let resolve!: (value: unknown) => void;
    let signal!: AbortSignal;
    state.get.mockImplementation((path, options) =>
      path.startsWith('/source/')
        ? ((signal = options.signal),
          new Promise((r) => {
            resolve = r;
          }))
        : read(path),
    );
    render(<App />);
    await ready();
    const button = screen.getByRole('button', { name: 'Run report' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(state.get.mock.calls.filter(([path]) => path.startsWith('/source/'))).toHaveLength(1);
    fireEvent.change(screen.getByRole('combobox', { name: 'Company' }), {
      target: { value: 'second' },
    });
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ rows: [{ customer: 'Old scope response' }] }));
    expect(screen.queryByText('Old scope response')).not.toBeInTheDocument();
    expect(state.post).not.toHaveBeenCalled();
  });
  it('keeps failed report data separate from empty results and can retry', async () => {
    let failed = true;
    state.get.mockImplementation((path) =>
      path.startsWith('/source/') && failed
        ? Promise.reject(new Error('Source unavailable'))
        : read(path),
    );
    render(<App />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await screen.findByText('Source unavailable');
    expect(screen.queryByRole('button', { name: 'Export report' })).not.toBeInTheDocument();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry report' }));
    await screen.findByText('Customer 1');
  });
  it('shows unavailable supporting checks and records only the evidence actually returned', async () => {
    state.get.mockImplementation((path) =>
      path.includes('/data-quality-warnings/')
        ? Promise.reject(new Error('Quality offline'))
        : read(path),
    );
    render(<App />);
    await run();
    await screen.findByText('Quality checks unavailable: Quality offline');
    expect(
      screen.queryByText('No warning records were returned for this report and scope.'),
    ).not.toBeInTheDocument();
    expect(state.post).toHaveBeenCalledWith(
      '/reports/viewer/sales/run-manifest',
      expect.objectContaining({ dataQualityAttached: false, lineageAttached: true }),
      expect.anything(),
    );
  });
  it('allows viewing a result with an explicit failed run-record notice', async () => {
    state.post.mockRejectedValueOnce(new Error('Run record offline'));
    render(<App />);
    await run();
    await screen.findByText('Run record unavailable: Run record offline');
    expect(screen.getByText('Customer 1')).toBeInTheDocument();
  });
  it('preserves independent filter choices in two Reports windows', async () => {
    render(
      <Providers>
        <Pane id="left" />
        <Pane id="right" />
      </Providers>,
    );
    const left = within(screen.getByRole('region', { name: 'left window' }));
    const right = within(screen.getByRole('region', { name: 'right window' }));
    await waitFor(() => getDateField('Date from', left));
    await waitFor(() => getDateField('Date from', right));
    await setDateField('Date from', '2026-09-01', userEvent, left);
    expect(dateFieldValue(getDateField('Date from', right))).toBe('');
  });
  it('exports the completed run in full despite row search, then records its exact scope', async () => {
    render(<App />);
    await run();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search result rows' }), {
      target: { value: 'Customer 75' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Export format' }), {
      target: { value: 'csv' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
    await screen.findByText('Report export prepared. Export activity recorded.');
    expect(state.download).toHaveBeenCalledWith(
      expect.stringMatching(/sales.*csv/),
      'text/csv;charset=utf-8',
      expect.stringContaining('Customer 1,1.1250'),
    );
    expect(state.download.mock.calls[0][2]).toContain('Customer 75,75.1250');
    expect(state.post).toHaveBeenCalledWith(
      '/reports/export-audit',
      expect.objectContaining({
        companyId: 'company',
        rowCount: 75,
        runId: 'run',
        sourceUrl: '/api/backend/source/company?section=SALES',
      }),
      expect.anything(),
    );
  });
  it.each(['pdf', 'docx', 'xlsx', 'txt'])(
    'exports branded %s using the completed run company',
    async (format) => {
      render(<App />);
      await run();
      fireEvent.change(screen.getByRole('combobox', { name: 'Export format' }), {
        target: { value: format },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
      await screen.findByText('Report export prepared. Export activity recorded.');
      if (format === 'pdf')
        expect(state.pdf).toHaveBeenCalledWith(
          expect.objectContaining({
            companyId: 'company',
            title: 'Sales summary',
            rows: expect.any(Array),
          }),
          expect.anything(),
        );
      else
        expect(state.binary).toHaveBeenCalledWith(
          '/generated-documents/table-export',
          expect.objectContaining({ companyId: 'company', format, rows: expect.any(Array) }),
          expect.any(String),
          expect.anything(),
        );
    },
  );
  it('reports a download failure without recording a completed export', async () => {
    state.pdf.mockRejectedValue(new Error('PDF unavailable'));
    render(<App />);
    await run();
    state.post.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
    await screen.findByText('PDF unavailable');
    expect(state.post).not.toHaveBeenCalled();
  });
  it('reports an audit failure after download without pretending the export failed', async () => {
    render(<App />);
    await run();
    state.post.mockRejectedValue(new Error('Audit unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
    await screen.findByText(/Its activity record could not be saved: Audit unavailable/);
    expect(state.pdf).toHaveBeenCalledTimes(1);
  });
  it('prints only the selected workspace and reports that it requested the dialog', async () => {
    render(<App />);
    await run();
    fireEvent.click(screen.getByRole('button', { name: 'Print visible page' }));
    await screen.findByText(
      'Print dialog requested for the current visible page. Export activity recorded.',
    );
    expect(state.print).toHaveBeenCalledWith(expect.any(HTMLDivElement));
  });
  it('keeps and resumes a named saved-view draft from actual Reports home without saving on resume', async () => {
    render(<App />);
    await newView();
    fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), {
      target: { value: 'Morning review' },
    });
    await userEvent.click(screen.getAllByRole('link', { name: 'Reports home' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep draft and continue' }));
    await screen.findByRole('button', { name: 'Resume Save report view' });
    expect(state.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Resume Save report view' }));
    expect(await screen.findByRole('textbox', { name: 'View name' })).toHaveValue('Morning review');
    await acknowledge();
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(
        '/bi/saved-report-views',
        expect.objectContaining({
          name: 'Morning review',
          reportDefinitionId: 'sales',
          companyId: 'company',
          isDefault: false,
        }),
      ),
    );
  });
  it('keeps a failed saved-view form available with its name and filters', async () => {
    render(<App />);
    await newView();
    fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), {
      target: { value: 'Retry this name' },
    });
    state.post.mockRejectedValueOnce(new Error('Save unavailable'));
    await acknowledge();
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    await screen.findByText('Save unavailable');
    expect(screen.getByRole('textbox', { name: 'View name' })).toHaveValue('Retry this name');
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    await screen.findByRole('button', { name: 'Resume Save report view' });
  });
  it.each(['default', 'delete'] as const)(
    'reviews a current saved view before %s and retains failures',
    async (action) => {
      state.views = [makeView()];
      render(<App />);
      await ready();
      fireEvent.click(
        await screen.findByRole('button', {
          name: action === 'default' ? 'Make September sales default' : 'Delete September sales',
        }),
      );
      await screen.findByText(
        action === 'default' ? /Use these choices by default/ : /Remove these saved filter/,
      );
      const method = action === 'default' ? state.patch : state.remove;
      method.mockRejectedValueOnce(new Error('Change unavailable'));
      await acknowledge();
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: action === 'default' ? 'Set default' : 'Delete view',
        }),
      );
      await screen.findByText('Change unavailable');
      expect(method).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    },
  );
  it('honours deep-link dates over the saved default and never runs the default automatically', async () => {
    state.views = [{ ...makeView(), isDefault: true }];
    render(<App initial={route + '&dateFrom=2026-08-01'} />);
    await ready();
    await screen.findByText('September sales');
    expect(dateFieldValue(getDateField('Date from'))).toBe('2026-08-01');
    expect(state.post).not.toHaveBeenCalled();
  });
  it('aborts a pending report when its permission is revoked', async () => {
    let resolve!: (value: unknown) => void;
    let signal!: AbortSignal;
    state.get.mockImplementation((path, options) =>
      path.startsWith('/source/')
        ? ((signal = options.signal),
          new Promise((r) => {
            resolve = r;
          }))
        : read(path),
    );
    const app = render(<App />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    state.permissions.delete('reports.read');
    app.rerender(<App />);
    await screen.findByText('Your current role cannot run this report.');
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(state.data));
    expect(state.post).not.toHaveBeenCalled();
  });
  it('keeps report-specific filters when returning without replaying a report run', async () => {
    render(<App />);
    await ready();
    await setDateField('Date from', '2026-09-05');
    await userEvent.click(screen.getByRole('link', { name: 'Stock report' }));
    await ready();
    expect(dateFieldValue(getDateField('Date from'))).toBe('');
    await setDateField('Date from', '2026-08-05');
    await userEvent.click(screen.getByRole('link', { name: 'Sales report' }));
    await ready();
    expect(dateFieldValue(getDateField('Date from'))).toBe('2026-09-05');
    expect(state.post).not.toHaveBeenCalled();
  });
  it('does not silently expose a partial organisation list after a later-page failure', async () => {
    let fail = true;
    const base = state.page.getMockImplementation()!;
    state.page.mockImplementation((path, options) => {
      if (path !== '/companies') return base(path, options);
      if (options.query.page === 1)
        return Promise.resolve({
          data: Array.from({ length: 200 }, (_, i) => ({ id: `other-${i}`, name: `Company ${i}` })),
          total: 201,
          page: 1,
          limit: 200,
        });
      return fail
        ? Promise.reject(new Error('Directory page unavailable'))
        : Promise.resolve({
            data: [{ id: 'company', name: 'Last company' }],
            total: 201,
            page: 2,
            limit: 200,
          });
    });
    render(<App />);
    await screen.findByText(/Directory page unavailable/);
    expect(screen.queryByRole('option', { name: 'Company 199' })).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry organisation choices' }));
    await screen.findByRole('option', { name: 'Last company' });
  });
  it('applies a default only when there are no supplied or retained choices', async () => {
    state.views = [{ ...makeView(), isDefault: true }];
    render(<App />);
    await ready();
    await waitFor(() => expect(dateFieldValue(getDateField('Date from'))).toBe('2026-09-01'));
    await setDateField('Date from', '2026-09-07');
    await userEvent.click(screen.getByRole('link', { name: 'Browse library' }));
    await screen.findByRole('textbox', { name: 'Find a report' });
    await userEvent.click(screen.getByRole('link', { name: 'Sales report' }));
    await ready();
    expect(dateFieldValue(getDateField('Date from'))).toBe('2026-09-07');
    expect(state.post).not.toHaveBeenCalled();
  });
  it('stops a pending export after leaving the report and avoids duplicate exports', async () => {
    let resolve!: () => void;
    state.pdf.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    render(<App />);
    await run();
    state.post.mockClear();
    const button = screen.getByRole('button', { name: 'Export report' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(state.pdf).toHaveBeenCalledTimes(1);
    const signal = state.pdf.mock.calls[0][1] as AbortSignal;
    await userEvent.click(screen.getByRole('link', { name: 'Browse library' }));
    await screen.findByRole('textbox', { name: 'Find a report' });
    expect(signal.aborted).toBe(true);
    await act(async () => resolve());
    expect(state.post).not.toHaveBeenCalled();
  });
  it('requires a narrower report for oversized document export while retaining full CSV export', async () => {
    state.data = {
      rows: Array.from({ length: 5001 }, (_, index) => ({ name: `Row ${index}`, amount: index })),
    };
    render(<App />);
    await run();
    state.post.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
    await screen.findByText(/Document exports support up to 5,000 rows/);
    expect(state.pdf).not.toHaveBeenCalled();
    expect(state.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Export format' }), {
      target: { value: 'csv' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
    await screen.findByText('Report export prepared. Export activity recorded.');
    expect(state.download.mock.calls[0][2]).toContain('Row 5000,5000');
  });
  it('bounds chart work and lets the user deselect every metric', async () => {
    state.data = {
      rows: Array.from({ length: 251 }, (_, index) => ({ name: `Row ${index}`, amount: index })),
    };
    render(<App />);
    await run();
    fireEvent.change(screen.getByRole('combobox', { name: 'Result presentation' }), {
      target: { value: 'chart' },
    });
    await screen.findByText(
      'Chart samples 200 of 251 matching values, including the first and last.',
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'amount' }));
    expect(screen.getByRole('checkbox', { name: 'amount' })).not.toBeChecked();
    expect(screen.queryByText(/numeric values · Last/)).not.toBeInTheDocument();
  });
  it('does not save a view if permission changes during its current-catalogue review', async () => {
    const app = render(<App />);
    await newView();
    await acknowledge();
    let resolve!: (value: unknown) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    // The write saves its draft before re-reading the catalogue, so the read this
    // test controls is a microtask behind the click.
    await waitFor(() => expect(resolve).toBeDefined());
    state.permissions.delete('saved_report_views.manage');
    app.rerender(<App />);
    await act(async () => resolve({ entries: state.entries }));
    await screen.findByText(
      'Your current role no longer permits this action. Your input is still here.',
    );
    expect(state.post).not.toHaveBeenCalled();
  });
  it('requires review again when a saved view changes before deletion', async () => {
    state.views = [makeView()];
    render(<App />);
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete September sales' }));
    await screen.findByText(/Remove these saved filter/);
    await acknowledge();
    state.views[0].name = 'Updated saved view';
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete view' }),
    );
    await within(screen.getByRole('dialog')).findByText('Updated saved view');
    expect(state.remove).not.toHaveBeenCalled();
    await acknowledge();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete view' }),
    );
    await waitFor(() => expect(state.remove).toHaveBeenCalledTimes(1));
  });
  it('shows all additional report sections without discarding secondary arrays', async () => {
    state.data = {
      rows: [
        { name: 'Main section', total: '1.2500' },
        { name: 'Another main row', total: '2.5000' },
      ],
      adjustments: [{ reason: 'Secondary adjustment', amount: '-0.1250' }],
      totals: { gross: '3.7500', net: '3.6250' },
    };
    render(<App />);
    await run();
    fireEvent.click(screen.getByText('adjustments', { selector: 'summary' }));
    await screen.findByText('Secondary adjustment');
    expect(screen.getByText('-0.1250')).toBeInTheDocument();
    expect(screen.getByText('totals', { selector: 'summary' })).toBeInTheDocument();
  });
});
