'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  ChevronRight,
  ClipboardList,
  Fuel,
  History,
  Moon,
  RefreshCw,
  Sun,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { fuelCompanyName } from '@/components/fuel-reporting/default-company';
import { ReportEditor } from '@/components/fuel-reporting/report-editor';
import { DailySummary } from '@/components/fuel-reporting/report-summary';
import {
  amount,
  stationDate,
  type Branch,
  type Report,
  type Workspace,
} from '@/components/fuel-reporting/types';
import { AppGlyph } from '@/components/os/app-glyph';
import { FormDateField, PageSpinner, StatusBadge, WorkspaceTable } from '@/components/ui';
import { useFormGuard } from '@/components/workspace/unsaved-work-provider';
import {
  useWorkspaceRouter,
  useWorkspaceSearchParams,
} from '@/components/workspace/workspace-navigation';
import { useAuth } from '@/hooks/use-auth';
import { ApiError, backendGet } from '@/lib/api-client';
import { getApp } from '@/lib/apps';
import '@/components/fuel-reporting/fuel-reporting.css';
import '../invoice-desk/invoice-desk.css';
import './petrodollar.css';
import { PetroDollarPosting } from './petrodollar-posting';

const VIEWS = ['report', 'receive', 'daily', 'history'] as const;
type View = (typeof VIEWS)[number];
const SECTIONS: { id: View; label: string; blurb: string; icon: LucideIcon }[] = [
  {
    id: 'report',
    label: 'Shift report',
    blurb: 'Pump meters, tank dips and cash for one shift.',
    icon: ClipboardList,
  },
  {
    id: 'receive',
    label: 'Fuel received',
    blurb: 'Deliveries that arrived during this shift.',
    icon: Truck,
  },
  {
    id: 'daily',
    label: 'Daily summary',
    blurb: 'Both shifts for the day, side by side.',
    icon: BarChart3,
  },
  {
    id: 'history',
    label: 'Report history',
    blurb: 'Every saved shift, with its differences and revisions.',
    icon: History,
  },
];
export const petrodollarView = (value: string | null): View =>
  (VIEWS as readonly string[]).includes(value ?? '') ? (value as View) : 'report';

interface Bootstrap {
  company: { id: string; code: string; name: string };
  canManage: boolean;
  canAdmin: boolean;
  branches: Branch[];
}
type Problem = { kind: 'unavailable' } | { kind: 'error'; message: string };
const problemFrom = (error: unknown): Problem =>
  error instanceof ApiError && error.status === 503
    ? { kind: 'unavailable' }
    : { kind: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' };
const app = getApp('petrodollar')!;
// Writing a report is allowed in both views of the editor, so they share one locked group.
const editing = (view: View) => view === 'report' || view === 'receive';

export function PetroDollarApp() {
  const { hasPermission, loading: authLoading } = useAuth();
  const params = useWorkspaceSearchParams();
  const router = useWorkspaceRouter();
  const view = petrodollarView(params.get('view'));
  const permitted = hasPermission('fuel_reporting.read');

  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [branchId, setBranchId] = useState('');
  const [date, setDate] = useState(stationDate);
  const [shift, setShift] = useState('DAY');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [history, setHistory] = useState<Report[]>([]);
  const [moreHistory, setMoreHistory] = useState(false);
  const [booting, setBooting] = useState(true);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editorLocked, setEditorLocked] = useState(false);
  const [postingLocked, setPostingLocked] = useState(false);
  const locked = editorLocked || postingLocked;
  // History only needs the station list; the other views also wait for the shift's workspace.
  const loading = view === 'history' ? booting : booting || loadingWorkspace;
  const branch = bootstrap?.branches.find((b) => b.id === branchId);
  const reload = () => setReloadKey((key) => key + 1);

  // The editor reports "unsaved or saving"; mirror it into the window's unsaved-work guard so
  // closing the window or leaving the app asks first. touch/markSaved are stable callbacks.
  const { touch, markSaved } = useFormGuard({ unsaved: locked });
  const locks = useRef({ editor: false, posting: false });
  const onLock = useCallback(
    (value: boolean) => {
      locks.current.editor = value;
      if (locks.current.editor || locks.current.posting) touch();
      else markSaved();
      setEditorLocked(value);
    },
    [touch, markSaved],
  );
  const onPostingLock = useCallback(
    (value: boolean) => {
      locks.current.posting = value;
      if (locks.current.editor || locks.current.posting) touch();
      else markSaved();
      setPostingLocked(value);
    },
    [touch, markSaved],
  );

  useEffect(() => {
    if (!permitted) {
      setBooting(false);
      return;
    }
    let cancelled = false;
    backendGet<Bootstrap>('/petrodollar/bootstrap')
      .then((data) => {
        if (cancelled) return;
        setBootstrap(data);
        setProblem(null);
        setBranchId(
          (current) =>
            data.branches.find((b) => b.id === current)?.id ?? data.branches[0]?.id ?? '',
        );
        setBooting(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setProblem(problemFrom(error));
        setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [permitted, reloadKey]);

  useEffect(() => {
    if (!branchId) {
      setWorkspace(null);
      return;
    }
    let cancelled = false;
    setLoadingWorkspace(true);
    setWorkspace(null);
    backendGet<Workspace>('/petrodollar/workspace', {
      query: { branchId, businessDate: date, shift },
    })
      .then((data) => {
        if (cancelled) return;
        setWorkspace(data);
        setProblem(null);
        setLoadingWorkspace(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setProblem(problemFrom(error));
        setLoadingWorkspace(false);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId, date, shift, reloadKey]);

  useEffect(() => {
    setHistory([]);
    if (view !== 'history' || !branchId) return;
    let cancelled = false;
    backendGet<Report[]>('/petrodollar/history', { query: { branchId } })
      .then((data) => {
        if (cancelled) return;
        setHistory(data);
        setMoreHistory(data.length === 50);
      })
      .catch((error) => {
        if (!cancelled) setProblem(problemFrom(error));
      });
    return () => {
      cancelled = true;
    };
  }, [view, branchId, reloadKey]);

  const onSaved = useCallback(
    (report: Report) =>
      setWorkspace((current) =>
        current
          ? {
              ...current,
              report,
              daily: [...current.daily.filter((r) => r.id !== report.id), report].sort((a, b) =>
                a.shift.localeCompare(b.shift),
              ),
            }
          : current,
      ),
    [],
  );
  const go = (next: View) =>
    router.push(next === 'report' ? '/petrodollar' : `/petrodollar?view=${next}`);
  async function olderReports() {
    try {
      const rows = await backendGet<Report[]>('/petrodollar/history', {
        query: { branchId, before: history.at(-1)?.id },
      });
      setHistory((current) => [...current, ...rows]);
      setMoreHistory(rows.length === 50);
    } catch (error) {
      setProblem(problemFrom(error));
    }
  }

  if (authLoading) return <PageSpinner label="Opening PetroDollar" />;
  if (!permitted)
    return (
      <div className="invoice-desk petrodollar desk-denied">
        <Fuel size={36} />
        <h1>PetroDollar</h1>
        <p>Ask your administrator for station reporting access to open this app.</p>
      </div>
    );

  const company = bootstrap
    ? fuelCompanyName({ companyCode: bootstrap.company.code, companyName: bootstrap.company.name })
    : 'Mwanjalisi Oil Co Ltd';
  const section = SECTIONS.find((s) => s.id === view)!;
  const stations = bootstrap?.branches ?? [];
  const unconfigured =
    !!workspace &&
    !workspace.report &&
    (!workspace.catalog.tanks.length || !workspace.catalog.nozzles.length);

  return (
    <div className="invoice-desk petrodollar">
      <aside className="desk-rail">
        <div className="desk-identity">
          <AppGlyph app={app} size="medium" />
          <div>
            <strong>PetroDollar</strong>
            <span>{company}</span>
          </div>
        </div>
        <nav aria-label="PetroDollar">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={view === s.id ? 'page' : undefined}
              disabled={locked && !(editing(view) && editing(s.id))}
              onClick={() => go(s.id)}
            >
              <s.icon size={17} />
              {s.label}
              <ChevronRight size={13} />
            </button>
          ))}
        </nav>
        <span className="desk-os-label">ITEMBA OS</span>
      </aside>
      <div className="desk-main">
        <header className="desk-header">
          <div>
            <p className="desk-eyebrow">{company.toUpperCase()}</p>
            <h1>{section.label}</h1>
            <p>{section.blurb}</p>
          </div>
          <div className="desk-header-actions">
            <button
              type="button"
              className="desk-icon-button"
              aria-label="Refresh PetroDollar"
              disabled={locked}
              onClick={reload}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        {problem?.kind === 'unavailable' && (
          <p role="alert" className="desk-error">
            PetroDollar isn’t set up for Mwanjalisi Oil yet. The company is missing or inactive, so
            ask an administrator to check it. <button onClick={reload}>Retry</button>
          </p>
        )}
        {problem?.kind === 'error' && (
          <p role="alert" className="desk-error">
            {problem.message} <button onClick={reload}>Retry</button>
          </p>
        )}
        {stations.length > 0 && (
          <div className="desk-scope pd-scope">
            <div className="pd-fact">
              <span>Company</span>
              <strong>{company}</strong>
            </div>
            {stations.length > 1 ? (
              <label>
                <span>Station</span>
                <select
                  aria-label="Station"
                  value={branchId}
                  disabled={locked}
                  onChange={(e) => setBranchId(e.target.value)}
                >
                  {stations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="pd-fact">
                <span>Station</span>
                <strong>{stations[0].name}</strong>
              </div>
            )}
            {view !== 'history' && (
              <div className="ui-date-caption">
                <span>Business date</span>
                <FormDateField
                  aria-label="Business date"
                  value={date}
                  max={stationDate()}
                  disabled={locked}
                  onChange={(value) => {
                    if (value) setDate(value);
                  }}
                />
              </div>
            )}
            {editing(view) && (
              <div className="pd-shift" role="group" aria-label="Shift">
                <button
                  type="button"
                  aria-pressed={shift === 'DAY'}
                  disabled={locked}
                  onClick={() => setShift('DAY')}
                >
                  <Sun size={15} />
                  Day
                </button>
                <button
                  type="button"
                  aria-pressed={shift === 'NIGHT'}
                  disabled={locked}
                  onClick={() => setShift('NIGHT')}
                >
                  <Moon size={15} />
                  Night
                </button>
              </div>
            )}
          </div>
        )}
        {loading && (
          <p role="status" className="desk-loading">
            Loading station records…
          </p>
        )}
        {!loading && bootstrap && !stations.length && (
          <div className="desk-empty">
            <Fuel size={34} />
            <h3>No station assigned</h3>
            <p>
              {bootstrap.canAdmin
                ? 'No Mwanjalisi station is available to you. Add one in Fuel Reporting (Stations), or check that you have access to Mwanjalisi Oil.'
                : 'An administrator needs to assign you an active Mwanjalisi fuel station before you can report.'}
            </p>
          </div>
        )}
        {!loading && workspace && branch && (
          <>
            {editing(view) &&
              (unconfigured ? (
                <p role="status" className="pd-notice">
                  An administrator must set up this station’s tanks and pumps in Fuel Reporting
                  (Station setup) before its first report.
                </p>
              ) : (
                <div className="fuel-reporting pd-fr">
                  <ReportEditor
                    key={`${branchId}-${date}-${shift}`}
                    branch={branch}
                    date={date}
                    shift={shift}
                    workspace={workspace}
                    canManage={bootstrap?.canManage ?? false}
                    mode={view as 'report' | 'receive'}
                    onSaved={onSaved}
                    onLock={onLock}
                    apiBase="/petrodollar"
                  />
                  {workspace.report?.status === 'CLOSED' && (
                    <PetroDollarPosting
                      key={`${workspace.report.id}:${workspace.report.version}`}
                      report={workspace.report}
                      onLock={onPostingLock}
                    />
                  )}
                </div>
              ))}
            {view === 'daily' && (
              <div className="fuel-reporting pd-fr">
                <DailySummary reports={workspace.daily} date={date} branchName={branch.name} />
              </div>
            )}
          </>
        )}
        {!loading && branch && view === 'history' && (
          <div className="pd-history">
            <WorkspaceTable label="Report history">
              <thead>
                <tr>
                  <th>Business date</th>
                  <th>Shift</th>
                  <th>Status</th>
                  <th>Sales · TZS</th>
                  <th>Differences</th>
                  <th>Revision</th>
                  <th>Report</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td>{r.businessDate.slice(0, 10)}</td>
                    <td>{r.shift === 'DAY' ? 'Day' : 'Night'}</td>
                    <td>
                      <StatusBadge status={r.status === 'CLOSED' ? 'CLOSED' : 'DRAFT'} />
                    </td>
                    <td className="pd-number">{amount(r.summary.sales)}</td>
                    <td>{r.summary.flagged}</td>
                    <td>{r.version}</td>
                    <td>
                      <button
                        type="button"
                        className="desk-text-button"
                        onClick={() => {
                          setDate(r.businessDate.slice(0, 10));
                          setShift(r.shift);
                          go('report');
                        }}
                      >
                        Open report →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </WorkspaceTable>
            {!history.length && (
              <p className="desk-empty">No reports have been saved for this station yet.</p>
            )}
            {moreHistory && (
              <div className="desk-pagination">
                <button type="button" onClick={olderReports}>
                  Load older reports
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
