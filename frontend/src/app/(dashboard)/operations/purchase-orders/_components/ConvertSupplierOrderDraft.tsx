'use client';

import { useEffect, useState } from 'react';
import { Btn, FormDateField, FormInput, FormSelect, Modal, SupplierPicker } from '@/components/ui';
import { ProductPicker } from '@/components/ui/product-picker';
import { useFormGuard } from '@/components/workspace/unsaved-work-provider';
import { backendList, backendPost } from '@/lib/api-client';
import type { SupplierOrderDraft } from './supplier-order-draft-types';

type Option = { id: string; name: string; symbol?: string; divisionId?: string };
type Mapping = { sourceDraftLineId: string; productId: string; unitId: string; unitCost: number };
type ConvertedOrder = { id: string; purchaseOrderNumber: string; internalInvoiceNumber: string };

export function ConvertSupplierOrderDraft({
  draft,
  onClose: closeWithoutGuard,
  onConverted,
}: {
  draft: SupplierOrderDraft;
  onClose: () => void;
  onConverted: (order: ConvertedOrder) => void;
}) {
  const [form, setForm] = useState(() => ({
    divisionId: draft.divisionId ?? '',
    branchId: draft.branchId ?? '',
    supplierId: draft.supplierId ?? '',
    purchaseType: 'STOCK_PURCHASE',
    orderDate: new Date().toISOString().slice(0, 10),
    supplierInvoiceNumber: '',
    supplierInvoiceDate: '',
    lines: draft.lines.map(
      (line): Mapping => ({
        sourceDraftLineId: line.id!,
        productId: '',
        unitId: '',
        unitCost: Number(line.unitPrice ?? 0),
      }),
    ),
  }));
  const guard = useFormGuard(form, setForm);
  const [divisions, setDivisions] = useState<Option[]>([]);
  const [branches, setBranches] = useState<Option[]>([]);
  const [units, setUnits] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      backendList<Option>('/divisions', { query: { companyId: draft.companyId, limit: 500 } }),
      backendList<Option>('/branches', {
        query: { companyId: draft.companyId, activeOnly: true, limit: 500 },
      }),
      backendList<Option>('/units', { query: { companyId: draft.companyId, limit: 500 } }),
    ])
      .then(([ds, bs, us]) => {
        if (!cancelled) {
          setDivisions(ds);
          setBranches(bs);
          setUnits(us);
          setForm((current) => ({
            ...current,
            divisionId:
              current.divisionId ||
              bs.find((branch) => branch.id === draft.branchId)?.divisionId ||
              '',
            lines: current.lines.map((mapping, index) => {
              const label = draft.lines[index].unitLabel.trim().toLowerCase();
              const matches = us.filter(
                (unit) => unit.name.toLowerCase() === label || unit.symbol?.toLowerCase() === label,
              );
              return mapping.unitId || matches.length !== 1
                ? mapping
                : { ...mapping, unitId: matches[0].id };
            }),
          }));
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : 'Could not load purchase options');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draft]);

  function setLine(index: number, patch: Partial<Mapping>) {
    guard.touch();
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  }
  async function convert() {
    if (!form.divisionId || !form.branchId) {
      setError('Select a division and branch');
      return;
    }
    if (
      form.lines.some(
        (line) =>
          !line.productId || !line.unitId || !Number.isFinite(line.unitCost) || line.unitCost <= 0,
      )
    ) {
      setError('Match every item to a product and unit and enter its cost');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const order = await backendPost<ConvertedOrder>(`/purchase-orders/from-draft/${draft.id}`, {
        companyId: draft.companyId,
        divisionId: form.divisionId,
        branchId: form.branchId,
        supplierId: form.supplierId || undefined,
        supplierName: draft.supplierName,
        currency: draft.currency,
        purchaseType: form.purchaseType,
        orderDate: form.orderDate,
        supplierInvoiceNumber: form.supplierInvoiceNumber.trim() || undefined,
        supplierInvoiceDate: form.supplierInvoiceDate || undefined,
        lines: form.lines.map((mapping, i) => ({
          ...mapping,
          quantity: Number(draft.lines[i].quantity),
          discountAmount: Number(draft.lines[i].discountAmount ?? 0),
          taxAmount: Number(draft.lines[i].taxAmount ?? 0),
        })),
      });
      guard.markSaved();
      onConverted(order);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not convert draft');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      size="3xl"
      title={`Convert ${draft.draftNumber} to Purchase Order`}
      onChangeCapture={guard.touch}
      onClose={() => {
        if (!saving) guard.requestClose(closeWithoutGuard);
      }}
      footer={
        <>
          <Btn
            variant="secondary"
            disabled={saving}
            onClick={() => guard.requestClose(closeWithoutGuard)}
          >
            Cancel
          </Btn>
          <Btn loading={saving} disabled={loading || saving} onClick={() => void convert()}>
            Create Purchase Order
          </Btn>
        </>
      }
    >
      <p className="mb-4 text-sm">
        An internal invoice number is generated automatically. You may also record the supplier’s
        invoice number. Confirmation and receiving follow the usual purchase workflow.
      </p>
      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormSelect
          label="Division"
          required
          value={form.divisionId}
          disabled={Boolean(draft.divisionId) || loading}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              divisionId: e.target.value,
              branchId: '',
              lines: f.lines.map((l) => ({ ...l, productId: '', unitId: '' })),
            }))
          }
          placeholder="Select division"
        >
          {divisions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Branch"
          required
          value={form.branchId}
          disabled={Boolean(draft.branchId) || loading || !form.divisionId}
          onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
          placeholder="Select branch"
        >
          {branches
            .filter((option) => option.divisionId === form.divisionId)
            .map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
        </FormSelect>
        <SupplierPicker
          label="Supplier"
          value={form.supplierId}
          companyId={draft.companyId}
          divisionId={form.divisionId || undefined}
          disabled={Boolean(draft.supplierId)}
          onChange={(supplierId) => setForm((f) => ({ ...f, supplierId }))}
        />
        <FormSelect
          label="Purchase Type"
          value={form.purchaseType}
          onChange={(e) => setForm((f) => ({ ...f, purchaseType: e.target.value }))}
        >
          {[
            'STOCK_PURCHASE',
            'CREDIT_PURCHASE',
            'CASH_PURCHASE',
            'SERVICE_PURCHASE',
            'ASSET_PURCHASE',
            'INTERNAL_COMPANY',
            'OTHER',
          ].map((type) => (
            <option key={type} value={type}>
              {type.replace(/_/g, ' ')}
            </option>
          ))}
        </FormSelect>
        <FormDateField
          label="Order Date"
          required
          value={form.orderDate}
          onChange={(orderDate) => {
            guard.touch();
            setForm((f) => ({ ...f, orderDate }));
          }}
        />
        <FormInput
          label="Supplier Invoice # (optional)"
          value={form.supplierInvoiceNumber}
          placeholder="Supplier-issued number"
          onChange={(e) => setForm((f) => ({ ...f, supplierInvoiceNumber: e.target.value }))}
        />
        <FormDateField
          label="Supplier Invoice Date"
          value={form.supplierInvoiceDate}
          onChange={(supplierInvoiceDate) => {
            guard.touch();
            setForm((f) => ({ ...f, supplierInvoiceDate }));
          }}
        />
      </div>
      <div className="mt-5 space-y-4">
        {draft.lines.map((line, index) => (
          <fieldset
            key={line.id}
            className="rounded-lg border p-4"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <legend className="px-1 text-sm font-medium">
              {index + 1}. {line.description}
            </legend>
            <p className="mb-3 text-xs">
              {Number(line.quantity).toLocaleString()} {line.unitLabel}
              {line.itemCode ? ` · ${line.itemCode}` : ''}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="mb-1 text-xs">Product</p>
                <ProductPicker
                  value={form.lines[index].productId}
                  companyId={draft.companyId}
                  divisionId={form.divisionId || undefined}
                  disabled={!form.divisionId || loading}
                  ariaLabel={`Product for ${line.description}`}
                  onChange={(productId) => setLine(index, { productId })}
                />
              </div>
              <FormSelect
                label={`Unit for item ${index + 1}`}
                value={form.lines[index].unitId}
                required
                placeholder="Select unit"
                disabled={loading}
                onChange={(e) => setLine(index, { unitId: e.target.value })}
              >
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                    {unit.symbol ? ` (${unit.symbol})` : ''}
                  </option>
                ))}
              </FormSelect>
              <FormInput
                label={`Unit Cost (${draft.currency}) for item ${index + 1}`}
                type="number"
                min="0.0001"
                step="0.0001"
                required
                value={form.lines[index].unitCost || ''}
                disabled={line.unitPrice != null}
                onChange={(e) => setLine(index, { unitCost: Number(e.target.value) })}
              />
            </div>
          </fieldset>
        ))}
      </div>
    </Modal>
  );
}
