'use client';
import { useId, useRef, useState } from 'react';
import { Btn, FormInput, FormSelect, FormTextarea, Modal } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { backendDelete, backendPatch, backendPost } from '@/lib/api-client';
import { DraftFormNotice, type WorkspaceDraft } from './workspace-drafts';
import { useInventoryDefinitionForm } from '@/features/inventory/inventory-definition-form';
import {
  UNIT_TYPES,
  unitTypeLabel,
  conversionName,
  conversionEquation,
  validConversionFactor,
  type Unit,
  type UnitConversion,
  type UnitCompany,
} from './unit-types';
import './unit-workspace.css';

function ChoiceError({
  label,
  source,
}: {
  label: string;
  source: { error: string; retry: () => void };
}) {
  return source.error ? (
    <p role="alert" className="workspace-notice">
      {label} choices unavailable. {source.error}{' '}
      <Btn variant="ghost" onClick={source.retry}>
        Retry {label.toLowerCase()} choices
      </Btn>
    </p>
  ) : null;
}
function CompanyChoice({
  value,
  onChange,
  disabled,
  choices,
}: {
  choices: ReturnType<typeof useWorkspaceChoices<UnitCompany>>;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const { hasPermission, user } = useAuth();
  const allowed = hasPermission('companies.read');
  return (
    <>
      <FormSelect
        label="Company scope"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || !allowed || choices.loading || !!choices.error}
      >
        <option value="">Automatic scope</option>
        {value && !choices.rows.some((c) => c.id === value) && (
          <option value={value}>{value === user?.companyId ? 'Assigned company' : value}</option>
        )}
        {choices.rows.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </FormSelect>
      <p className="unit-help">
        Scope is fixed after creation. Automatic scope uses your account’s default access; group
        accounts create a shared record.
      </p>
      <ChoiceError label="Company" source={choices} />
    </>
  );
}
export function UnitEditor({
  record,
  draftSource,
  companyId,
  onClose,
  onSaved,
}: {
  record?: Unit;
  companyId: string;
  draftSource?: WorkspaceDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { hasPermission, user } = useAuth();
  const baseline = {
    name: record?.name || '',
    symbol: record?.symbol || '',
    unitType: record?.unitType || 'PIECE',
    companyId: record ? record.companyId || '' : companyId || user?.companyId || '',
    isBaseUnit: record?.isBaseUnit || false,
    status: record?.status || 'ACTIVE',
  };
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(false),
    id = useId();
  const draft = useInventoryDefinitionForm({
    baseline,
    kind: 'unit',
    title: (record ? 'Edit ' : 'New ') + 'unit',
    describe: (values) => values.name || record?.name || 'Unit of measure',
    record,
    source: draftSource,
    busy,
    onClose,
    context: { systemUnit: String(!!record?.isSystemUnit) },
  });
  const { form, setForm } = draft;
  const companies = useWorkspaceChoices<UnitCompany>(
    '/companies',
    {},
    !record && hasPermission('companies.read'),
  );
  const companyError =
    !record &&
    (companies.error ||
      (hasPermission('companies.read') &&
      form.companyId &&
      !companies.loading &&
      !companies.rows.some((c) => c.id === form.companyId)
        ? 'Choose an available company or automatic scope.'
        : !hasPermission('companies.read') && form.companyId && form.companyId !== user?.companyId
          ? 'Your current role cannot select this company.'
          : ''));
  const allowed =
    hasPermission('units.view') && hasPermission('units.manage') && !record?.isSystemUnit;
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending.current || !allowed || draft.availabilityError || (!record && companies.loading))
      return;
      pending.current = true;
    try {
      draft.validateReview();
      await draft.saveNow();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review this draft.');
      pending.current = false;
      return;
    }
    if (companyError) {
      pending.current = false;
      return setError(companyError);
    }
    if (!form.name.trim() || !form.symbol.trim()) {
      pending.current = false;
      return setError('Enter a name and symbol.');
    }
        setBusy(true);
    setError('');
    try {
      const body = {
        name: form.name.trim(),
        symbol: form.symbol.trim(),
        unitType: form.unitType,
        isBaseUnit: form.isBaseUnit,
        status: form.status,
      };
      if (record) {
        const changes = Object.fromEntries(
          Object.entries(body).filter(
            ([key]) =>
              Object.hasOwn(draft.form, key) &&
              form[key as keyof typeof form] !== baseline[key as keyof typeof baseline],
          ),
        );
        if (Object.keys(changes).length) await backendPatch(`/units/${record.id}`, changes);
      } else
        await backendPost('/units', {
          ...body,
          ...(form.companyId ? { companyId: form.companyId } : {}),
        });
      draft.markSaved();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this unit.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={record ? 'Edit unit' : 'New unit'}
      size="md"
      onClose={close}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Btn>
          {draft.canRetain && (
            <Btn variant="secondary" disabled={busy} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn
            type="submit"
            form={id}
            loading={busy}
            disabled={!allowed || !!draft.availabilityError || (!record && companies.loading)}
          >
            {record ? 'Save changes' : 'Create unit'}
          </Btn>
        </>
      }
    >
      <form id={id} onSubmit={submit} {...draft.guard.capture} className="unit-editor">
        <DraftFormNotice draft={draft} />
        {record && (
          <p className="workspace-notice">
            Current: {record.name} · {record.symbol} · {unitTypeLabel(record.unitType)} ·{' '}
            {record.companyId || 'Shared'} · {record.status.toLowerCase()}
          </p>
        )}
        {!allowed && (
          <p role="alert" className="workspace-notice">
            {record?.isSystemUnit
              ? 'System units cannot be changed. Your draft can still be kept.'
              : 'Your current role cannot save this definition. Your draft can still be kept.'}
          </p>
        )}
        {companyError && (
          <p role="alert" className="workspace-notice">
            {companyError}
          </p>
        )}

        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
        {!record && (
          <CompanyChoice
            choices={companies}
            value={form.companyId}
            disabled={busy || !allowed}
            onChange={(companyId) => setForm((p) => ({ ...p, companyId }))}
          />
        )}
        <div className="workspace-form-grid">
          <FormInput
            label="Name"
            required
            disabled={busy || !allowed}
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          />
          <FormInput
            label="Symbol"
            required
            disabled={busy || !allowed}
            value={form.symbol}
            onChange={(e) => setForm((p) => ({ ...p, symbol: e.target.value }))}
          />
          <FormSelect
            label="Unit type"
            required
            disabled={busy || !allowed}
            value={form.unitType}
            onChange={(e) => setForm((p) => ({ ...p, unitType: e.target.value }))}
          >
            {UNIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {unitTypeLabel(t)}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Status"
            disabled={busy || !allowed}
            value={form.status}
            onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </FormSelect>
        </div>
        <label className="unit-check">
          <input
            type="checkbox"
            disabled={busy || !allowed}
            checked={form.isBaseUnit}
            onChange={(e) => setForm((p) => ({ ...p, isBaseUnit: e.target.checked }))}
          />
          Base unit for this type and scope
        </label>
        <p className="unit-help">
          Only one base unit is allowed for each type in a scope. System units cannot be changed.
        </p>
      </form>
    </Modal>
  );
}
export function ConversionEditor({
  record,
  draftSource,
  companyId,
  onClose,
  onSaved,
}: {
  record?: UnitConversion;
  companyId: string;
  draftSource?: WorkspaceDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { hasPermission, user } = useAuth();
  const baseline = {
    companyId: record ? record.companyId || '' : companyId || user?.companyId || '',
    fromUnitId: record?.fromUnitId || '',
    toUnitId: record?.toUnitId || '',
    conversionFactor: String(record?.conversionFactor ?? 1),
    description: record?.description || '',
    isActive: record?.isActive ?? true,
  };
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(false),
    id = useId();
  const draft = useInventoryDefinitionForm({
    baseline,
    kind: 'conversion',
    title: (record ? 'Edit ' : 'New ') + 'conversion',
    describe: (values) => values.description || record?.description || 'Unit conversion',
    record,
    source: draftSource,
    busy,
    onClose,
    context: { fromUnitId: record?.fromUnitId || '', toUnitId: record?.toUnitId || '' },
  });
  const { form, setForm } = draft;
  const companies = useWorkspaceChoices<UnitCompany>(
    '/companies',
    {},
    !record && hasPermission('companies.read'),
  );
  const companyError =
    !record &&
    (companies.error ||
      (hasPermission('companies.read') &&
      form.companyId &&
      !companies.loading &&
      !companies.rows.some((c) => c.id === form.companyId)
        ? 'Choose an available company or automatic scope.'
        : !hasPermission('companies.read') && form.companyId && form.companyId !== user?.companyId
          ? 'Your current role cannot select this company.'
          : ''));
  const allowed = hasPermission('units.view') && hasPermission('units.manage');
  const units = useWorkspaceChoices<Unit>(
    '/units',
    { companyId: form.companyId || undefined, status: 'ACTIVE' },
    allowed && !record && hasPermission('units.view'),
  );
  const options = units.rows;
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const from = record?.fromUnit || options.find((u) => u.id === form.fromUnitId),
    to = record?.toUnit || options.find((u) => u.id === form.toUnitId);
  const preview =
    from && to && validConversionFactor(form.conversionFactor)
      ? `1 ${from.symbol} = ${Number(form.conversionFactor)} ${to.symbol}`
      : 'Choose two units and a positive factor to preview the conversion.';
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending.current || !allowed || draft.availabilityError || (!record && companies.loading))
      return;
      pending.current = true;
    try {
      draft.validateReview();
      await draft.saveNow();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review this draft.');
      pending.current = false;
      return;
    }
    if (companyError) {
      pending.current = false;
      return setError(companyError);
    }
    if (
      !record &&
      (units.loading ||
        units.error ||
        !options.some((u) => u.id === form.fromUnitId) ||
        !options.some((u) => u.id === form.toUnitId))
    ) {
      pending.current = false;
      return setError('Load and select both units before saving.');
    }
    if (form.fromUnitId === form.toUnitId) {
      pending.current = false;
      return setError('Choose two different units.');
    }
    if (!validConversionFactor(form.conversionFactor)) {
      pending.current = false;
      return setError('Enter a positive, finite factor with at most six decimal places.');
    }
        setBusy(true);
    setError('');
    try {
      const body = {
        conversionFactor: Number(form.conversionFactor),
        description: form.description.trim(),
        isActive: form.isActive,
      };
      if (record) {
        const changes = Object.fromEntries(
          Object.entries(body).filter(
            ([key]) =>
              Object.hasOwn(draft.form, key) &&
              form[key as keyof typeof form] !== baseline[key as keyof typeof baseline],
          ),
        );
        if (Object.keys(changes).length)
          await backendPatch(`/unit-conversions/${record.id}`, changes);
      } else
        await backendPost('/unit-conversions', {
          ...body,
          fromUnitId: form.fromUnitId,
          toUnitId: form.toUnitId,
          ...(form.companyId ? { companyId: form.companyId } : {}),
        });
      draft.markSaved();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this conversion.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={record ? 'Edit conversion' : 'New conversion'}
      size="md"
      onClose={close}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Btn>
          {draft.canRetain && (
            <Btn variant="secondary" disabled={busy} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn
            type="submit"
            form={id}
            loading={busy}
            disabled={
              !allowed ||
              !!draft.availabilityError ||
              (!record && (companies.loading || units.loading || !!units.error))
            }
          >
            {record ? 'Save changes' : 'Create conversion'}
          </Btn>
        </>
      }
    >
      <form id={id} onSubmit={submit} {...draft.guard.capture} className="unit-editor">
        <DraftFormNotice draft={draft} />
        {record && (
          <p className="workspace-notice">
            Current: {conversionEquation(record)} · {record.isActive ? 'Active' : 'Inactive'}
          </p>
        )}
        {!allowed && (
          <p role="alert" className="workspace-notice">
            {'Your current role cannot save this definition. Your draft can still be kept.'}
          </p>
        )}
        {companyError && (
          <p role="alert" className="workspace-notice">
            {companyError}
          </p>
        )}

        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
        {record ? (
          <p className="unit-help">
            {conversionName(record)}. The unit pair and company scope are fixed; create a new
            conversion to use a different pair.
          </p>
        ) : (
          <>
            <CompanyChoice
              choices={companies}
              value={form.companyId}
              disabled={busy || !allowed}
              onChange={(companyId) =>
                setForm((p) => ({ ...p, companyId, fromUnitId: '', toUnitId: '' }))
              }
            />
            <ChoiceError label="Unit" source={units} />
          </>
        )}
        <div className="workspace-form-grid">
          {(['fromUnitId', 'toUnitId'] as const).map((key) => (
            <FormSelect
              key={key}
              label={key === 'fromUnitId' ? 'From unit' : 'To unit'}
              required
              value={form[key]}
              disabled={busy || !!record || units.loading || !!units.error}
              onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
            >
              <option value="">Select unit</option>
              {record ? (
                <option value={record[key]}>
                  {key === 'fromUnitId'
                    ? record.fromUnit?.name || record.fromUnitId
                    : record.toUnit?.name || record.toUnitId}
                </option>
              ) : (
                options.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.symbol})
                  </option>
                ))
              )}
            </FormSelect>
          ))}
        </div>
        <FormInput
          label="Conversion factor"
          required
          type="number"
          step="any"
          disabled={busy || !allowed}
          value={form.conversionFactor}
          onChange={(e) => setForm((p) => ({ ...p, conversionFactor: e.target.value }))}
        />
        <p className="unit-equation" aria-live="polite">
          {preview}
        </p>
        <FormTextarea
          label="Description"
          disabled={busy || !allowed}
          value={form.description}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
        />
        <label className="unit-check">
          <input
            type="checkbox"
            disabled={busy || !allowed}
            checked={form.isActive}
            onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
          />
          Active
        </label>
      </form>
    </Modal>
  );
}
export function UnitDelete({
  kind,
  record,
  onClose,
  onDeleted,
}: {
  kind: 'units' | 'unit-conversions';
  record: Unit | UnitConversion;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { hasPermission } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const label = kind === 'units' ? 'unit' : 'conversion';
  const name =
    'symbol' in record ? `${record.name} (${record.symbol})` : conversionEquation(record);
  const submit = async () => {
    if (busy || !hasPermission('units.manage') || ('isSystemUnit' in record && record.isSystemUnit))
      return;
    setBusy(true);
    setError('');
    try {
      await backendDelete(`/${kind}/${record.id}`);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to delete this ${label}.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={`Delete ${label}`}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={onClose}>
            Keep {label}
          </Btn>
          <Btn variant="danger" loading={busy} onClick={submit}>
            Delete {label}
          </Btn>
        </>
      }
    >
      <p className="unit-equation">{name}</p>
      <p className="unit-help">Remove this {label} from the active register?</p>
      {error && (
        <p className="workspace-notice" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
