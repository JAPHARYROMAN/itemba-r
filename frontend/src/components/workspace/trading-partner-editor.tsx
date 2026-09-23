'use client';
import { useId, useState } from 'react';
import { Btn, FormInput, FormSelect, FormTextarea, Modal } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { backendPatch, backendPost } from '@/lib/api-client';
import { useFormGuard } from './unsaved-work-provider';
import {
  partnerForm,
  partnerHumanize,
  partnerLabel,
  partnerStatuses,
  partnerTypes,
  type PartnerKind,
  type PartnerChoice,
  type PartnerCategory,
  type TradingPartner,
} from './trading-partner-types';
import './workspace.css';
import './trading-partner.css';

export function TradingPartnerEditor({
  kind,
  record,
  companyId = '',
  onClose,
  onSaved,
}: {
  kind: PartnerKind;
  record?: TradingPartner;
  companyId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user, hasPermission } = useAuth();
  const label = partnerLabel(kind),
    supplier = kind === 'suppliers';
  const canChoose = hasPermission('companies.read'),
    canDivide = hasPermission('divisions.read'),
    canBranch = hasPermission('branches.read'),
    canCategorize = hasPermission('product_categories.view');
  const allowed = hasPermission(`${kind}.${record ? 'update' : 'create'}`);
  const [form, setForm] = useState(() =>
    partnerForm(kind, record, companyId || user?.companyId || ''),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [categorySearch, setCategorySearch] = useState('');
  const draft = useFormGuard(form, setForm),
    formId = useId();
  const companies = useWorkspaceChoices<PartnerChoice>(
    '/companies',
    {},
    allowed && !record && canChoose,
  );
  const divisions = useWorkspaceChoices<PartnerChoice>(
    '/divisions',
    { companyId: form.companyId },
    allowed && !!form.companyId && canDivide,
  );
  const branches = useWorkspaceChoices<PartnerChoice & { divisionId: string }>(
    '/branches',
    { companyId: form.companyId, activeOnly: true },
    allowed && !supplier && !!form.companyId && canBranch,
  );
  const categories = useWorkspaceChoices<PartnerCategory>(
    '/product-categories',
    { companyId: form.companyId },
    allowed && supplier && !!form.companyId && canCategorize,
  );
  const baseline = partnerForm(kind, record);
  const scopeChanged =
    form.divisionId !== baseline.divisionId || form.branchId !== baseline.branchId;
  const requireCustomerScope = !record || scopeChanged;
  const change =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value }));
  const close = () => {
    if (!busy) draft.requestClose(onClose);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !allowed) return;
    if (
      !form.companyId ||
      !form.name.trim() ||
      (supplier && !form.divisionId) ||
      (!supplier && requireCustomerScope && (!form.divisionId || !form.branchId))
    )
      return setError('Complete the required scope and name.');
    const credit = Number(form.creditLimit);
    if (!form.creditLimit.trim() || !Number.isFinite(credit) || credit < 0)
      return setError('Enter a valid, non-negative credit limit.');
    if (
      supplier &&
      (!record || form.productCategoryIds.length !== baseline.productCategoryIds.length) &&
      !form.productCategoryIds.length
    )
      return setError('Select at least one product category.');
    // Unchanged scope remains editable even without directory access; changed scope must be verified.
    if (
      (!record &&
        canChoose &&
        (companies.loading ||
          companies.error ||
          !companies.rows.some((c) => c.id === form.companyId))) ||
      ((!record || form.divisionId !== baseline.divisionId) &&
        (!canDivide ||
          divisions.loading ||
          divisions.error ||
          !divisions.rows.some((d) => d.id === form.divisionId))) ||
      (!supplier &&
        (!record || form.branchId !== baseline.branchId) &&
        (!canBranch ||
          branches.loading ||
          branches.error ||
          !branches.rows.some(
            (b) => b.id === form.branchId && b.divisionId === form.divisionId,
          ))) ||
      (supplier &&
        (!record ||
          JSON.stringify(form.productCategoryIds) !==
            JSON.stringify(baseline.productCategoryIds)) &&
        (!canCategorize ||
          categories.loading ||
          categories.error ||
          !form.productCategoryIds.every((id) => categories.rows.some((c) => c.id === id))))
    ) {
      return setError('Load the required scope choices before saving.');
    }
    const values: Record<string, unknown> = {
      name: form.name.trim(),
      [`${supplier ? 'supplier' : 'customer'}Type`]: form.type,
      status: form.status,
      creditLimit: credit,
    };
    for (const key of [
      'legalName',
      'contactPerson',
      'phone',
      'email',
      'address',
      'tin',
      'vrn',
      'paymentTerms',
      'notes',
    ] as const)
      values[key] = form[key].trim() || null;
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      const formKey = key.endsWith('Type') ? 'type' : (key as keyof typeof form);
      if (!record || form[formKey] !== baseline[formKey]) body[key] = value;
    }
    if (!record) {
      body.companyId = form.companyId;
      body.divisionId = form.divisionId;
      if (form.code.trim()) body[`${supplier ? 'supplier' : 'customer'}Code`] = form.code.trim();
    }
    if (supplier) {
      if (!record || form.divisionId !== baseline.divisionId) body.divisionId = form.divisionId;
      if (
        !record ||
        JSON.stringify(form.productCategoryIds) !== JSON.stringify(baseline.productCategoryIds)
      )
        body.productCategoryIds = form.productCategoryIds;
    } else if (!record || form.branchId !== baseline.branchId) {
      body.branchId = form.branchId;
      body.divisionId = form.divisionId;
    }
    if (record && !Object.keys(body).length) {
      draft.markSaved();
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (record) await backendPatch(`/${kind}/${record.id}`, body);
      else await backendPost(`/${kind}`, body);
      draft.markSaved();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to save this ${label.toLowerCase()}.`);
    } finally {
      setBusy(false);
    }
  };
  const fallback = (value: string, name: string | undefined, rows: PartnerChoice[]) =>
    value && !rows.some((r) => r.id === value) ? (
      <option value={value}>{name || value}</option>
    ) : null;
  return (
    <Modal
      open
      title={`${record ? 'Edit' : 'New'} ${label.toLowerCase()}`}
      size="xl"
      onClose={close}
      footer={
        <>
          <Btn variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Btn>
          <Btn type="submit" form={formId} loading={busy} disabled={!allowed}>
            {record ? 'Save changes' : `Create ${label.toLowerCase()}`}
          </Btn>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={submit}
        {...draft.capture}
        className="workspace-form partner-editor"
      >
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
        {!allowed && <p role="alert">Your role cannot save this {label.toLowerCase()}.</p>}
        {[
          ['Company', companies],
          ['Division', divisions],
          ['Branch', branches],
          ['Category', categories],
        ].map(([name, choices]) => {
          const source = choices as typeof companies;
          return source.error ? (
            <p role="alert" className="workspace-notice" key={name as string}>
              {name as string} choices unavailable. {source.error}{' '}
              <Btn type="button" variant="ghost" onClick={source.retry}>
                Retry {String(name).toLowerCase()} choices
              </Btn>
            </p>
          ) : null;
        })}
        <fieldset disabled={busy || !allowed} className="workspace-form-section">
          <legend>Scope</legend>
          <div className="workspace-form-grid">
            <FormSelect
              label="Company"
              required
              value={form.companyId}
              disabled={!!record || !canChoose || companies.loading || !!companies.error}
              placeholder="Select company"
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  companyId: e.target.value,
                  divisionId: '',
                  branchId: '',
                  productCategoryIds: [],
                }))
              }
            >
              {fallback(form.companyId, record?.company?.name, companies.rows)}
              {companies.rows.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Division"
              required={supplier || requireCustomerScope}
              value={form.divisionId}
              disabled={!form.companyId || !canDivide || divisions.loading || !!divisions.error}
              placeholder="Select division"
              onChange={(e) => setForm((p) => ({ ...p, divisionId: e.target.value, branchId: '' }))}
            >
              {fallback(form.divisionId, record?.division?.name, divisions.rows)}
              {divisions.rows.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </FormSelect>
            {!supplier && (
              <FormSelect
                label="Branch / location"
                required={requireCustomerScope}
                value={form.branchId}
                disabled={!form.divisionId || !canBranch || branches.loading || !!branches.error}
                placeholder="Select branch"
                onChange={change('branchId')}
              >
                {fallback(form.branchId, record?.branch?.name, branches.rows)}
                {branches.rows
                  .filter((b) => b.divisionId === form.divisionId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </FormSelect>
            )}
          </div>
          {(!canDivide || (!supplier && !canBranch) || (supplier && !canCategorize)) && (
            <p className="partner-help">
              Your role can retain the recorded scope. Choosing new scope requires access to the
              relevant directories.
            </p>
          )}
        </fieldset>
        <fieldset disabled={busy || !allowed} className="workspace-form-section">
          <legend>Identity</legend>
          <div className="workspace-form-grid">
            <FormInput label="Name" required value={form.name} onChange={change('name')} />
            <FormInput label="Legal name" value={form.legalName} onChange={change('legalName')} />
            <FormSelect
              label="Type"
              required
              value={form.type}
              onChange={change('type')}
              options={partnerTypes[kind].map((value) => ({
                value,
                label: partnerHumanize(value),
              }))}
            />
            <FormInput
              label={`${label} code`}
              value={form.code}
              disabled={!!record}
              onChange={change('code')}
              placeholder="Generated when blank"
            />
          </div>
        </fieldset>
        <fieldset disabled={busy || !allowed} className="workspace-form-section">
          <legend>Contact and tax</legend>
          <div className="workspace-form-grid">
            <FormInput
              label="Contact person"
              value={form.contactPerson}
              onChange={change('contactPerson')}
            />
            <FormInput label="Phone" type="tel" value={form.phone} onChange={change('phone')} />
            <FormInput label="Email" type="email" value={form.email} onChange={change('email')} />
            <FormInput label="TIN" value={form.tin} onChange={change('tin')} />
            <FormInput label="VRN" value={form.vrn} onChange={change('vrn')} />
          </div>
          <FormTextarea
            label="Address"
            rows={2}
            value={form.address}
            onChange={change('address')}
          />
        </fieldset>
        {supplier && (
          <fieldset
            disabled={
              busy || !allowed || !canCategorize || categories.loading || !!categories.error
            }
            className="workspace-form-section"
          >
            <legend>Product categories</legend>
            <p className="partner-help">
              Select the categories this supplier serves. {form.productCategoryIds.length} selected.
            </p>
            <FormInput
              label="Find categories"
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
            />
            <div className="partner-categories">
              {categories.rows
                .filter((c) => c.name.toLowerCase().includes(categorySearch.trim().toLowerCase()))
                .map((c) => (
                  <label key={c.id}>
                    <input
                      type="checkbox"
                      checked={form.productCategoryIds.includes(c.id)}
                      onChange={() =>
                        setForm((p) => ({
                          ...p,
                          productCategoryIds: p.productCategoryIds.includes(c.id)
                            ? p.productCategoryIds.filter((id) => id !== c.id)
                            : [...p.productCategoryIds, c.id],
                        }))
                      }
                    />
                    <span>
                      {c.name}
                      <small>{partnerHumanize(c.categoryType)}</small>
                    </span>
                  </label>
                ))}
            </div>
            {!categories.loading && !categories.rows.length && (
              <p className="partner-help">No category choices available for this company.</p>
            )}
            {record?.productCategories
              ?.filter((c) => !categories.rows.some((row) => row.id === c.productCategory.id))
              .map((c) => (
                <p className="partner-help" key={c.productCategory.id}>
                  Recorded category: {c.productCategory.name}
                </p>
              ))}
          </fieldset>
        )}
        <fieldset disabled={busy || !allowed} className="workspace-form-section">
          <legend>Credit and terms</legend>
          <p className="partner-help">
            Balances are calculated from {supplier ? 'payables' : 'receivables'}.
          </p>
          <div className="workspace-form-grid">
            <FormInput
              label="Credit limit (TZS)"
              type="number"
              min="0"
              step="0.01"
              required
              value={form.creditLimit}
              onChange={change('creditLimit')}
            />
            <FormInput
              label="Payment terms"
              value={form.paymentTerms}
              onChange={change('paymentTerms')}
              placeholder="Net 30, COD…"
            />
            <FormSelect
              label="Status"
              value={form.status}
              onChange={change('status')}
              options={partnerStatuses.map((value) => ({ value, label: partnerHumanize(value) }))}
            />
          </div>
          <FormTextarea label="Notes" rows={3} value={form.notes} onChange={change('notes')} />
        </fieldset>
      </form>
    </Modal>
  );
}
