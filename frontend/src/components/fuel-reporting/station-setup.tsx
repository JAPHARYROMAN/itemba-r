'use client';
import { useEffect, useRef, useState } from 'react';
import { backendDelete, backendPatch, backendPost } from '@/lib/api-client';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { StationPump, StationTank, Workspace } from './types';
import { Field, Section } from './report-fields';

type PumpForm = {
  code: string;
  name: string;
  nozzles: { id?: string; code: string; tankId: string }[];
};
type Removal = { kind: 'tank' | 'pump'; id: string; name: string; expectedUpdatedAt: string };

export function StationSetup({
  branchId,
  workspace,
  refresh,
  apiBase = '/fuel-reporting',
  onLock,
}: {
  branchId: string;
  workspace: Workspace;
  refresh: () => Promise<void>;
  apiBase?: string;
  onLock?: (locked: boolean) => void;
}) {
  const [pump, setPump] = useState<PumpForm>({
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
  const [editingTank, setEditingTank] = useState<StationTank | null>(null);
  const [editingPump, setEditingPump] = useState<StationPump | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const pumpFormRef = useRef<HTMLFormElement>(null);
  const tankFormRef = useRef<HTMLFormElement>(null);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);
  const tanks: StationTank[] =
    workspace.tanks ??
    workspace.catalog.tanks.map((t) => ({
      ...t,
      tankCode: '',
      status: 'ACTIVE',
      deletedAt: null,
      updatedAt: '',
    }));
  const dirty = !!(
    editingTank ||
    editingPump ||
    pump.code ||
    pump.name ||
    pump.nozzles.some((n) => n.code) ||
    pump.nozzles.length > 1 ||
    tank.code ||
    tank.name ||
    tank.capacityLitres
  );
  useEffect(() => {
    onLock?.(dirty || busy || !!removal);
  }, [dirty, busy, removal, onLock]);
  useEffect(() => () => onLock?.(false), [onLock]);
  useEffect(() => {
    if (editingTank || editingPump || busy || needsRefresh) return;
    editTriggerRef.current?.focus();
    editTriggerRef.current = null;
  }, [editingTank, editingPump, busy, needsRefresh]);
  function resetPump() {
    setEditingPump(null);
    setPump({
      code: '',
      name: '',
      nozzles: [{ code: '', tankId: workspace.catalog.tanks[0]?.id ?? '' }],
    });
  }
  function resetTank() {
    setEditingTank(null);
    setTank({ code: '', name: '', productId: workspace.products[0]?.id ?? '', capacityLitres: 0 });
  }
  function focusForm(form: HTMLFormElement | null) {
    form?.scrollIntoView?.({ block: 'start', behavior: 'instant' });
    form?.querySelector<HTMLInputElement>('input')?.focus();
  }
  const readOnly = workspace.canConfigure === false;
  const blocked = busy || dirty || needsRefresh || readOnly;
  async function run(action: () => Promise<unknown>, message: string) {
    if (busy || needsRefresh || readOnly) return false;
    setBusy(true);
    setError('');
    setNotice('');
    let saved = false;
    try {
      await action();
      saved = true;
      setNotice(message);
      await refresh();
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'Could not save station configuration.';
      setError(
        saved
          ? `The change was saved, but the station could not refresh. Reload setup. ${detail}`
          : detail,
      );
      if (saved) setNeedsRefresh(true);
    } finally {
      setBusy(false);
    }
    return saved;
  }
  async function reloadSetup() {
    if (busy) return;
    setBusy(true);
    try {
      await refresh();
      setNeedsRefresh(false);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reload station setup.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <p className="fr-notice">
        Maintain station tanks, pumps and nozzle connections. Deleted tanks and removed pumps are
        excluded from new shifts; previous reports and meter history are retained. Close unfinished
        shifts before changing equipment.
      </p>
      {readOnly && (
        <p className="fr-notice" role="status">
          You have read-only company access. Company write access is required to edit tanks, pumps
          or nozzle connections.
        </p>
      )}
      {error ? (
        <p role="alert" className="fr-error">
          {error}{' '}
          <button
            type="button"
            className="fr-text-button"
            disabled={busy || dirty}
            onClick={() => void reloadSetup()}
          >
            Reload setup
          </button>
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="fr-success">
          {notice}
        </p>
      ) : null}
      <Section title="Branch pumps">
        <div className="fr-table-scroll" role="region" aria-label="Station pumps" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Pump</th>
                <th>Nozzle connections</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {workspace.pumps.map((p) => (
                <tr key={p.id}>
                  <td>{p.pumpCode}</td>
                  <td>{p.pumpName}</td>
                  <td>
                    {(p.nozzles ?? workspace.catalog.nozzles.filter((n) => n.pumpId === p.id)).map(
                      (n) => (
                        <div key={n.id}>
                          {n.nozzleCode} ·{' '}
                          {('tankId' in n ? tanks.find((t) => t.id === n.tankId)?.tankName : '') ||
                            ('productName' in n ? n.productName : '')}
                        </div>
                      ),
                    )}
                  </td>
                  <td>{p.status === 'ACTIVE' ? 'Active' : 'Inactive'}</td>
                  <td>
                    <div className="fr-equipment-actions">
                      <button
                        type="button"
                        className="fr-text-button"
                        disabled={blocked || !p.updatedAt || !p.nozzles}
                        aria-label={`Edit pump ${p.pumpName}`}
                        onClick={(e) => {
                          editTriggerRef.current = e.currentTarget;
                          setEditingPump(p);
                          setPump({
                            code: p.pumpCode,
                            name: p.pumpName,
                            nozzles: (p.nozzles ?? []).map((n) => ({
                              id: n.id,
                              code: n.nozzleCode,
                              tankId: n.tankId,
                            })),
                          });
                          focusForm(pumpFormRef.current);
                        }}
                      >
                        Edit
                      </button>
                      {p.status === 'ACTIVE' ? (
                        <button
                          type="button"
                          disabled={blocked || !p.updatedAt}
                          className="fr-text-button"
                          aria-label={`Remove pump ${p.pumpName}`}
                          onClick={() => {
                            setError('');
                            setRemoval({
                              kind: 'pump',
                              id: p.id,
                              name: p.pumpName,
                              expectedUpdatedAt: p.updatedAt!,
                            });
                          }}
                        >
                          Remove pump
                        </button>
                      ) : p.status === 'INACTIVE' ? (
                        <button
                          type="button"
                          className="fr-text-button"
                          disabled={blocked || !p.updatedAt}
                          aria-label={`Restore pump ${p.pumpName}`}
                          onClick={() =>
                            void run(
                              () =>
                                backendPost(`${apiBase}/pumps/${p.id}/restore`, {
                                  expectedUpdatedAt: p.updatedAt,
                                }),
                              'Pump restored for future shifts.',
                            )
                          }
                        >
                          Restore
                        </button>
                      ) : (
                        'History retained'
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <form
        ref={pumpFormRef}
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            async () => {
              if (editingPump)
                await backendPatch(`${apiBase}/pumps/${editingPump.id}`, {
                  ...pump,
                  expectedUpdatedAt: editingPump.updatedAt,
                });
              else await backendPost(`${apiBase}/pumps`, { ...pump, branchId });
              resetPump();
            },
            editingPump ? 'Pump and nozzle connections updated.' : 'Pump added.',
          );
        }}
      >
        <fieldset disabled={busy || needsRefresh || readOnly || !!editingTank}>
          <Section
            title={editingPump ? `Edit pump · ${editingPump.pumpName}` : 'Add pump'}
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
              <div className="fr-entry" key={n.id ?? `new-${i}`}>
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
                {pump.nozzles.length > 1 ? (
                  <button
                    type="button"
                    className="fr-text-button"
                    aria-label={`Remove nozzle ${n.code || i + 1} from pump form`}
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
                disabled={pump.nozzles.length >= 20}
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
                {editingPump ? 'Save pump changes' : 'Add pump'}
              </button>
              {editingPump && (
                <button type="button" className="fr-secondary" onClick={resetPump}>
                  Cancel pump editing
                </button>
              )}
            </div>
          </Section>
        </fieldset>
      </form>
      <Section
        title="Station tanks"
        detail="Current tank capacities and fuel connections. Delete only disconnected tanks with no remaining fuel."
      >
        <label className="fr-equipment-toggle">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(e) => setShowDeleted(e.target.checked)}
          />
          Show deleted tanks
        </label>
        <div className="fr-table-scroll" role="region" aria-label="Station tanks" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Tank</th>
                <th>Fuel product</th>
                <th>Capacity · litres</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tanks
                .filter((t) => showDeleted || !t.deletedAt)
                .map((t) => (
                  <tr key={t.id}>
                    <td>{t.tankCode || '—'}</td>
                    <td>{t.tankName}</td>
                    <td>{t.productName}</td>
                    <td>{t.capacityLitres.toLocaleString('en-TZ')}</td>
                    <td>
                      {t.deletedAt
                        ? 'Deleted · history kept'
                        : t.status.toLowerCase().replaceAll('_', ' ')}
                    </td>
                    <td>
                      <div className="fr-equipment-actions">
                        {!t.deletedAt && (
                          <button
                            type="button"
                            className="fr-text-button"
                            disabled={blocked || !t.updatedAt}
                            aria-label={`Edit tank ${t.tankName}`}
                            onClick={(e) => {
                              editTriggerRef.current = e.currentTarget;
                              setEditingTank(t);
                              setTank({
                                code: t.tankCode,
                                name: t.tankName,
                                productId: t.productId,
                                capacityLitres: t.capacityLitres,
                              });
                              focusForm(tankFormRef.current);
                            }}
                          >
                            Edit
                          </button>
                        )}
                        {!t.deletedAt && (
                          <button
                            type="button"
                            className="fr-text-button fr-equipment-delete"
                            disabled={blocked || !t.updatedAt}
                            aria-label={`Delete tank ${t.tankName}`}
                            onClick={() => {
                              setError('');
                              setRemoval({
                                kind: 'tank',
                                id: t.id,
                                name: t.tankName,
                                expectedUpdatedAt: t.updatedAt,
                              });
                            }}
                          >
                            Delete tank
                          </button>
                        )}
                        {(t.deletedAt || t.status === 'INACTIVE') && (
                          <button
                            type="button"
                            className="fr-text-button"
                            disabled={blocked || !t.updatedAt}
                            aria-label={`Restore tank ${t.tankName}`}
                            onClick={() =>
                              void run(
                                () =>
                                  backendPost(`${apiBase}/tanks/${t.id}/restore`, {
                                    expectedUpdatedAt: t.updatedAt,
                                  }),
                                'Tank restored for future shifts.',
                              )
                            }
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!tanks.some((t) => !t.deletedAt) && (
          <p>No tanks yet. Add the first tank below, then connect its pump nozzles.</p>
        )}
      </Section>
      <form
        ref={tankFormRef}
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            async () => {
              if (editingTank)
                await backendPatch(`${apiBase}/tanks/${editingTank.id}`, {
                  ...tank,
                  expectedUpdatedAt: editingTank.updatedAt,
                });
              else await backendPost(`${apiBase}/tanks`, { ...tank, branchId });
              resetTank();
            },
            editingTank ? 'Tank details updated.' : 'Tank added for manual dipping.',
          );
        }}
      >
        <fieldset disabled={busy || needsRefresh || readOnly || !!editingPump}>
          <Section
            title={editingTank ? `Edit tank · ${editingTank.tankName}` : 'Add tank'}
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
                <input
                  aria-label="Tank capacity"
                  type="number"
                  required
                  min="1"
                  max="10000000000"
                  step="0.01"
                  inputMode="decimal"
                  value={tank.capacityLitres || ''}
                  onChange={(e) => setTank({ ...tank, capacityLitres: Number(e.target.value) })}
                />
              </Field>
            </div>
            <div className="fr-actions">
              <button className="fr-primary">
                {editingTank ? 'Save tank changes' : 'Add tank'}
              </button>
              {editingTank && (
                <button type="button" className="fr-secondary" onClick={resetTank}>
                  Cancel tank editing
                </button>
              )}
            </div>
          </Section>
        </fieldset>
      </form>
      <ConfirmDialog
        open={!!removal}
        title={removal?.kind === 'tank' ? 'Delete tank?' : 'Remove pump?'}
        message={`${removal?.name ?? 'This equipment'} will be removed from future shifts. Its records and previous reports will be kept, and you can restore it later.${error ? ` ${error}` : ''}`}
        confirmLabel={removal?.kind === 'tank' ? 'Delete tank' : 'Remove pump'}
        variant="danger"
        loading={busy}
        onCancel={() => {
          if (!busy) setRemoval(null);
        }}
        onConfirm={async () => {
          if (!removal) return;
          const saved = await run(
            () =>
              backendDelete(
                `${apiBase}/${removal.kind === 'tank' ? 'tanks' : 'pumps'}/${removal.id}`,
                { body: { expectedUpdatedAt: removal.expectedUpdatedAt } },
              ),
            removal.kind === 'tank'
              ? 'Tank deleted from future shifts. Its history is kept.'
              : 'Pump removed from future shifts. Its history is kept.',
          );
          if (saved) setRemoval(null);
        }}
      />
    </div>
  );
}
