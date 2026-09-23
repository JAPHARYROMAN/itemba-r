'use client';
import { useState } from 'react';
import { backendPost } from '@/lib/api-client';
import type { Workspace } from './types';
import { Field, Numeric, Section } from './report-fields';

export function StationSetup({
  branchId,
  workspace,
  refresh,
}: {
  branchId: string;
  workspace: Workspace;
  refresh: () => Promise<void>;
}) {
  const [pump, setPump] = useState({
    code: '',
    name: '',
    nozzles: [{ code: '', tankId: workspace.catalog.tanks[0]?.id ?? '' }],
  });
  const [tank, setTank] = useState({
    code: '',
    name: '',
    productId: workspace.products[0]?.id ?? '',
    capacityLitres: 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await refresh();
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save station configuration.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <p className="fr-notice">
        Admin configuration. Removing a pump deactivates it for future reports and preserves its
        history.
      </p>
      {error ? (
        <p role="alert" className="fr-error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="fr-success">
          {notice}
        </p>
      ) : null}
      <Section title="Branch pumps">
        <div className="fr-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Pump</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {workspace.pumps.map((p) => (
                <tr key={p.id}>
                  <td>{p.pumpCode}</td>
                  <td>{p.pumpName}</td>
                  <td>{p.status === 'ACTIVE' ? 'Active' : 'Inactive'}</td>
                  <td>
                    {p.status === 'ACTIVE' ? (
                      <button
                        type="button"
                        disabled={busy}
                        className="fr-text-button"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove ${p.pumpName} from future shifts? Existing reports will be kept.`,
                            )
                          )
                            void run(
                              () => backendPost(`/fuel-reporting/pumps/${p.id}/deactivate`),
                              'Pump removed from future shifts.',
                            );
                        }}
                      >
                        Remove pump
                      </button>
                    ) : (
                      'History retained'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await backendPost('/fuel-reporting/pumps', { ...pump, branchId });
            setPump({
              code: '',
              name: '',
              nozzles: [{ code: '', tankId: workspace.catalog.tanks[0]?.id ?? '' }],
            });
          }, 'Pump added.');
        }}
      >
        <fieldset disabled={busy}>
          <Section
            title="Add pump"
            detail="Configure each nozzle’s fuel connection once. Managers will use this list when entering reports."
          >
            <div className="fr-grid">
              <Field label="Pump code">
                <input
                  required
                  value={pump.code}
                  maxLength={60}
                  onChange={(e) => setPump({ ...pump, code: e.target.value })}
                  placeholder="PUMP-03"
                />
              </Field>
              <Field label="Pump name">
                <input
                  required
                  value={pump.name}
                  maxLength={160}
                  onChange={(e) => setPump({ ...pump, name: e.target.value })}
                  placeholder="Pump 3"
                />
              </Field>
            </div>
            {pump.nozzles.map((n, i) => (
              <div className="fr-entry" key={i}>
                <Field label="Nozzle code">
                  <input
                    required
                    maxLength={60}
                    value={n.code}
                    onChange={(e) =>
                      setPump({
                        ...pump,
                        nozzles: pump.nozzles.map((x, index) =>
                          index === i ? { ...x, code: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="Connected tank / fuel">
                  <select
                    required
                    value={n.tankId}
                    onChange={(e) =>
                      setPump({
                        ...pump,
                        nozzles: pump.nozzles.map((x, index) =>
                          index === i ? { ...x, tankId: e.target.value } : x,
                        ),
                      })
                    }
                  >
                    <option value="">Select a tank</option>
                    {workspace.catalog.tanks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.tankName} · {t.productName}
                      </option>
                    ))}
                  </select>
                </Field>
                {i ? (
                  <button
                    type="button"
                    className="fr-text-button"
                    onClick={() =>
                      setPump({ ...pump, nozzles: pump.nozzles.filter((_, index) => index !== i) })
                    }
                  >
                    Remove nozzle
                  </button>
                ) : null}
              </div>
            ))}
            <div className="fr-actions">
              <button
                type="button"
                className="fr-secondary"
                onClick={() =>
                  setPump({
                    ...pump,
                    nozzles: [
                      ...pump.nozzles,
                      { code: '', tankId: workspace.catalog.tanks[0]?.id ?? '' },
                    ],
                  })
                }
              >
                + Add nozzle
              </button>
              <button className="fr-primary" disabled={!workspace.catalog.tanks.length}>
                Add pump
              </button>
            </div>
          </Section>
        </fieldset>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await backendPost('/fuel-reporting/tanks', { ...tank, branchId });
            setTank({ ...tank, code: '', name: '', capacityLitres: 0 });
          }, 'Tank added for manual dipping.');
        }}
      >
        <fieldset disabled={busy}>
          <Section
            title="Tank register"
            detail="Tanks are used for mandatory shift dipping. Fuel deliveries remain recorded by fuel type."
          >
            <div className="fr-grid">
              <Field label="Tank code">
                <input
                  required
                  maxLength={60}
                  value={tank.code}
                  onChange={(e) => setTank({ ...tank, code: e.target.value })}
                />
              </Field>
              <Field label="Tank name">
                <input
                  required
                  maxLength={160}
                  value={tank.name}
                  onChange={(e) => setTank({ ...tank, name: e.target.value })}
                />
              </Field>
              <Field label="Fuel product">
                <select
                  required
                  value={tank.productId}
                  onChange={(e) => setTank({ ...tank, productId: e.target.value })}
                >
                  <option value="">Select fuel product</option>
                  {workspace.products.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tank capacity · litres">
                <Numeric
                  label="Tank capacity"
                  places={2}
                  value={tank.capacityLitres}
                  onChange={(capacityLitres) =>
                    setTank({ ...tank, capacityLitres: capacityLitres ?? 0 })
                  }
                />
              </Field>
            </div>
            <button className="fr-primary">Add tank</button>
          </Section>
        </fieldset>
      </form>
    </div>
  );
}
