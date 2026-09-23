'use client';

import { useEffect, useState } from 'react';
import { backendGet, backendPost } from '@/lib/api-client';
import { Field, Section } from './report-fields';
import { defaultFuelDivision, fuelCompanyName, DEFAULT_FUEL_COMPANY_NAME } from './default-company';

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
  divisions: Division[];
  stations: Station[];
}
const empty = { code: '', name: '', location: '' };

export function StationRegister({
  onChanged,
  onConfigure,
}: {
  onChanged: (preferredId?: string) => Promise<void>;
  onConfigure: (id: string) => void;
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
  useEffect(() => {
    let cancelled = false;
    backendGet<Register>('/fuel-reporting/stations')
      .then((data) => {
        if (cancelled) return;
        setRegister(data);
        const first = defaultFuelDivision(data.divisions);
        setDivisionId(first?.id ?? '');
        setCompanyId(first?.companyId ?? '');
        setError('');
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);
  async function run(action: () => Promise<string | undefined>, message: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const preferred = await action();
      setForm(empty);
      setEditing(null);
      const updated = await backendGet<Register>('/fuel-reporting/stations');
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
    const defaultDivision = defaultFuelDivision(data.divisions);
    setEditing(null);
    setForm(empty);
    setCompanyId(defaultDivision?.companyId ?? '');
    setDivisionId(defaultDivision?.id ?? '');
  }
  const companies = [
    ...new Map(register?.divisions.map((d) => [d.companyId, fuelCompanyName(d)]) ?? []).entries(),
  ];
  return (
    <div>
      <div className="fr-day-heading">
        <div>
          <h2>Station management</h2>
          <p>Add and maintain the stations available in Fuel Reporting.</p>
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
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                async () => {
                  const station = await backendPost<Station>(
                    editing
                      ? `/fuel-reporting/stations/${editing}/update`
                      : '/fuel-reporting/stations',
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
                {!editing && !defaultFuelDivision(register.divisions) && (
                  <p className="fr-notice">
                    {DEFAULT_FUEL_COMPANY_NAME} has no available division for your account. Ask an
                    administrator to check company access, or select another company explicitly.
                  </p>
                )}
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
                      {companies.map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Station division">
                    <select
                      required
                      disabled={!!editing}
                      value={divisionId}
                      onChange={(e) => setDivisionId(e.target.value)}
                    >
                      <option value="">Select division</option>
                      {register.divisions
                        .filter((d) => d.companyId === companyId)
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Station code">
                    <input
                      required
                      maxLength={60}
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value })}
                      placeholder="STATION-03"
                    />
                  </Field>
                  <Field label="Station name">
                    <input
                      required
                      maxLength={160}
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Branch name"
                    />
                  </Field>
                  <Field label="Station location">
                    <input
                      maxLength={300}
                      value={form.location}
                      onChange={(e) => setForm({ ...form, location: e.target.value })}
                      placeholder="Town or area (optional)"
                    />
                  </Field>
                </div>
                {!register.divisions.length && (
                  <p className="fr-notice">
                    No active company division is available. Create a company division in Itemba
                    before adding its stations.
                  </p>
                )}
                <div className="fr-actions">
                  <button type="submit" className="fr-primary" disabled={!divisionId}>
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
              <p>No stations yet. Add the first station above.</p>
            ) : (
              <div className="fr-table-scroll">
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
                                  disabled={busy}
                                  onClick={() => onConfigure(station.id)}
                                >
                                  Configure
                                </button>
                              )}
                              <button
                                type="button"
                                className="fr-text-button"
                                disabled={busy}
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
                                  window.document
                                    .querySelector('.fr-content')
                                    ?.scrollIntoView({ behavior: 'smooth' });
                                }}
                              >
                                Edit station
                              </button>
                              <button
                                type="button"
                                className="fr-text-button"
                                disabled={busy}
                                onClick={() => {
                                  if (
                                    station.isActive &&
                                    !window.confirm(
                                      `Remove ${station.name} from active stations in Fuel Reporting and Itemba? Its records will be retained. Close draft reports first.`,
                                    )
                                  )
                                    return;
                                  void run(
                                    async () => {
                                      await backendPost(
                                        `/fuel-reporting/stations/${station.id}/${station.isActive ? 'deactivate' : 'restore'}`,
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
