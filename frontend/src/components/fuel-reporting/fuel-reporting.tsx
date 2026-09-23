'use client';
import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Fuel, Moon, Sun } from 'lucide-react';
import { FormDateField } from '@/components/ui';
import { backendGet } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { ReportEditor } from './report-editor';
import { DailySummary } from './report-summary';
import { StationSetup } from './station-setup';
import { StationRegister } from './station-register';
import { fuelCompanyName } from './default-company';
import { amount, stationDate, type Bootstrap, type Report, type Workspace } from './types';
import './fuel-reporting.css';

type Tab = 'report' | 'receive' | 'daily' | 'history' | 'setup' | 'stations';
export function FuelReporting() {
  const { user, hasPermission, logout } = useAuth();
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [branchId, setBranchId] = useState('');
  const [date, setDate] = useState(stationDate);
  const [shift, setShift] = useState('DAY');
  const [tab, setTab] = useState<Tab>('report');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [history, setHistory] = useState<Report[]>([]);
  const [moreHistory, setMoreHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    setSigningOut(true);
    try {
      await logout();
    } catch {
      setError('Could not sign out. Check your connection and try again.');
      setSigningOut(false);
    }
  }
  const branch = bootstrap?.branches.find((b) => b.id === branchId);
  const permitted = hasPermission('fuel_reporting.read');

  useEffect(() => {
    if (!permitted) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    backendGet<Bootstrap>('/fuel-reporting/bootstrap')
      .then((data) => {
        if (cancelled) return;
        setBootstrap(data);
        if (data.canAdmin && !data.branches.length) setTab('stations');
        setBranchId(
          (data.branches.find((b) => b.companyCode === 'MWANJALISI') ?? data.branches[0])?.id ?? '',
        );
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [permitted]);

  useEffect(() => {
    if (!branchId) {
      setWorkspace(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setWorkspace(null);
    setError('');
    backendGet<Workspace>('/fuel-reporting/workspace', {
      query: { branchId, businessDate: date, shift },
    })
      .then((data) => {
        if (!cancelled) {
          setWorkspace(data);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [branchId, date, shift]);

  useEffect(() => {
    if (tab !== 'history' || !branchId) return;
    let cancelled = false;
    backendGet<Report[]>('/fuel-reporting/history', { query: { branchId } })
      .then((data) => {
        if (!cancelled) {
          setHistory(data);
          setMoreHistory(data.length === 50);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, branchId]);

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
  const refresh = async () => {
    setWorkspace(
      await backendGet<Workspace>('/fuel-reporting/workspace', {
        query: { branchId, businessDate: date, shift },
      }),
    );
  };
  const refreshStations = async (preferredId?: string) => {
    const data = await backendGet<Bootstrap>('/fuel-reporting/bootstrap');
    setBootstrap(data);
    setBranchId(
      data.branches.find((b) => b.id === (preferredId ?? branchId))?.id ??
        data.branches[0]?.id ??
        '',
    );
    setLoading(false);
  };
  const companies = [
    ...new Map(bootstrap?.branches.map((b) => [b.companyId, fuelCompanyName(b)]) ?? []).entries(),
  ];

  if (!permitted)
    return (
      <div className="fuel-reporting">
        <div className="fr-error">
          Fuel Reporting is available to assigned station managers and authorized reviewers. Ask an
          admin to assign your branch and reporting access.
          <p>
            <button type="button" disabled={signingOut} onClick={signOut}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </p>
          {error && <p role="alert">{error}</p>}
        </div>
      </div>
    );
  return (
    <main className="fuel-reporting">
      <header className="fr-header">
        <div className="fr-brand">
          <div className="fr-logo">
            <Fuel size={28} aria-hidden="true" />
          </div>
          <div>
            <span className="fr-eyebrow">STATION OPERATIONS</span>
            <h1>Fuel Reporting</h1>
            <p>Daily sales, fuel received & shift reconciliation.</p>
          </div>
        </div>
        <div className="fr-manager">
          <span>Reporting as</span>
          <strong>{user?.fullName}</strong>
          <small>
            {bootstrap?.canAdmin
              ? 'Administrator'
              : bootstrap?.canManage
                ? 'Station manager'
                : 'Report reviewer'}
          </small>
          <button
            type="button"
            className="fr-signout"
            disabled={locked || signingOut}
            onClick={signOut}
            title={locked ? 'Wait for your report to finish saving before signing out.' : undefined}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </header>
      <div className="fr-toolbar">
        <label>
          <span>Company</span>
          <select
            aria-label="Company"
            disabled={locked || !bootstrap}
            value={branch?.companyId ?? ''}
            onChange={(e) =>
              setBranchId(bootstrap?.branches.find((b) => b.companyId === e.target.value)?.id ?? '')
            }
          >
            {companies.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Branch</span>
          <select
            aria-label="Branch"
            disabled={locked || !bootstrap}
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            {bootstrap?.branches
              .filter((b) => b.companyId === branch?.companyId)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
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
        <div className="fr-shift-toggle" role="group" aria-label="Shift">
          <button
            type="button"
            disabled={locked}
            aria-pressed={shift === 'DAY'}
            onClick={() => setShift('DAY')}
          >
            <Sun size={16} />
            Day
          </button>
          <button
            type="button"
            disabled={locked}
            aria-pressed={shift === 'NIGHT'}
            onClick={() => setShift('NIGHT')}
          >
            <Moon size={16} />
            Night
          </button>
        </div>
      </div>
      <nav className="fr-tabs" aria-label="Fuel reporting views">
        {(
          [
            ['report', 'Shift report'],
            ['receive', 'Fuel received'],
            ['daily', 'Daily summary'],
            ['history', 'Report history'],
            ...(bootstrap?.canAdmin
              ? [
                  ['stations', 'Stations'],
                  ['setup', 'Station setup'],
                ]
              : []),
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-current={tab === id ? 'page' : undefined}
            disabled={
              locked && !(['report', 'receive'].includes(tab) && ['report', 'receive'].includes(id))
            }
            onClick={() => setTab(id)}
          >
            {label}
            {id === 'daily' && workspace ? (
              <span>{workspace.daily.filter((r) => r.status === 'CLOSED').length}/2</span>
            ) : null}
          </button>
        ))}
      </nav>
      <div className="fr-content">
        {error ? (
          <div role="alert" className="fr-error">
            {error}
            <button
              type="button"
              className="fr-text-button"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        ) : null}
        {loading ? (
          <div role="status" className="fr-loading">
            <ClipboardList size={26} />
            <p>Loading station records…</p>
          </div>
        ) : null}
        {tab === 'stations' && bootstrap?.canAdmin ? (
          <StationRegister
            onChanged={refreshStations}
            onConfigure={(id) => {
              setBranchId(id);
              setTab('setup');
            }}
          />
        ) : null}
        {!loading && bootstrap && !bootstrap.branches.length && tab !== 'stations' ? (
          <div className="fr-empty-state">
            <Fuel size={34} />
            <h2>No station assigned</h2>
            <p>
              {bootstrap.canAdmin
                ? 'Open Stations to add your first station.'
                : 'An admin needs to assign you an active fuel station branch before you can report.'}
            </p>
          </div>
        ) : null}
        {!loading && workspace && branch ? (
          <>
            {tab === 'report' || tab === 'receive' ? (
              !workspace.report &&
              (!workspace.catalog.tanks.length || !workspace.catalog.nozzles.length) ? (
                <div className="fr-notice">
                  An admin must configure this branch’s tanks and pumps in Station setup before its
                  first report.
                </div>
              ) : (
                <ReportEditor
                  key={`${branchId}-${date}-${shift}`}
                  branch={branch}
                  date={date}
                  shift={shift}
                  workspace={workspace}
                  canManage={bootstrap?.canManage ?? false}
                  mode={tab}
                  onSaved={onSaved}
                  onLock={setLocked}
                />
              )
            ) : null}
            {tab === 'daily' ? (
              <DailySummary reports={workspace.daily} date={date} branchName={branch.name} />
            ) : null}
            {tab === 'history' ? (
              <>
                <div className="fr-day-heading">
                  <div>
                    <h2>Branch report history</h2>
                    <p>
                      Open a shift to review all entries, discrepancies and preserved revisions.
                    </p>
                  </div>
                </div>
                <div className="fr-table-scroll fr-history">
                  <table>
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
                            <span
                              className={`fr-badge ${r.status === 'CLOSED' ? 'fr-badge-closed' : ''}`}
                            >
                              {r.status === 'CLOSED' ? 'Closed' : 'Draft'}
                            </span>
                          </td>
                          <td className="fr-number">{amount(r.summary.sales)}</td>
                          <td>{r.summary.flagged}</td>
                          <td>{r.version}</td>
                          <td>
                            <button
                              type="button"
                              className="fr-text-button"
                              onClick={() => {
                                setDate(r.businessDate.slice(0, 10));
                                setShift(r.shift);
                                setTab('report');
                              }}
                            >
                              Open report →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!history.length ? (
                    <p className="fr-empty">No reports have been saved for this branch yet.</p>
                  ) : null}
                </div>
                {moreHistory ? (
                  <button
                    type="button"
                    className="fr-secondary"
                    onClick={async () => {
                      try {
                        const rows = await backendGet<Report[]>('/fuel-reporting/history', {
                          query: { branchId, before: history.at(-1)?.id },
                        });
                        setHistory([...history, ...rows]);
                        setMoreHistory(rows.length === 50);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'Could not load older reports.');
                      }
                    }}
                  >
                    Load older reports
                  </button>
                ) : null}
              </>
            ) : null}
            {tab === 'setup' && bootstrap?.canAdmin ? (
              <StationSetup
                key={branchId}
                branchId={branchId}
                workspace={workspace}
                refresh={refresh}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}
