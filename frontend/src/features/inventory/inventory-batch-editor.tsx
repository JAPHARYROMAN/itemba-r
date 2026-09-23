'use client';
import { useId, useState } from 'react';
import {
  Btn,
  FormDateField,
  FormInput,
  FormSelect,
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
import { backendPost } from '@/lib/api-client';
interface Choice {
  id: string;
  name: string;
  symbol?: string | null;
}
export function validBatchQuantity(value: string) {
  return (
    /^\d+(\.\d{1,4})?$/.test(value.trim()) &&
    Number.isFinite(Number(value)) &&
    Number(value) > 0 &&
    Number(value) < 1e14
  );
}
export function BatchEditor({
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
  const allowed = hasPermission('product_batches.manage');
  const canProduct = hasPermission('products.view'),
    canUnits = hasPermission('units.view');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const draft = useWorkspaceDraftForm(
    () => ({
      companyId: scope.companyId || user?.companyId || '',
      branchId: scope.branchId,
      productId,
      supplierId: '',
      unitId: '',
      manufactureDate: '',
      expiryDate: '',
      initialQuantity: '',
    }),
    {
      appId: 'inventory',
      title: 'Stock batch',
      draftId: draftSource?.id,
      context: (values) => ({
        kind: 'batch',
        companyId: values.companyId,
        divisionId: '',
        branchId: values.branchId,
        productId: values.productId,
      }),
      describe: (values) =>
        [
          values.initialQuantity && `${values.initialQuantity} units`,
          values.expiryDate && `Expires ${values.expiryDate}`,
        ]
          .filter(Boolean)
          .join(' · ') || 'Unfinished batch',
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
  const branches = useWorkspaceChoices<Choice>(
    '/branches',
    { companyId: form.companyId, activeOnly: true },
    allowed && !!form.companyId && hasPermission('branches.read'),
  );
  const suppliers = useWorkspaceChoices<Choice>(
    '/suppliers',
    { companyId: form.companyId },
    allowed && !!form.companyId && hasPermission('suppliers.view'),
  );
  const units = useWorkspaceChoices<Choice>(
    '/units',
    { companyId: form.companyId, status: 'ACTIVE' },
    allowed && !!form.companyId && canUnits,
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
          {r.symbol ? `${r.name} (${r.symbol})` : r.name}
        </option>
      ))}
    </>
  );
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !allowed) return;
    if (!form.companyId || !form.productId) return setError('Select a company and product.');
    if (!canProduct || !canUnits)
      return setError('Product and unit read access are required to create a batch.');
    if (units.loading || units.error || !units.rows.some((r) => r.id === form.unitId))
      return setError('Load and select a valid unit before saving.');
    if (!validBatchQuantity(form.initialQuantity))
      return setError(
        'Enter a positive quantity below 100 trillion with at most four decimal places.',
      );
    if (form.manufactureDate && form.expiryDate && form.manufactureDate > form.expiryDate)
      return setError('Expiry date must be on or after manufacture date.');
    if (
      form.supplierId &&
      (suppliers.loading ||
        suppliers.error ||
        !suppliers.rows.some((r) => r.id === form.supplierId))
    )
      return setError('Load and select a supplier from this company.');
    if (
      form.branchId &&
      hasPermission('branches.read') &&
      (branches.loading || branches.error || !branches.rows.some((r) => r.id === form.branchId))
    )
      return setError('Load and select a branch from this company.');
    setBusy(true);
    setError('');
    try {
      draft.validateReview();
      await draft.saveNow();
      await backendPost('/westsides/product-batches', {
        companyId: form.companyId,
        productId: form.productId,
        unitId: form.unitId,
        initialQuantity: Number(form.initialQuantity),
        ...(form.branchId ? { branchId: form.branchId } : {}),
        ...(form.supplierId ? { supplierId: form.supplierId } : {}),
        ...(form.manufactureDate ? { manufactureDate: form.manufactureDate } : {}),
        ...(form.expiryDate ? { expiryDate: form.expiryDate } : {}),
      });
      draft.markSaved();
      showToast('success', 'Batch created', 'The batch number is assigned automatically.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create this batch.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="New batch"
      subtitle="Batch number is assigned automatically."
      onClose={close}
      size="lg"
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
            Create batch
          </Btn>
        </>
      }
    >
      <form id={id} className="inventory-batch-editor" onSubmit={submit} {...guard.capture}>
        <DraftFormNotice draft={draft} />
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
        {(!canProduct || !canUnits) && (
          <p role="alert" className="workspace-notice">
            Product and unit read access are required to create a batch.
          </p>
        )}
        <FormSelect
          label="Batch company"
          required
          placeholder="Select company"
          value={form.companyId}
          disabled={
            busy || !hasPermission('companies.read') || companies.loading || !!companies.error
          }
          onChange={(e) =>
            setForm((p) => ({
              ...p,
              companyId: e.target.value,
              branchId: '',
              supplierId: '',
              productId: '',
              unitId: '',
            }))
          }
        >
          {options(companies.rows, form.companyId)}
        </FormSelect>
        <CatalogueChoiceError label="Company" source={companies} />
        {canProduct && (
          <div>
            <span className="inventory-filter-label">Product *</span>
            <ProductPicker
              key={form.companyId}
              value={form.productId}
              companyId={form.companyId}
              ariaLabel="Batch product"
              disabled={busy || !form.companyId}
              onChange={(value, product) =>
                guard.change(() =>
                  setForm((p) => ({
                    ...p,
                    productId: value,
                    unitId: product?.defaultUnitId || '',
                  })),
                )
              }
            />
          </div>
        )}
        <div className="workspace-form-grid">
          <FormSelect
            label="Supplier"
            value={form.supplierId}
            placeholder="No supplier"
            disabled={
              busy ||
              !form.companyId ||
              !hasPermission('suppliers.view') ||
              suppliers.loading ||
              !!suppliers.error
            }
            onChange={(e) => setForm((p) => ({ ...p, supplierId: e.target.value }))}
          >
            {options(suppliers.rows)}
          </FormSelect>
          <FormSelect
            label="Batch branch"
            value={form.branchId}
            placeholder="No branch"
            disabled={
              busy ||
              !form.companyId ||
              !hasPermission('branches.read') ||
              branches.loading ||
              !!branches.error
            }
            onChange={(e) => setForm((p) => ({ ...p, branchId: e.target.value }))}
          >
            {options(branches.rows, form.branchId)}
          </FormSelect>
          <FormDateField
            label="Manufacture date"
            value={form.manufactureDate}
            disabled={busy}
            onChange={(value) => setForm((p) => ({ ...p, manufactureDate: value }))}
          />
          <FormDateField
            label="Expiry date"
            value={form.expiryDate}
            disabled={busy}
            onChange={(value) => setForm((p) => ({ ...p, expiryDate: value }))}
          />
          <FormInput
            label="Initial quantity"
            required
            type="number"
            step="0.0001"
            min="0.0001"
            value={form.initialQuantity}
            disabled={busy}
            onChange={(e) => setForm((p) => ({ ...p, initialQuantity: e.target.value }))}
          />
          <FormSelect
            label="Batch unit"
            required
            placeholder="Select unit"
            value={form.unitId}
            disabled={busy || !canUnits || units.loading || !!units.error}
            onChange={(e) => setForm((p) => ({ ...p, unitId: e.target.value }))}
          >
            {options(units.rows, form.unitId)}
          </FormSelect>
        </div>
        <CatalogueChoiceError label="Branch" source={branches} />
        <CatalogueChoiceError label="Supplier" source={suppliers} />
        <CatalogueChoiceError label="Unit" source={units} />
        <p className="inventory-register-note">
          Remaining quantity starts at the initial quantity. Dates are optional and are recorded at
          midnight UTC.
        </p>
      </form>
    </Modal>
  );
}
