'use client';
import { useEffect, useId, useRef, useState } from 'react';
import {
  Btn,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  ProductPicker,
  showToast,
  type ScopeValue,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { CatalogueChoiceError } from '@/components/workspace/catalogue-editors';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { productQuantity } from '@/components/workspace/product-form';
import { backendPage, backendPost } from '@/lib/api-client';

type Choice = { id: string; name: string; symbol?: string; divisionId?: string | null };
type Line = {
  key: number;
  productId: string;
  unitId: string;
  system: string;
  counted: string;
  cost: string;
  reason: string;
};
type Balance = { key: string; value?: string; locked?: boolean; error?: string; loading?: boolean };
const blank = (key: number): Line => ({
  key,
  productId: '',
  unitId: '',
  system: '',
  counted: '',
  cost: '',
  reason: '',
});
export function validAdjustmentQuantity(value: string, negative = false) {
  return (
    (negative ? /^-?\d+(\.\d{1,4})?$/ : /^\d+(\.\d{1,4})?$/).test(value.trim()) &&
    Number.isFinite(Number(value)) &&
    Math.abs(Number(value)) < 1e14
  );
}
export function AdjustmentEditor({
  scope,
  draftSource,
  onClose,
  onSaved,
}: {
  scope: ScopeValue;
  draftSource?: WorkspaceDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { hasPermission, user } = useAuth();
  const allowed = hasPermission('inventory.adjustments.create'),
    canBalance = hasPermission('inventory.view');
  const canProduct = hasPermission('products.view'),
    canUnits = hasPermission('units.view');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [balances, setBalances] = useState<Record<number, Balance>>({}),
    [revision, setRevision] = useState(0);
  const [baseline] = useState<Record<string, string | null>>(() => {
    try {
      return JSON.parse(draftSource?.context.balances || '{}');
    } catch {
      return {};
    }
  });
  const sourceCount = draftSource?.values as
    | { companyId: string; branchId: string; lines: Line[] }
    | undefined;
  const countedSourceKeys = new Set(
    sourceCount?.lines
      .filter((line) => line.productId && line.counted !== '')
      .map((line) => JSON.stringify([sourceCount.companyId, sourceCount.branchId, line.productId])),
  );
  const changedBalances = Object.values(balances)
    .filter(
      (balance) =>
        !balance.loading &&
        !balance.error &&
        ((Object.hasOwn(baseline, balance.key) &&
          baseline[balance.key] !== (balance.value ?? null)) ||
          (!Object.hasOwn(baseline, balance.key) && countedSourceKeys.has(balance.key))),
    )
    .map((balance) => [balance.key, balance.value ?? null]);
  const draft = useWorkspaceDraftForm(
    () => ({
      ...scope,
      companyId: scope.companyId || user?.companyId || '',
      reason: '',
      notes: '',
      lines: [blank(1)],
    }),
    {
      appId: 'inventory',
      title: 'Stock count',
      draftId: draftSource?.id,
      describe: (values) => values.reason || `${values.lines.length} stock count lines`,
      context: (values) => ({
        kind: 'adjustment',
        companyId: values.companyId,
        divisionId: values.divisionId,
        branchId: values.branchId,
        balances: JSON.stringify(
          Object.fromEntries(
            values.lines.flatMap((line) => {
              const balance = balances[line.key];
              return balance &&
                !balance.loading &&
                !balance.error &&
                balance.key === JSON.stringify([values.companyId, values.branchId, line.productId])
                ? [[balance.key, balance.value ?? null]]
                : [];
            }),
          ),
        ),
      }),
      needsReview: changedBalances.length > 0,
      reviewKey: JSON.stringify(changedBalances),
      busy,
      onClose,
    },
  );
  const { form, setForm, guard } = draft;
  const nextKey = useRef(Math.max(0, ...form.lines.map((line) => line.key)) + 1),
    id = useId();
  const companies = useWorkspaceChoices<Choice>(
    '/companies',
    {},
    allowed && hasPermission('companies.read'),
  );
  const divisions = useWorkspaceChoices<Choice>(
    '/divisions',
    { companyId: form.companyId },
    allowed && !!form.companyId && hasPermission('divisions.read'),
  );
  const branches = useWorkspaceChoices<Choice>(
    '/branches',
    { companyId: form.companyId, divisionId: form.divisionId || undefined, activeOnly: true },
    allowed && !!form.companyId && hasPermission('branches.read'),
  );
  const units = useWorkspaceChoices<Choice>(
    '/units',
    { companyId: form.companyId, status: 'ACTIVE' },
    allowed && !!form.companyId && canUnits,
  );
  const balanceKey = JSON.stringify([
    form.companyId,
    form.branchId,
    form.lines.map((l) => ({ key: l.key, productId: l.productId })),
  ]);
  useEffect(() => {
    const controller = new AbortController();
    if (!allowed || !canBalance) return () => controller.abort();
    const [companyId, branchId, lines] = JSON.parse(balanceKey) as [
      string,
      string,
      { key: number; productId: string }[],
    ];
    if (!companyId || !branchId) return () => controller.abort();
    for (const line of lines) {
      if (!line.productId) continue;
      const key = JSON.stringify([companyId, branchId, line.productId]);
      setBalances((p) => ({ ...p, [line.key]: { key, loading: true } }));
      void backendPage<{ quantityOnHand?: number | string | null }>('/inventory-balances', {
        query: { companyId, branchId, productId: line.productId, limit: 1 },
        signal: controller.signal,
      })
        .then((result) => {
          if (controller.signal.aborted) return;
          const row = result.data[0];
          if (row && (row.quantityOnHand == null || !Number.isFinite(Number(row.quantityOnHand))))
            throw new Error('The stock balance has no valid quantity. Refresh the balance.');
          setBalances((p) => ({
            ...p,
            [line.key]: { key, locked: !!row, value: row ? String(row.quantityOnHand) : undefined },
          }));
        })
        .catch((err) => {
          if (!controller.signal.aborted)
            setBalances((p) => ({
              ...p,
              [line.key]: {
                key,
                error: err instanceof Error ? err.message : 'Unable to load stock balance.',
              },
            }));
        });
    }
    return () => controller.abort();
  }, [balanceKey, canBalance, allowed, revision]);
  const balanceFor = (line: Line) => {
    const value = balances[line.key];
    return canBalance &&
      value?.key === JSON.stringify([form.companyId, form.branchId, line.productId])
      ? value
      : undefined;
  };
  const systemFor = (line: Line) =>
    balanceFor(line)?.locked ? balanceFor(line)?.value || '' : line.system;
  const update = (key: number, patch: Partial<Line>) =>
    setForm((p) => ({ ...p, lines: p.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const close = () => {
    if (!busy) guard.requestClose(onClose);
  };
  const options = (rows: Choice[], selected = '') => (
    <>
      {selected && !rows.some((r) => r.id === selected) && (
        <option value={selected}>{selected}</option>
      )}
      {rows.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
          {r.symbol ? ` (${r.symbol})` : ''}
        </option>
      ))}
    </>
  );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !allowed) return;
    if (!form.companyId || !form.branchId || !form.reason.trim())
      return setError('Select a company and branch, and enter the adjustment reason.');
    if (!canProduct || !canUnits)
      return setError('Product and unit read access are required to prepare an adjustment.');
    if (units.loading || units.error) return setError('Load the available units before saving.');
    if (
      hasPermission('branches.read') &&
      (branches.loading || branches.error || !branches.rows.some((r) => r.id === form.branchId))
    )
      return setError('Load and select a branch from this company.');
    if (!form.lines.length) return setError('Add at least one product line.');
    for (const [index, line] of form.lines.entries()) {
      const balance = balanceFor(line),
        system = systemFor(line),
        prefix = `Line ${index + 1}: `;
      if (!line.productId || !units.rows.some((r) => r.id === line.unitId))
        return setError(prefix + 'select a product and a valid unit.');
      if (canBalance && (!balance || balance.loading || balance.error))
        return setError(prefix + 'load the current balance before saving.');
      if (!validAdjustmentQuantity(system, true) || !validAdjustmentQuantity(line.counted))
        return setError(
          prefix +
            'enter system and non-negative counted quantities with at most four decimal places.',
        );
      if (
        Number(line.counted) > Number(system) &&
        (!validAdjustmentQuantity(line.cost) || Number(line.cost) <= 0)
      )
        return setError(
          prefix +
            'a positive stock addition requires a unit cost greater than zero with at most four decimal places.',
        );
    }
    setBusy(true);
    setError('');
    try {
      draft.validateReview();
      await draft.saveNow();
      await backendPost('/stock-adjustments', {
        companyId: form.companyId,
        ...(form.divisionId ? { divisionId: form.divisionId } : {}),
        branchId: form.branchId,
        reason: form.reason.trim(),
        notes: form.notes.trim() || undefined,
        lines: form.lines.map((line) => ({
          productId: line.productId,
          unitId: line.unitId,
          systemQuantity: Number(systemFor(line)),
          countedQuantity: Number(line.counted),
          ...(Number(line.counted) > Number(systemFor(line))
            ? { unitCost: Number(line.cost) }
            : {}),
          reason: line.reason.trim() || undefined,
        })),
      });
      draft.markSaved();
      showToast(
        'success',
        'Adjustment draft created',
        'Submit it for approval when you are ready.',
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create this adjustment.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="New stock adjustment"
      subtitle="Record the count now. Stock changes only after approval and posting."
      size="2xl"
      onClose={close}
      footer={
        <>
          <Btn type="button" variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Btn>
          {draft.canRetain && (
            <Btn type="button" variant="secondary" disabled={busy} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn
            type="submit"
            form={id}
            loading={busy}
            disabled={!allowed || !canProduct || !canUnits}
          >
            Save draft
          </Btn>
        </>
      }
    >
      <form id={id} onSubmit={submit} className="inventory-adjustment-stack" {...guard.capture}>
        <DraftFormNotice draft={draft} />
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
        {(!canProduct || !canUnits) && (
          <p role="alert" className="workspace-notice">
            Product and unit read access are required to prepare an adjustment.
          </p>
        )}
        <div className="workspace-form-grid">
          <FormSelect
            label="Adjustment company"
            required
            value={form.companyId}
            placeholder="Select company"
            disabled={
              busy || !hasPermission('companies.read') || companies.loading || !!companies.error
            }
            onChange={(e) =>
              setForm((p) => ({
                ...p,
                companyId: e.target.value,
                divisionId: '',
                branchId: '',
                lines: [blank(nextKey.current++)],
              }))
            }
          >
            {options(companies.rows, form.companyId)}
          </FormSelect>
          <FormSelect
            label="Adjustment division"
            value={form.divisionId}
            placeholder="All divisions"
            disabled={
              busy ||
              !form.companyId ||
              !hasPermission('divisions.read') ||
              divisions.loading ||
              !!divisions.error
            }
            onChange={(e) =>
              setForm((p) => ({
                ...p,
                divisionId: e.target.value,
                branchId: '',
                lines: p.lines.map((l) => ({ ...l, system: '', counted: '' })),
              }))
            }
          >
            {options(divisions.rows, form.divisionId)}
          </FormSelect>
          <FormSelect
            label="Adjustment branch"
            required
            value={form.branchId}
            placeholder="Select branch"
            disabled={
              busy ||
              !form.companyId ||
              !hasPermission('branches.read') ||
              branches.loading ||
              !!branches.error
            }
            onChange={(e) => {
              const branch = branches.rows.find((r) => r.id === e.target.value);
              setForm((p) => ({
                ...p,
                branchId: e.target.value,
                divisionId: branch?.divisionId || p.divisionId,
                lines: p.lines.map((l) => ({ ...l, system: '', counted: '' })),
              }));
            }}
          >
            {options(branches.rows, form.branchId)}
          </FormSelect>
        </div>
        <CatalogueChoiceError label="Company" source={companies} />
        <CatalogueChoiceError label="Division" source={divisions} />
        <CatalogueChoiceError label="Branch" source={branches} />
        <CatalogueChoiceError label="Unit" source={units} />
        <FormTextarea
          label="Adjustment reason"
          required
          value={form.reason}
          disabled={busy}
          onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
        />
        {form.lines.map((line, index) => {
          const balance = balanceFor(line),
            system = systemFor(line);
          const ready =
            validAdjustmentQuantity(system, true) && validAdjustmentQuantity(line.counted);
          const difference = ready ? Number(line.counted) - Number(system) : null;
          const reading =
            canBalance && !!line.productId && !!form.branchId && (!balance || balance.loading);
          return (
            <section
              key={line.key}
              aria-label={`Adjustment line ${index + 1}`}
              className="inventory-adjustment-line"
            >
              <header>
                <strong>Product {index + 1}</strong>
                <Btn
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={busy || form.lines.length === 1}
                  onClick={() =>
                    guard.change(() =>
                      setForm((p) => ({ ...p, lines: p.lines.filter((l) => l.key !== line.key) })),
                    )
                  }
                >
                  Remove line {index + 1}
                </Btn>
              </header>
              {canProduct && (
                <ProductPicker
                  key={form.companyId}
                  ariaLabel={`Product, line ${index + 1}`}
                  value={line.productId}
                  companyId={form.companyId}
                  divisionId={form.divisionId}
                  branchId={form.branchId}
                  disabled={busy || !form.companyId || !form.branchId}
                  onChange={(productId, product) =>
                    guard.change(() =>
                      update(line.key, {
                        productId,
                        unitId: product?.defaultUnitId || '',
                        system: '',
                        counted: '',
                        cost:
                          Number(product?.effectivePurchasePrice) > 0
                            ? String(product?.effectivePurchasePrice)
                            : '',
                      }),
                    )
                  }
                />
              )}
              {reading && (
                <p role="status" className="inventory-register-note">
                  Loading branch stock…
                </p>
              )}
              {balance?.error && (
                <div role="alert" className="workspace-notice">
                  <p>{balance.error}</p>
                  <Btn
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setRevision((p) => p + 1)}
                  >
                    Retry balances
                  </Btn>
                </div>
              )}
              {!canBalance && (
                <p className="inventory-register-note">
                  Live balances require inventory read access. Enter a verified system quantity.
                </p>
              )}
              {balance && !balance.loading && !balance.error && !balance.locked && (
                <p className="inventory-register-note">
                  No balance was found at this branch. Enter the verified system quantity, including
                  zero where appropriate.
                </p>
              )}
              <div className="workspace-form-grid">
                <FormInput
                  label={`System quantity, line ${index + 1}`}
                  type="number"
                  step="0.0001"
                  required
                  value={system}
                  disabled={busy || !!reading || !!balance?.error || !!balance?.locked}
                  onChange={(e) => update(line.key, { system: e.target.value })}
                />
                <FormInput
                  label={`Counted quantity, line ${index + 1}`}
                  type="number"
                  min="0"
                  step="0.0001"
                  required
                  value={line.counted}
                  disabled={busy}
                  onChange={(e) => update(line.key, { counted: e.target.value })}
                />
                <FormSelect
                  label={`Unit, line ${index + 1}`}
                  required
                  value={line.unitId}
                  placeholder="Select unit"
                  disabled={busy || !canUnits || units.loading || !!units.error}
                  onChange={(e) => update(line.key, { unitId: e.target.value })}
                >
                  {options(units.rows, line.unitId)}
                </FormSelect>
                <FormInput
                  label={`Unit cost (TZS), line ${index + 1}`}
                  type="number"
                  step="any"
                  required={difference != null && difference > 0}
                  value={line.cost}
                  disabled={busy || difference == null || difference <= 0}
                  onChange={(e) => update(line.key, { cost: e.target.value })}
                />
              </div>
              <p className="inventory-register-note">
                Difference:{' '}
                <strong>
                  {difference != null && difference > 0 ? '+' : ''}
                  {productQuantity(difference)}{' '}
                  {units.rows.find((r) => r.id === line.unitId)?.symbol || ''}
                </strong>
                . Positive additions require a unit cost.
              </p>
              <FormInput
                label={`Line reason, line ${index + 1}`}
                value={line.reason}
                disabled={busy}
                onChange={(e) => update(line.key, { reason: e.target.value })}
              />
            </section>
          );
        })}
        <div>
          <Btn
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              guard.change(() =>
                setForm((p) => ({ ...p, lines: [...p.lines, blank(nextKey.current++)] })),
              )
            }
          >
            Add product line
          </Btn>
        </div>
        <FormTextarea
          label="Adjustment notes"
          value={form.notes}
          disabled={busy}
          onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
        />
      </form>
    </Modal>
  );
}
