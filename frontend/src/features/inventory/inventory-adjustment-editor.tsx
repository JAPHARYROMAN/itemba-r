'use client';
import { useEffect, useId, useRef, useState } from 'react';
import {
  Btn,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  ProductPicker,
  StatusBadge,
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
import { backendGet, backendPage } from '@/lib/api-client';
import { saveStockCount, type CountRecovery, type CountRequest } from './inventory-adjustment-save';
import { AdjustmentLines } from './inventory-adjustment-lines';
import { adjustmentName, type StockAdjustment } from './inventory-adjustment-types';

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
type Balance = {
  key: string;
  value?: string;
  revision?: number;
  cost?: string;
  locked?: boolean;
  error?: string;
  loading?: boolean;
};
type CountProduct = {
  id: string;
  name: string;
  baseUnitId?: string;
  defaultUnitId?: string;
  baseUnit?: Choice;
  purchasePrice?: string | number;
  effectivePurchasePrice?: string | number;
};
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
  productId = '',
  draftSource,
  onClose,
  onSaved,
}: {
  scope: ScopeValue;
  productId?: string;
  draftSource?: WorkspaceDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { hasPermission, user } = useAuth();
  const allowed = hasPermission('inventory.adjustments.create'),
    canBalance = hasPermission('inventory.view');
  const canProduct = ['products.view', 'inventory.view', 'inventory.adjustments.create'].some(
      (permission) => hasPermission(permission),
    ),
    canUnits = hasPermission('units.view');
  const [products, setProducts] = useState<Record<string, CountProduct>>({});
  const [productError, setProductError] = useState('');
  const [saved, setSaved] = useState<StockAdjustment | null>(null);
  const [staleCapture, setStaleCapture] = useState(false);
  const pending = useRef(false);
  const recovery = useRef<CountRecovery | null>(null);
  const [recoveryState, setRecoveryState] = useState<{
    frozen: boolean;
    recordId?: string;
    error?: string;
    request?: CountRequest;
  }>(() => {
    try {
      const saved = JSON.parse(
        draftSource?.context.countRecovery || 'null',
      ) as CountRecovery | null;
      return { frozen: !!saved, recordId: saved?.recordId, request: saved?.request };
    } catch {
      return {
        frozen: true,
        error:
          'The retained request could not be read. Review the stock adjustment register before starting a new count.',
      };
    }
  });
  useEffect(() => {
    try {
      recovery.current = JSON.parse(
        draftSource?.context.countRecovery || 'null',
      ) as CountRecovery | null;
    } catch {
      recovery.current = null;
    }
  }, [draftSource]);
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
      lines: [{ ...blank(1), productId }],
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
        ...(recovery.current ? { countRecovery: JSON.stringify(recovery.current) } : {}),
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
      needsReview: changedBalances.length > 0 || staleCapture,
      reviewKey: JSON.stringify([changedBalances, staleCapture ? balances : null]),
      busy,
      onClose,
    },
  );
  const { form, setForm, guard } = draft;
  const frozen = recoveryState.frozen;
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
  const productKey = JSON.stringify(form.lines.map((line) => line.productId).filter(Boolean));
  useEffect(() => {
    const controller = new AbortController();
    setProductError('');
    if (!canProduct) return () => controller.abort();
    const ids = [...new Set(JSON.parse(productKey) as string[])];
    void Promise.all(
      ids.map((id) =>
        backendGet<CountProduct>(`/products/${encodeURIComponent(id)}`, {
          signal: controller.signal,
        }),
      ),
    )
      .then((rows) => {
        if (controller.signal.aborted) return;
        const next = Object.fromEntries(rows.map((row) => [row.id, row]));
        setProducts(next);
        if (!frozen)
          setForm((current) => ({
            ...current,
            lines: current.lines.map((line) => {
              const product = next[line.productId];
              return product
                ? { ...line, unitId: product.baseUnitId || product.defaultUnitId || line.unitId }
                : line;
            }),
          }));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setProductError(
            error instanceof Error ? error.message : 'Unable to verify the product base unit.',
          );
      });
    return () => controller.abort();
  }, [productKey, canProduct, frozen, setForm]);
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
      void backendPage<{
        quantityOnHand?: number | string | null;
        physicalRevision?: number;
        averageCost?: number | string;
      }>('/inventory-balances', {
        query: { companyId, branchId, productId: line.productId, limit: 1 },
        signal: controller.signal,
      })
        .then((result) => {
          if (controller.signal.aborted) return;
          const row = result.data[0];
          if (
            row &&
            (row.quantityOnHand == null ||
              !Number.isFinite(Number(row.quantityOnHand)) ||
              !Number.isInteger(row.physicalRevision))
          )
            throw new Error('The stock balance has no valid quantity. Refresh the balance.');
          setBalances((p) => ({
            ...p,
            [line.key]: {
              key,
              locked: true,
              value: row ? String(row.quantityOnHand) : '0',
              revision: row?.physicalRevision ?? 0,
              cost: row?.averageCost != null ? String(row.averageCost) : undefined,
            },
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
  const systemFor = (line: Line) => {
    const captured = recoveryState.request?.lines.find(
      (value) => value.productId === line.productId,
    );
    return frozen && captured
      ? String(captured.systemQuantity)
      : balanceFor(line)?.locked
        ? balanceFor(line)?.value || ''
        : line.system;
  };
  const costFor = (line: Line) => {
    const captured = recoveryState.request?.lines.find(
      (value) => value.productId === line.productId,
    );
    if (frozen && captured) return captured.unitCost == null ? '' : String(captured.unitCost);
    const balance = balanceFor(line),
      product = products[line.productId];
    return (
      line.cost ||
      (Number(balance?.cost) > 0
        ? balance!.cost!
        : Number(product?.effectivePurchasePrice ?? product?.purchasePrice) > 0
          ? String(product?.effectivePurchasePrice ?? product?.purchasePrice)
          : '')
    );
  };
  const update = (key: number, patch: Partial<Line>) =>
    setForm((p) => ({ ...p, lines: p.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const close = () => {
    if (saved) onSaved();
    else if (!busy) guard.requestClose(onClose);
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
  async function save(submit = true) {
    if (pending.current || !allowed) return;
    if (recoveryState.error) return setError(recoveryState.error);
    if (!recovery.current) {
      if (!form.companyId || !form.branchId || !form.reason.trim())
        return setError('Select a company and branch, and enter the adjustment reason.');
      if (!canProduct || productError)
        return setError(
          productError || 'Product read access is required to prepare an adjustment.',
        );
      if (
        hasPermission('branches.read') &&
        (branches.loading || branches.error || !branches.rows.some((r) => r.id === form.branchId))
      )
        return setError('Load and select a branch from this company.');
      if (!form.lines.length) return setError('Add at least one product line.');
      if (new Set(form.lines.map((line) => line.productId)).size !== form.lines.length)
        return setError('Each product can appear only once in a stock count.');
      for (const [index, line] of form.lines.entries()) {
        const balance = balanceFor(line),
          system = systemFor(line),
          prefix = `Line ${index + 1}: `;
        const product = products[line.productId];
        if (!product || line.unitId !== (product.baseUnitId || product.defaultUnitId))
          return setError(prefix + 'load the product and its base unit before saving.');
        if (canBalance && (!balance || balance.loading || balance.error))
          return setError(prefix + 'load the current balance before saving.');
        if (!validAdjustmentQuantity(system, true) || !validAdjustmentQuantity(line.counted))
          return setError(
            prefix +
              'enter system and non-negative counted quantities with at most four decimal places.',
          );
        if (
          Number(line.counted) > Number(system) &&
          !(Number(system) < 0 && Number(line.counted) === 0) &&
          (!validAdjustmentQuantity(costFor(line)) || Number(costFor(line)) <= 0)
        )
          return setError(
            prefix +
              'a positive stock addition requires a unit cost greater than zero with at most four decimal places.',
          );
      }
    }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (!recovery.current) {
        draft.validateReview();
        recovery.current = {
          request: {
            companyId: form.companyId,
            ...(form.divisionId ? { divisionId: form.divisionId } : {}),
            branchId: form.branchId,
            reason: form.reason.trim(),
            notes: form.notes.trim() || undefined,
            idempotencyKey: draft.requestId.current || crypto.randomUUID(),
            lines: form.lines.map((line) => ({
              productId: line.productId,
              unitId: line.unitId,
              systemQuantity: Number(systemFor(line)),
              countedQuantity: Number(line.counted),
              ...(balanceFor(line)?.revision != null
                ? { expectedRevision: balanceFor(line)!.revision }
                : {}),
              ...(Number(line.counted) > Number(systemFor(line)) && Number(costFor(line)) > 0
                ? { unitCost: Number(costFor(line)) }
                : {}),
              reason: line.reason.trim() || undefined,
            })),
          },
        };
      }
      const persist = async (state: CountRecovery) => {
        setRecoveryState({ frozen: true, recordId: state.recordId, request: state.request });
        await draft.persistRequest(state.request.idempotencyKey, {
          countRecovery: JSON.stringify(state),
        });
      };
      await persist(recovery.current);
      const result = await saveStockCount(recovery.current, persist, submit);
      setSaved(result);
      draft.markSaved();
      showToast(
        'success',
        submit ? 'Stock count submitted' : 'Adjustment draft created',
        adjustmentName(result),
      );
    } catch (err) {
      if (
        !recovery.current?.recordId &&
        err &&
        typeof err === 'object' &&
        'status' in err &&
        Number(err.status) === 409 &&
        'payload' in err &&
        err.payload &&
        typeof err.payload === 'object' &&
        'code' in err.payload &&
        err.payload.code === 'STOCK_CAPTURE_STALE'
      ) {
        recovery.current = null;
        setRecoveryState({ frozen: false });
        draft.clearRequestSnapshot();
        setStaleCapture(true);
        setRevision((value) => value + 1);
      }
      setError(err instanceof Error ? err.message : 'Unable to create this adjustment.');
    } finally {
      setBusy(false);
      pending.current = false;
    }
  }
  return (
    <Modal
      open
      title={saved ? adjustmentName(saved) : 'Adjust stock'}
      subtitle="Record the count now. Stock changes only after approval and posting."
      size="2xl"
      onClose={close}
      footer={
        saved ? (
          <Btn onClick={onSaved}>Done</Btn>
        ) : (
          <>
            <Btn type="button" variant="secondary" disabled={busy} onClick={close}>
              Cancel
            </Btn>
            {draft.canRetain && (
              <Btn type="button" variant="secondary" disabled={busy} onClick={draft.keep}>
                Keep draft
              </Btn>
            )}
            {!frozen && (
              <Btn
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void save(false)}
              >
                Save draft
              </Btn>
            )}
            <Btn type="submit" form={id} loading={busy} disabled={!allowed || !canProduct}>
              {frozen ? 'Retry save and submit' : 'Save and submit'}
            </Btn>
          </>
        )
      }
    >
      {saved ? (
        <section className="inventory-adjustment-stack" aria-label="Saved stock adjustment">
          <StatusBadge status={saved.status} />
          <p className="inventory-register-note">
            {saved.reason}. Stock changes after successful posting.
          </p>
          <AdjustmentLines
            row={{
              ...saved,
              lines: saved.lines?.map((line) => ({
                ...line,
                product: line.product || products[line.productId],
                unit: line.unit || units.rows.find((unit) => unit.id === line.unitId),
              })),
            }}
          />
        </section>
      ) : (
        <form
          id={id}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="inventory-adjustment-stack"
          {...guard.capture}
        >
          <DraftFormNotice draft={draft} />
          {error && (
            <p role="alert" className="workspace-notice">
              {error}
            </p>
          )}
          {frozen && (
            <p role="status" className="workspace-notice">
              This count is retained for recovery
              {recoveryState.recordId ? ` as draft ${recoveryState.recordId}` : ''}. Retry verifies
              the same adjustment.
            </p>
          )}
          {productError && (
            <p role="alert" className="workspace-notice">
              {productError}
            </p>
          )}
          {!canProduct && (
            <p role="alert" className="workspace-notice">
              Product and unit read access are required to prepare an adjustment.
            </p>
          )}
          <fieldset disabled={busy || frozen} className="inventory-adjustment-stack">
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
                          setForm((p) => ({
                            ...p,
                            lines: p.lines.filter((l) => l.key !== line.key),
                          })),
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
                      onChange={(productId) => {
                        if (productId === line.productId) return;
                        guard.change(() =>
                          update(line.key, {
                            productId,
                            unitId: '',
                            system: '',
                            counted: '',
                            cost: '',
                          }),
                        );
                      }}
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
                  {balance &&
                    !balance.loading &&
                    !balance.error &&
                    balance.revision === 0 &&
                    balance.value === '0' && (
                      <p className="inventory-register-note">
                        No recorded stock at this branch. The current on-hand quantity is zero.
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
                      disabled
                      onChange={() => undefined}
                    >
                      {options(
                        products[line.productId]?.baseUnit
                          ? [products[line.productId].baseUnit!]
                          : units.rows,
                        line.unitId,
                      )}
                    </FormSelect>
                    <FormInput
                      label={`Unit cost (TZS), line ${index + 1}`}
                      type="number"
                      step="any"
                      required={
                        difference != null &&
                        difference > 0 &&
                        !(Number(system) < 0 && Number(line.counted) === 0)
                      }
                      value={costFor(line)}
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
          </fieldset>
        </form>
      )}
    </Modal>
  );
}
