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
  Settings2,
  MapPin,
  Sun,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { fuelCompanyName } from '@/components/fuel-reporting/default-company';
import { ReportEditor } from '@/components/fuel-reporting/report-editor';
import { DailySummary } from '@/components/fuel-reporting/report-summary';
import { StationRegister } from '@/components/fuel-reporting/station-register';
import { StationSetup } from '@/components/fuel-reporting/station-setup';
import {
  stationDate,
  type Branch,
  type Report,
  type Workspace,
} from '@/components/fuel-reporting/types';
import { AppGlyph } from '@/components/os/app-glyph';
import { FormDateField, PageSpinner } from '@/components/ui';
import { useFormGuard } from '@/components/workspace/unsaved-work-provider';
import {
  useWorkspaceRouter,
  useWorkspaceSearchParams,
} from '@/components/workspace/workspace-navigation';
import { useAuth } from '@/hooks/use-auth';
import { ApiError, backendGet } from '@/lib/api-client';
import { getApp } from '@/lib/apps';
import {
  petrodollarHref,
  petrodollarDate,
  petrodollarView,
  type PetroDollarView as View,
} from '@/lib/petrodollar-navigation';
export { petrodollarView } from '@/lib/petrodollar-navigation';
import '@/components/fuel-reporting/fuel-reporting.css';
import '../invoice-desk/invoice-desk.css';
import './petrodollar.css';
import { PetroDollarHistory } from './petrodollar-history';
import { PetroDollarPosting } from './petrodollar-posting';

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
  {
    id: 'stations',
    label: 'Stations',
    blurb: 'Manage Mwanjalisi stations and their organisation links.',
    icon: MapPin,
  },
  {
    id: 'setup',
    label: 'Station setup',
    blurb: 'Tanks, pumps and nozzle connections for this station.',
    icon: Settings2,
  },
];

interface Bootstrap {
  company: { id: string; code: string; name: string };
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
  const [today] = useState(stationDate);
  const requestedBranch = params.get('branchId');
  const branchId =
    bootstrap?.branches.find((b) => b.id === requestedBranch)?.id ??
    bootstrap?.branches[0]?.id ??
    '';
  const date = petrodollarDate(params.get('date'), today);
  const shift = params.get('shift') === 'NIGHT' ? 'NIGHT' : 'DAY';
  const [workspaceResult, setWorkspaceResult] = useState<{
    key: string;
    data: Workspace | null;
    problem?: Problem;
  } | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootstrapProblem, setBootstrapProblem] = useState<Problem | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editorLocked, setEditorLocked] = useState(false);
  const [postingLocked, setPostingLocked] = useState(false);
  const [setupLocked, setSetupLocked] = useState(false);
  const locked = editorLocked || postingLocked || setupLocked;
  const needsWorkspace = view !== 'history' && view !== 'stations';
  const workspaceKey = `${branchId}/${date}/${shift}/${reloadKey}`;
  const selectedWorkspace = workspaceResult?.key === workspaceKey ? workspaceResult : null;
  const workspace = selectedWorkspace?.data;
  const loading = booting || (needsWorkspace && !!branchId && !selectedWorkspace);
  const problem = bootstrapProblem ?? (needsWorkspace ? selectedWorkspace?.problem : null);
  const branch = bootstrap?.branches.find((b) => b.id === branchId);
  const reload = () => setReloadKey((key) => key + 1);

  // The editor reports "unsaved or saving"; mirror it into the window's unsaved-work guard so
  // closing the window or leaving the app asks first. touch/markSaved are stable callbacks.
  const { touch, markSaved } = useFormGuard({ unsaved: locked });
  const locks = useRef({ editor: false, posting: false, setup: false });
  const onLock = useCallback(
    (value: boolean) => {
      locks.current.editor = value;
      if (locks.current.editor || locks.current.posting || locks.current.setup) touch();
      else markSaved();
      setEditorLocked(value);
    },
    [touch, markSaved],
  );
  const onPostingLock = useCallback(
    (value: boolean) => {
      locks.current.posting = value;
      if (locks.current.editor || locks.current.posting || locks.current.setup) touch();
      else markSaved();
      setPostingLocked(value);
    },
    [touch, markSaved],
  );
  const onSetupLock = useCallback(
    (value: boolean) => {
      locks.current.setup = value;
      if (locks.current.editor || locks.current.posting || value) touch();
      else markSaved();
      setSetupLocked(value);
    },
    [touch, markSaved],
  );

  const go = (next: View, scope: Record<string, string> = {}) =>
    router.push(petrodollarHref(params, { view: next, ...scope }));

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
        setBootstrapProblem(null);
        setBooting(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setBootstrapProblem(problemFrom(error));
        setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [permitted, reloadKey]);

  // Persist the selected station/day/shift in this window's own navigation history.
  // Run before the first editor is loaded, so normal panel changes preserve dirty inputs.
  useEffect(() => {
    if (
      locked ||
      !branchId ||
      (params.get('branchId') === branchId &&
        params.get('date') === date &&
        params.get('shift') === shift)
    )
      return;
    router.replace(petrodollarHref(params, { branchId, date, shift }));
  }, [branchId, date, shift, params, router, locked]);

  useEffect(() => {
    if (!needsWorkspace || !branchId) {
      setWorkspaceResult(null);
      return;
    }
    let cancelled = false;
    backendGet<Workspace>('/petrodollar/workspace', {
      query: { branchId, businessDate: date, shift },
    })
      .then((data) => {
        if (cancelled) return;
        setWorkspaceResult({ key: workspaceKey, data });
      })
      .catch((error) => {
        if (cancelled) return;
        setWorkspaceResult({ key: workspaceKey, data: null, problem: problemFrom(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [needsWorkspace, branchId, date, shift, workspaceKey]);

  const onSaved = useCallback(
    (report: Report) =>
      setWorkspaceResult((current) =>
        current?.key === workspaceKey && current.data
          ? {
              key: workspaceKey,
              data: {
                ...current.data,
                report,
                daily: [...current.data.daily.filter((r) => r.id !== report.id), report].sort(
                  (a, b) => a.shift.localeCompare(b.shift),
                ),
              },
            }
          : current,
      ),
    [workspaceKey],
  );
  async function refreshStation() {
    const data = await backendGet<Bootstrap>('/petrodollar/bootstrap');
    setBootstrap(data);
    const selected = data.branches.find((b) => b.id === branchId)?.id ?? data.branches[0]?.id;
    if (needsWorkspace && selected === branchId) {
      const data = await backendGet<Workspace>('/petrodollar/workspace', {
        query: { branchId, businessDate: date, shift },
      });
      setWorkspaceResult((current) =>
        current?.key === workspaceKey ? { key: workspaceKey, data } : current,
      );
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
          {SECTIONS.filter((s) => !['stations', 'setup'].includes(s.id) || bootstrap?.canAdmin).map(
            (s) => (
              <button
                key={s.id}
                type="button"
                aria-current={view === s.id ? 'page' : undefined}
                disabled={
                  locked &&
                  !(
                    editorLocked &&
                    !postingLocked &&
                    !setupLocked &&
                    editing(view) &&
                    editing(s.id)
                  )
                }
                onClick={() => go(s.id)}
              >
                <s.icon size={17} />
                {s.label}
                <ChevronRight size={13} />
              </button>
            ),
          )}
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
        {stations.length > 0 && view !== 'stations' && (
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
                  onChange={(e) => go(view, { branchId: e.target.value })}
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
            {(editing(view) || view === 'daily') && (
              <div className="ui-date-caption">
                <span>Business date</span>
                <FormDateField
                  aria-label="Business date"
                  value={date}
                  max={stationDate()}
                  disabled={locked}
                  onChange={(value) => {
                    if (value) go(view, { date: value });
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
                  onClick={() => go(view, { shift: 'DAY' })}
                >
                  <Sun size={15} />
                  Day
                </button>
                <button
                  type="button"
                  aria-pressed={shift === 'NIGHT'}
                  disabled={locked}
                  onClick={() => go(view, { shift: 'NIGHT' })}
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
        {!loading && bootstrap && !stations.length && view !== 'stations' && (
          <div className="desk-empty">
            <Fuel size={34} />
            <h3>No station assigned</h3>
            <p>
              {bootstrap.canAdmin
                ? 'No Mwanjalisi station is available to you. Add one in Stations, or check that you have access to Mwanjalisi Oil.'
                : 'An administrator needs to assign you an active Mwanjalisi fuel station before you can report.'}
            </p>
            {bootstrap.canAdmin && (
              <button className="desk-primary" onClick={() => go('stations')}>
                Manage stations
              </button>
            )}
          </div>
        )}
        {!loading && workspace && branch && (
          <>
            {editing(view) &&
              (unconfigured ? (
                <p role="status" className="pd-notice">
                  An administrator must set up this station’s tanks and pumps before its first
                  report.
                  {bootstrap?.canAdmin && (
                    <button className="fr-text-button" onClick={() => go('setup')}>
                      Open station setup
                    </button>
                  )}
                </p>
              ) : (
                <div className="fuel-reporting pd-fr">
                  <ReportEditor
                    key={`${branchId}-${date}-${shift}`}
                    branch={branch}
                    date={date}
                    shift={shift}
                    workspace={workspace}
                    canManage={workspace.canManageReports === true}
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
            {view === 'setup' && bootstrap?.canAdmin && (
              <div className="fuel-reporting pd-fr">
                <StationSetup
                  key={branchId}
                  branchId={branchId}
                  workspace={workspace}
                  refresh={refreshStation}
                  apiBase="/petrodollar"
                  onLock={onSetupLock}
                />
              </div>
            )}
          </>
        )}
        {!loading && branch && view === 'history' && (
          <PetroDollarHistory
            key={`${branchId}/${reloadKey}`}
            branchId={branchId}
            onOpen={(report) =>
              go('report', { date: report.businessDate.slice(0, 10), shift: report.shift })
            }
          />
        )}
        {!booting && bootstrap && view === 'stations' && bootstrap.canAdmin && (
          <div className="fuel-reporting pd-fr">
            <StationRegister
              apiBase="/petrodollar"
              onChanged={refreshStation}
              onConfigure={(id) => go('setup', { branchId: id })}
              onLock={onSetupLock}
            />
          </div>
        )}
        {!booting && bootstrap && ['stations', 'setup'].includes(view) && !bootstrap.canAdmin && (
          <p role="alert" className="desk-error">
            Station administration is available to authorised group administrators.
          </p>
        )}
      </div>
    </div>
  );
}
