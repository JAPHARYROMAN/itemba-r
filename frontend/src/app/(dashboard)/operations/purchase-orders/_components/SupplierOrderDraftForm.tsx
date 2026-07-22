'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Btn, FormInput, FormSelect, FormTextarea, Modal, showToast } from '@/components/ui';
import { backendList, backendPatch, backendPost } from '@/lib/api-client';
import type {
  BranchOption,
  CompanyOption,
  DivisionOption,
  SupplierOption,
  SupplierOrderDraft,
  SupplierOrderDraftLine,
} from './supplier-order-draft-types';
import { money } from './supplier-order-draft-types';

type EditLine = SupplierOrderDraftLine & { key: string; quantity: string; unitPrice: string; discountAmount: string; taxAmount: string };

interface Props {
  open: boolean;
  companies: CompanyOption[];
  initial?: SupplierOrderDraft | null;
  onClose: () => void;
  onSaved: (draft: SupplierOrderDraft) => void;
}

function today() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function blankLine(): EditLine {
  return { key: crypto.randomUUID(), description: '', itemCode: '', quantity: '1', unitLabel: 'pcs', unitPrice: '', discountAmount: '0', taxAmount: '0', notes: '' };
}

function toEditLine(line: SupplierOrderDraftLine): EditLine {
  return {
    ...line,
    key: line.id ?? crypto.randomUUID(),
    quantity: String(line.quantity ?? 1),
    unitPrice: line.unitPrice === null || line.unitPrice === undefined ? '' : String(line.unitPrice),
    discountAmount: String(line.discountAmount ?? 0),
    taxAmount: String(line.taxAmount ?? 0),
  };
}

export function SupplierOrderDraftForm({ open, companies, initial, onClose, onSaved }: Props) {
  const [companyId, setCompanyId] = useState(initial?.companyId ?? companies[0]?.id ?? '');
  const [divisionId, setDivisionId] = useState(initial?.divisionId ?? '');
  const [branchId, setBranchId] = useState(initial?.branchId ?? '');
  const [supplierMode, setSupplierMode] = useState<'saved' | 'manual'>(initial?.supplierId ? 'saved' : 'manual');
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? '');
  const [supplierName, setSupplierName] = useState(initial?.supplierName ?? '');
  const [supplierAddress, setSupplierAddress] = useState(initial?.supplierAddress ?? '');
  const [supplierContact, setSupplierContact] = useState(initial?.supplierContact ?? '');
  const [supplierTin, setSupplierTin] = useState(initial?.supplierTin ?? '');
  const [supplierVrn, setSupplierVrn] = useState(initial?.supplierVrn ?? '');
  const [supplierPhone, setSupplierPhone] = useState(initial?.supplierPhone ?? '');
  const [supplierEmail, setSupplierEmail] = useState(initial?.supplierEmail ?? '');
  const [draftDate, setDraftDate] = useState(initial?.draftDate?.slice(0, 10) ?? today());
  const [neededBy, setNeededBy] = useState(initial?.neededBy?.slice(0, 10) ?? '');
  const [currency, setCurrency] = useState(initial?.currency ?? 'TZS');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [deliveryInstructions, setDeliveryInstructions] = useState(initial?.deliveryInstructions ?? '');
  const [terms, setTerms] = useState(initial?.terms ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [lines, setLines] = useState<EditLine[]>(initial?.lines?.length ? initial.lines.map(toEditLine) : [blankLine()]);
  const [divisions, setDivisions] = useState<DivisionOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!companyId) return;
    Promise.all([
      backendList<DivisionOption>('/divisions', { query: { companyId, limit: 200 } }),
      backendList<BranchOption>('/branches', { query: { companyId, activeOnly: true, limit: 500 } }),
      backendList<SupplierOption>('/suppliers', { query: { companyId, limit: 500 } }),
    ]).then(([divisionRows, branchRows, supplierRows]) => {
      setDivisions(divisionRows);
      setBranches(branchRows);
      setSuppliers(supplierRows);
    }).catch(() => {
      setDivisions([]);
      setBranches([]);
      setSuppliers([]);
    });
  }, [companyId]);

  const visibleBranches = divisionId ? branches.filter((branch) => branch.divisionId === divisionId) : branches;
  const totals = useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    let tax = 0;
    let unpriced = 0;
    lines.forEach((line) => {
      if (!line.unitPrice.trim()) { unpriced += 1; return; }
      subtotal += Number(line.quantity || 0) * Number(line.unitPrice || 0);
      discount += Number(line.discountAmount || 0);
      tax += Number(line.taxAmount || 0);
    });
    return { subtotal, discount, tax, total: subtotal - discount + tax, unpriced };
  }, [lines]);

  function patchLine(key: string, patch: Partial<EditLine>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  }

  async function save() {
    setError('');
    if (!companyId || !draftDate || !currency) return setError('Company, draft date, and currency are required.');
    if (supplierMode === 'saved' ? !supplierId : !supplierName.trim()) return setError('Select a supplier or enter a manual supplier name.');
    if (!lines.length || lines.some((line) => !line.description.trim() || Number(line.quantity) <= 0 || !line.unitLabel.trim())) {
      return setError('Every line needs a description, positive quantity, and unit.');
    }
    const payload = {
      companyId,
      divisionId: divisionId || undefined,
      branchId: branchId || undefined,
      supplierId: supplierMode === 'saved' ? supplierId : undefined,
      supplierName: supplierMode === 'manual' ? supplierName.trim() : undefined,
      supplierAddress: supplierMode === 'manual' ? supplierAddress : undefined,
      supplierContact: supplierMode === 'manual' ? supplierContact : undefined,
      supplierTin: supplierMode === 'manual' ? supplierTin : undefined,
      supplierVrn: supplierMode === 'manual' ? supplierVrn : undefined,
      supplierPhone: supplierMode === 'manual' ? supplierPhone : undefined,
      supplierEmail: supplierMode === 'manual' ? supplierEmail || undefined : undefined,
      draftDate,
      neededBy: neededBy || undefined,
      currency,
      title: title || undefined,
      deliveryInstructions: deliveryInstructions || undefined,
      terms: terms || undefined,
      notes: notes || undefined,
      lines: lines.map((line) => ({
        itemCode: line.itemCode?.trim() || undefined,
        description: line.description.trim(),
        quantity: Number(line.quantity),
        unitLabel: line.unitLabel.trim(),
        unitPrice: line.unitPrice.trim() ? Number(line.unitPrice) : null,
        discountAmount: line.unitPrice.trim() ? Number(line.discountAmount || 0) : 0,
        taxAmount: line.unitPrice.trim() ? Number(line.taxAmount || 0) : 0,
        notes: line.notes?.trim() || undefined,
      })),
    };
    setSaving(true);
    try {
      const result = initial
        ? await backendPatch<SupplierOrderDraft>(`/supplier-order-drafts/${initial.id}`, payload)
        : await backendPost<SupplierOrderDraft>('/supplier-order-drafts', payload);
      showToast('success', initial ? 'Supplier order draft updated' : 'Supplier order draft created');
      onSaved(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save supplier order draft');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? `Edit ${initial.draftNumber}` : 'New Supplier Order Draft'} subtitle="Planning document only. This will not create stock, payables, journals, or an actual purchase order." size="3xl" dismissOnBackdrop={false} footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn loading={saving} onClick={save}>{initial ? 'Save Changes' : 'Create Draft'}</Btn></>}>
      <div className="space-y-6">
        {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <section>
          <h3 className="mb-3 text-sm font-semibold">Company Scope</h3>
          <div className="grid gap-3 md:grid-cols-3">
            <FormSelect label="Company" required value={companyId} disabled={Boolean(initial)} onChange={(event) => { setCompanyId(event.target.value); setDivisionId(''); setBranchId(''); setSupplierId(''); }} options={companies.map((company) => ({ value: company.id, label: `${company.code} - ${company.name}` }))} />
            <FormSelect label="Division" value={divisionId} onChange={(event) => { setDivisionId(event.target.value); setBranchId(''); }} placeholder="All / not specified" options={divisions.map((division) => ({ value: division.id, label: `${division.code} - ${division.name}` }))} />
            <FormSelect label="Branch" value={branchId} onChange={(event) => setBranchId(event.target.value)} placeholder="All / not specified" options={visibleBranches.map((branch) => ({ value: branch.id, label: `${branch.code ?? ''} ${branch.name}`.trim() }))} />
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Supplier</h3>
            <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: 'var(--aurora-border)' }}>
              <button type="button" className={`rounded-md px-3 py-1 text-xs ${supplierMode === 'saved' ? 'bg-brand-600 text-white' : ''}`} onClick={() => setSupplierMode('saved')}>Saved Supplier</button>
              <button type="button" className={`rounded-md px-3 py-1 text-xs ${supplierMode === 'manual' ? 'bg-brand-600 text-white' : ''}`} onClick={() => setSupplierMode('manual')}>One-off Supplier</button>
            </div>
          </div>
          {supplierMode === 'saved' ? (
            <FormSelect label="Supplier" required value={supplierId} onChange={(event) => setSupplierId(event.target.value)} placeholder="Select supplier" options={suppliers.map((supplier) => ({ value: supplier.id, label: `${supplier.supplierCode ?? ''} ${supplier.name}`.trim() }))} />
          ) : (
            <div className="grid gap-3 md:grid-cols-4">
              <FormInput label="Supplier Name" required value={supplierName} onChange={(event) => setSupplierName(event.target.value)} />
              <FormInput label="Contact Person" value={supplierContact} onChange={(event) => setSupplierContact(event.target.value)} />
              <FormInput label="Phone" value={supplierPhone} onChange={(event) => setSupplierPhone(event.target.value)} />
              <FormInput label="Email" type="email" value={supplierEmail} onChange={(event) => setSupplierEmail(event.target.value)} />
              <FormInput label="TIN" value={supplierTin} onChange={(event) => setSupplierTin(event.target.value)} />
              <FormInput label="VRN" value={supplierVrn} onChange={(event) => setSupplierVrn(event.target.value)} />
              <FormTextarea className="md:col-span-2" label="Address" rows={2} value={supplierAddress} onChange={(event) => setSupplierAddress(event.target.value)} />
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold">Document</h3>
          <div className="grid gap-3 md:grid-cols-4">
            <FormInput label="Draft Date" required type="date" value={draftDate} onChange={(event) => setDraftDate(event.target.value)} />
            <FormInput label="Needed By" type="date" value={neededBy} onChange={(event) => setNeededBy(event.target.value)} />
            <FormSelect label="Currency" required value={currency} onChange={(event) => setCurrency(event.target.value)} options={['TZS', 'USD', 'EUR'].map((code) => ({ value: code, label: code }))} />
            <FormInput label="Document Title" placeholder="Optional request title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <div><h3 className="text-sm font-semibold">Manual Line Items</h3><p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>No product or unit database record is required. Leave unit price blank when awaiting a quote.</p></div>
            <Btn size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setLines((current) => [...current, blankLine()])}>Add Line</Btn>
          </div>
          <div className="space-y-3">
            {lines.map((line, index) => {
              const priced = Boolean(line.unitPrice.trim());
              const lineTotal = priced ? Number(line.quantity || 0) * Number(line.unitPrice || 0) - Number(line.discountAmount || 0) + Number(line.taxAmount || 0) : null;
              return (
                <div key={line.key} className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                  <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold">Line {index + 1}</span><button type="button" aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} className="text-red-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div>
                  <div className="grid gap-3 md:grid-cols-12">
                    <FormInput className="md:col-span-2" label="Item Code" value={line.itemCode ?? ''} onChange={(event) => patchLine(line.key, { itemCode: event.target.value })} />
                    <FormInput className="md:col-span-4" label="Description" required value={line.description} onChange={(event) => patchLine(line.key, { description: event.target.value })} />
                    <FormInput className="md:col-span-1" label="Qty" required type="number" min="0.0001" step="any" value={line.quantity} onChange={(event) => patchLine(line.key, { quantity: event.target.value })} />
                    <FormInput className="md:col-span-1" label="Unit" required value={line.unitLabel} onChange={(event) => patchLine(line.key, { unitLabel: event.target.value })} />
                    <FormInput className="md:col-span-2" label="Unit Price" hint="Blank = confirm later" type="number" min="0.0001" step="any" value={line.unitPrice} onChange={(event) => patchLine(line.key, { unitPrice: event.target.value, ...(!event.target.value && { discountAmount: '0', taxAmount: '0' }) })} />
                    <div className="md:col-span-2"><div className="mb-1 text-[12px] font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>Amount</div><div className="min-h-9 rounded-lg border px-3 py-2 text-xs font-semibold" style={{ borderColor: 'var(--aurora-border)' }}>{lineTotal === null ? 'Price to be confirmed' : money(lineTotal, currency)}</div></div>
                    {priced && <><FormInput className="md:col-span-2 md:col-start-7" label="Line Discount" type="number" min="0" step="any" value={line.discountAmount} onChange={(event) => patchLine(line.key, { discountAmount: event.target.value })} /><FormInput className="md:col-span-2" label="Line Tax" type="number" min="0" step="any" value={line.taxAmount} onChange={(event) => patchLine(line.key, { taxAmount: event.target.value })} /><FormInput className="md:col-span-4" label="Line Notes" value={line.notes ?? ''} onChange={(event) => patchLine(line.key, { notes: event.target.value })} /></>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="grid gap-3 md:grid-cols-3">
            <FormTextarea label="Delivery Instructions" value={deliveryInstructions} onChange={(event) => setDeliveryInstructions(event.target.value)} />
            <FormTextarea label="Terms" value={terms} onChange={(event) => setTerms(event.target.value)} />
            <FormTextarea label="Internal / Supplier Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
          <div className="rounded-lg border p-4" style={{ borderColor: 'var(--aurora-border)' }}>
            <div className="space-y-2 text-sm"><div className="flex justify-between"><span>Priced subtotal</span><b>{money(totals.subtotal, currency)}</b></div><div className="flex justify-between"><span>Discount</span><b>-{money(totals.discount, currency)}</b></div><div className="flex justify-between"><span>Tax</span><b>{money(totals.tax, currency)}</b></div><div className="flex justify-between border-t pt-2" style={{ borderColor: 'var(--aurora-border)' }}><span className="font-semibold">{totals.unpriced ? 'Partial total' : 'Total'}</span><b>{money(totals.total, currency)}</b></div></div>
            {totals.unpriced > 0 && <p className="mt-3 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">{totals.unpriced} line{totals.unpriced === 1 ? '' : 's'} marked “Price to be confirmed”.</p>}
          </div>
        </section>
      </div>
    </Modal>
  );
}
