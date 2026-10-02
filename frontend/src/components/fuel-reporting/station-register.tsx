'use client';

import { useEffect, useRef, useState } from 'react';
import { backendGet, backendPost } from '@/lib/api-client';
import { Field, Section } from './report-fields';
import { fuelCompanyName, DEFAULT_FUEL_COMPANY_CODE } from './default-company';

interface Company {
  id: string;
  name: string;
  code: string;
  canManageStations: boolean;
}

interface Division {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  companyCode: string;
}
interface Station {
  id: string;
  divisionId: string;
  code: string;
  name: string;
  location: string | null;
  isActive: boolean;
}
interface Register {
  companies?: Company[];
  divisions: Division[];
  stations: Station[];
}
const empty = { code: '', name: '', location: '' };

function stationCompanies(data: Register): Company[] {
  // Accept the previous response shape while frontend and API releases roll out.
  return (
    data.companies ??
    [...new Map(data.divisions.map((d) => [d.companyId, d])).values()].map((d) => ({
      id: d.companyId,
      name: fuelCompanyName(d),
      code: d.companyCode,
      canManageStations: true,
    }))
  );
}

function defaultStationScope(data: Register) {
  const companies = stationCompanies(data);
  const company = companies.find((c) => c.code === DEFAULT_FUEL_COMPANY_CODE) ?? companies[0];
  return {
    companyId: company?.id ?? '',
    divisionId: data.divisions.find((d) => d.companyId === company?.id)?.id ?? '',
  };
}

export function StationRegister({
  onChanged,
  onConfigure,
  apiBase = '/fuel-reporting',
  onLock,
}: {
  onChanged: (preferredId?: string) => Promise<void>;
  onConfigure: (id: string) => void;
  apiBase?: string;
  onLock?: (locked: boolean) => void;
}) {
  const [register, setRegister] = useState<Register | null>(null);
  const [divisionId, setDivisionId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const original = register?.stations.find((station) => station.id === editing);
  const dirty = editing
    ? !!original &&
      (form.code !== original.code ||
        form.name !== original.name ||
        form.location !== (original.location ?? ''))
    : !!(form.code || form.name || form.location);
  useEffect(() => {
    onLock?.(dirty || busy);
  }, [dirty, busy, onLock]);
  useEffect(() => () => onLock?.(false), [onLock]);
  useEffect(() => {
    let cancelled = false;
    backendGet<Register>(`${apiBase}/stations`)
      .then((data) => {
        if (cancelled) return;
        setRegister(data);
        const initial = defaultStationScope(data);
        setDivisionId(initial.divisionId);
        setCompanyId(initial.companyId);
        setError('');
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [reload, apiBase]);
  async function run(action: () => Promise<string | undefined>, message: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const preferred = await action();
      setForm(empty);
      setEditing(null);
      const updated = await backendGet<Register>(`${apiBase}/stations`);
      setRegister(updated);
      resetNewStation(updated);
      await onChanged(preferred);
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the station.');
    } finally {
      setBusy(false);
    }
  }
  function resetNewStation(data: Register) {
    const initial = defaultStationScope(data);
    setEditing(null);
    setForm(empty);
    setCompanyId(initial.companyId);
    setDivisionId(initial.divisionId);
  }
  const companies = register ? stationCompanies(register) : [];
  const selectedCompany = companies.find((company) => company.id === companyId);
  const canManage = selectedCompany?.canManageStations ?? false;
  const availableDivisions = register?.divisions.filter((d) => d.companyId === companyId) ?? [];
  const companyName = selectedCompany
    ? fuelCompanyName({ companyCode: selectedCompany.code, companyName: selectedCompany.name })
    : '';
  return (
    <div>
      <div className="fr-day-heading">
        <div>
          <h2>Station management</h2>
          <p>Add and maintain the stations available in PetroDollar.</p>
        </div>
      </div>
      <p className="fr-notice">
        Stations are shared with Itemba. Removing a station makes it inactive in both interfaces.
        Reports, pumps, tanks, and assignments are retained; restore the station to use them again.
      </p>
      {error && (
        <p className="fr-error" role="alert">
          {error}{' '}
          {!register && (
            <button className="fr-text-button" onClick={() => setReload(reload + 1)}>
              Retry
            </button>
          )}
        </p>
      )}
      {notice && (
        <p className="fr-success" role="status">
          {notice}
        </p>
      )}
      {!register && !error && <p role="status">Loading stations…</p>}
      {register && (
        <>
          <form
            ref={formRef}
            onSubmit={(e) => {
              e.preventDefault();
              if (!canManage || !divisionId) return;
              void run(
                async () => {
                  const station = await backendPost<Station>(
                    editing ? `${apiBase}/stations/${editing}/update` : `${apiBase}/stations`,
                    editing ? form : { ...form, divisionId },
                  );
                  return station.isActive ? station.id : undefined;
                },
                editing
                  ? 'Station updated.'
                  : 'Station added. Select Configure to add its tanks and pumps.',
              );
            }}
          >
            <fieldset disabled={busy}>
              <Section title={editing ? 'Edit station' : 'Add station'}>
                {!canManage ? (
                  <p className="fr-notice" role="status">
                    {selectedCompany
                      ? `You have read-only access to ${companyName}. Company write access is required to add, edit or configure stations. Ask an administrator to update your company access.`
                      : 'No company is available for your account. Ask an administrator to check your company access.'}
                  </p>
                ) : !availableDivisions.length ? (
                  <p className="fr-notice" role="status">
                    No active division is available for {companyName}. Add or activate a division in
                    organisation settings before adding a station.
                  </p>
                ) : null}
                <div className="fr-grid">
                  <Field label="Station company">
                    <select
                      required
                      disabled={!!editing}
                      value={companyId}
                      onChange={(e) => {
                        setCompanyId(e.target.value);
                        setDivisionId(
                          register.divisions.find((d) => d.companyId === e.target.value)?.id ?? '',
                        );
                      }}
                    >
                      <option value="">Select company</option>
                      {companies.map((company) => (
                        <option key={company.id} value={company.id}>
                          {fuelCompanyName({
                            companyCode: company.code,
                            companyName: company.name,
                          })}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Station division">
                    <select
                      required
                      disabled={!!editing || !availableDivisions.length}
                      value={divisionId}
                      onChange={(e) => setDivisionId(e.target.value)}
                    >
                      <option value="">Select division</option>
                      {availableDivisions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Station code">
                    <input
                      required
                      disabled={!canManage || !divisionId}
                      maxLength={60}
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value })}
                      placeholder="STATION-03"
                    />
                  </Field>
                  <Field label="Station name">
                    <input
                      required
                      disabled={!canManage || !divisionId}
                      maxLength={160}
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Branch name"
                    />
                  </Field>
                  <Field label="Station location">
                    <input
                      disabled={!canManage || !divisionId}
                      maxLength={300}
                      value={form.location}
                      onChange={(e) => setForm({ ...form, location: e.target.value })}
                      placeholder="Town or area (optional)"
                    />
                  </Field>
                </div>
                <div className="fr-actions">
                  <button type="submit" className="fr-primary" disabled={!divisionId || !canManage}>
                    {busy ? 'Saving…' : editing ? 'Save station' : 'Add station'}
                  </button>
                  {editing && (
                    <button
                      type="button"
                      className="fr-secondary"
                      onClick={() => {
                        resetNewStation(register);
                      }}
                    >
                      Cancel edit
                    </button>
                  )}
                </div>
              </Section>
            </fieldset>
          </form>
          <Section
            title="Station register"
            detail={`${register.stations.filter((s) => s.isActive).length} active · ${register.stations.filter((s) => !s.isActive).length} removed`}
          >
            {!register.stations.length ? (
              <p>
                {canManage && divisionId
                  ? 'No stations yet. Add the first station above.'
                  : 'No stations to display.'}
              </p>
            ) : (
              <div
                className="fr-table-scroll"
                role="region"
                aria-label="Station register"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Station</th>
                      <th>Company / division</th>
                      <th>Location</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {register.stations.map((station) => {
                      const division = register.divisions.find((d) => d.id === station.divisionId);
                      const canChangeStation =
                        companies.find((company) => company.id === division?.companyId)
                          ?.canManageStations ?? false;
                      return (
                        <tr key={station.id}>
                          <td>
                            <strong>{station.name}</strong>
                            <br />
                            <small>{station.code}</small>
                          </td>
                          <td>
                            {division ? fuelCompanyName(division) : ''}
                            <br />
                            <small>{division?.name}</small>
                          </td>
                          <td>{station.location || '—'}</td>
                          <td>{station.isActive ? 'Active' : 'Removed · history retained'}</td>
                          <td>
                            <div className="fr-actions">
                              {station.isActive && (
                                <button
                                  type="button"
                                  className="fr-text-button"
                                  disabled={busy || dirty || !canChangeStation}
                                  onClick={() => onConfigure(station.id)}
                                >
                                  Configure
                                </button>
                              )}
                              <button
                                type="button"
                                className="fr-text-button"
                                disabled={busy || dirty || !canChangeStation}
                                onClick={() => {
                                  setEditing(station.id);
                                  setForm({
                                    code: station.code,
                                    name: station.name,
                                    location: station.location ?? '',
                                  });
                                  setDivisionId(station.divisionId);
                                  setCompanyId(division?.companyId ?? '');
                                  setNotice('');
                                  formRef.current?.scrollIntoView({ block: 'start' });
                                }}
                              >
                                Edit station
                              </button>
                              <button
                                type="button"
                                className="fr-text-button"
                                disabled={busy || dirty || !canChangeStation}
                                onClick={() => {
                                  if (
                                    station.isActive &&
                                    !window.confirm(
                                      `Remove ${station.name} from active stations in PetroDollar and Itemba? Its records will be retained. Close draft reports first.`,
                                    )
                                  )
                                    return;
                                  void run(
                                    async () => {
                                      await backendPost(
                                        `${apiBase}/stations/${station.id}/${station.isActive ? 'deactivate' : 'restore'}`,
                                      );
                                      return station.isActive ? undefined : station.id;
                                    },
                                    station.isActive
                                      ? 'Station removed. Its history is retained.'
                                      : 'Station restored.',
                                  );
                                }}
                              >
                                {station.isActive ? 'Remove station' : 'Restore station'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
