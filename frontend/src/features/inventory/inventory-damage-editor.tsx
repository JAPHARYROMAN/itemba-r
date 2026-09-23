'use client';
import { useId, useState } from 'react';
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
import { productLabel, productQuantity } from '@/components/workspace/product-form';
import { backendPost } from '@/lib/api-client';
import { DAMAGE_TYPES } from './inventory-damage-types';

type Choice = { id: string; name: string; symbol?: string | null; divisionId?: string | null };
type Batch = {
  id: string;
  batchNumber: string;
  unitId: string;
  remainingQuantity?: string | number | null;
  unit?: { symbol?: string | null };
  status: string;
};
export function validDamageQuantity(value: string) {
  return (
    /^\d+(\.\d{1,4})?$/.test(value.trim()) &&
    Number.isFinite(Number(value)) &&
    Number(value) > 0 &&
    Number(value) < 1e14
  );
}
export function validDamageEstimate(value: string) {
  return (
    value === '' ||
    (/^\d+(\.\d{1,2})?$/.test(value.trim()) &&
      Number.isFinite(Number(value)) &&
      Number(value) >= 0 &&
      Number(value) < 1e16)
  );
}
export function DamageEditor({
  scope,
  productId,
  draftSource,
  onClose,
  onSaved,
}: {
  scope: ScopeValue;
  productId: string;
  draftSource?: WorkspaceDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { hasPermission, user } = useAuth();
  const allowed = hasPermission('stock_damage.create'),
    canProduct = hasPermission('products.view'),
    canUnits = hasPermission('units.view'),
    canBatches = hasPermission('product_batches.view');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const draft = useWorkspaceDraftForm(
    () => ({
      companyId: scope.companyId || user?.companyId || '',
      divisionId: scope.divisionId,
      branchId: scope.branchId,
      productId,
      batchId: '',
      unitId: '',
      quantity: '',
      estimatedValue: '',
      damageType: 'BREAKAGE',
      notes: '',
    }),
    {
      appId: 'inventory',
      title: 'Stock damage',
      draftId: draftSource?.id,
      context: (values) => ({
        kind: 'damage',
        companyId: values.companyId,
        divisionId: values.divisionId,
        branchId: values.branchId,
        productId: values.productId,
      }),
      describe: (values) => values.notes || 'Unfinished damage report',
      busy,
      onClose,
    },
  );
  const { form, setForm, guard } = draft;
  const id = useId();
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
  const batches = useWorkspaceChoices<Batch>(
    '/westsides/product-batches',
    { companyId: form.companyId, branchId: form.branchId, productId: form.productId },
    allowed && canBatches && !!form.companyId && !!form.branchId && !!form.productId,
  );
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
    if (!allowed || busy) return;
    if (!form.companyId || !form.branchId || !form.productId)
      return setError('Select a company, branch and product.');
    if (!canProduct || !canUnits)
      return setError('Product and unit read access are required to report damage.');
    if (units.loading || units.error || !units.rows.some((r) => r.id === form.unitId))
      return setError('Load and select an available unit.');
    if (
      hasPermission('branches.read') &&
      (branches.loading || branches.error || !branches.rows.some((r) => r.id === form.branchId))
    )
      return setError('Load and select a branch from this company.');
    if (
      form.batchId &&
      (batches.loading || batches.error || !batches.rows.some((r) => r.id === form.batchId))
    )
      return setError('Load and select a batch for this product and branch.');
    if (!validDamageQuantity(form.quantity))
      return setError(
        'Enter a positive quantity below 100 trillion with at most four decimal places.',
      );
    if (!validDamageEstimate(form.estimatedValue))
      return setError(
        'Enter a non-negative estimate below 10 quadrillion with at most two decimal places, or leave it blank.',
      );
    setBusy(true);
    setError('');
    try {
      draft.validateReview();
      await draft.saveNow();
      await backendPost('/westsides/stock-damage', {
        companyId: form.companyId,
        branchId: form.branchId,
        productId: form.productId,
        unitId: form.unitId,
        quantity: Number(form.quantity),
        damageType: form.damageType,
        ...(form.batchId ? { batchId: form.batchId } : {}),
        ...(form.estimatedValue !== '' ? { estimatedValue: Number(form.estimatedValue) } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      });
      draft.markSaved();
      showToast(
        'success',
        'Damage draft created',
        'Submit the report for review when it is ready.',
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save the damage report.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="Report stock damage"
      subtitle="Create a draft for review. Stock changes only after approval and posting."
      size="lg"
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
            disabled={!allowed || !canProduct || !canUnits || units.loading || !!units.error}
          >
            Save damage draft
          </Btn>
        </>
      }
    >
      <form id={id} onSubmit={submit} className="inventory-damage-stack" {...guard.capture}>
        <DraftFormNotice draft={draft} />
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
        {(!canProduct || !canUnits) && (
          <p role="alert" className="workspace-notice">
            Product and unit read access are required to report damage.
          </p>
        )}
        <div className="workspace-form-grid">
          <FormSelect
            label="Damage company"
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
                productId: '',
                unitId: '',
                batchId: '',
              }))
            }
          >
            {options(companies.rows, form.companyId)}
          </FormSelect>
          <FormSelect
            label="Damage division"
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
              setForm((p) => ({ ...p, divisionId: e.target.value, branchId: '', batchId: '' }))
            }
          >
            {options(divisions.rows, form.divisionId)}
          </FormSelect>
          <FormSelect
            label="Damage branch"
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
                batchId: '',
              }));
            }}
          >
            {options(branches.rows, form.branchId)}
          </FormSelect>
        </div>
        <CatalogueChoiceError label="Company" source={companies} />
        <CatalogueChoiceError label="Division" source={divisions} />
        <CatalogueChoiceError label="Branch" source={branches} />
        {canProduct && (
          <div>
            <span className="inventory-filter-label">Damaged product *</span>
            <ProductPicker
              key={form.companyId}
              ariaLabel="Damaged product"
              value={form.productId}
              companyId={form.companyId}
              divisionId={form.divisionId}
              branchId={form.branchId}
              disabled={busy || !form.companyId || !form.branchId}
              onChange={(value, product) =>
                guard.change(() =>
                  setForm((p) => ({
                    ...p,
                    productId: value,
                    unitId: product?.defaultUnitId || '',
                    batchId: '',
                  })),
                )
              }
            />
          </div>
        )}
        <div className="workspace-form-grid">
          <FormInput
            label="Damaged quantity"
            type="number"
            required
            min="0.0001"
            step="0.0001"
            value={form.quantity}
            disabled={busy}
            onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))}
          />
          <FormSelect
            label="Damage unit"
            required
            placeholder="Select unit"
            value={form.unitId}
            disabled={busy || !canUnits || units.loading || !!units.error}
            onChange={(e) => setForm((p) => ({ ...p, unitId: e.target.value }))}
          >
            {options(units.rows, form.unitId)}
          </FormSelect>
          <FormSelect
            label="Damage type"
            required
            value={form.damageType}
            disabled={busy}
            onChange={(e) => setForm((p) => ({ ...p, damageType: e.target.value }))}
          >
            {DAMAGE_TYPES.map((value) => (
              <option key={value} value={value}>
                {productLabel(value)}
              </option>
            ))}
          </FormSelect>
          <FormInput
            label="Estimated total value (TZS)"
            type="number"
            min="0"
            step="0.01"
            value={form.estimatedValue}
            disabled={busy}
            placeholder="Optional"
            onChange={(e) => setForm((p) => ({ ...p, estimatedValue: e.target.value }))}
          />
        </div>
        <CatalogueChoiceError label="Unit" source={units} />
        {canBatches && (
          <>
            <FormSelect
              label="Linked batch"
              value={form.batchId}
              placeholder="No linked batch"
              disabled={
                busy || !form.branchId || !form.productId || batches.loading || !!batches.error
              }
              onChange={(e) => {
                const batch = batches.rows.find((r) => r.id === e.target.value);
                setForm((p) => ({
                  ...p,
                  batchId: e.target.value,
                  unitId: batch?.unitId || p.unitId,
                }));
              }}
            >
              {batches.rows.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.batchNumber} · {productQuantity(batch.remainingQuantity)}{' '}
                  {batch.unit?.symbol || ''} remaining · {productLabel(batch.status)}
                </option>
              ))}
            </FormSelect>
            <CatalogueChoiceError label="Batch" source={batches} />
          </>
        )}
        <p className="inventory-register-note">
          The estimate is for review. Posting uses the actual value removed from inventory and
          checks the linked batch’s remaining quantity.
        </p>
        <FormTextarea
          label="Damage notes"
          value={form.notes}
          rows={3}
          disabled={busy}
          placeholder="Describe what happened and where the damage was found."
          onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
        />
      </form>
    </Modal>
  );
}
