'use client';

import { useEffect, useMemo, useState } from 'react';
import { Btn, FormInput, FormSelect, FormTextarea, Modal, showToast } from '@/components/ui';
import { backendList, backendPatch, backendPost } from '@/lib/api-client';

export interface Company {
  id: string;
  name: string;
  code: string;
}

export interface Division {
  id: string;
  name: string;
  code: string;
}

export interface ProductCategory {
  id: string;
  name: string;
  categoryType: string;
}

export interface Supplier {
  id: string;
  supplierCode?: string | null;
  name: string;
  legalName?: string | null;
  supplierType: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  contactPerson?: string | null;
  tin?: string | null;
  vrn?: string | null;
  creditLimit: number;
  currentBalance: number;
  paymentTerms?: string | null;
  status: string;
  notes?: string | null;
  companyId: string;
  company?: { name: string; code?: string | null } | null;
  divisionId?: string | null;
  division?: { name: string; code?: string | null } | null;
  productCategories?: Array<{ productCategory: ProductCategory }>;
}

interface SupplierForm {
  companyId: string;
  divisionId: string;
  productCategoryIds: string[];
  supplierType: string;
  supplierCode: string;
  name: string;
  legalName: string;
  tin: string;
  vrn: string;
  phone: string;
  email: string;
  address: string;
  contactPerson: string;
  creditLimit: string;
  paymentTerms: string;
  status: string;
  notes: string;
}

export const SUPPLIER_TYPES = [
  'FUEL_SUPPLIER',
  'BEVERAGE_SUPPLIER',
  'HARDWARE_SUPPLIER',
  'AGRICULTURE_INPUT_SUPPLIER',
  'CONSTRUCTION_MATERIAL_SUPPLIER',
  'LOGISTICS_SERVICE_PROVIDER',
  'GENERAL_SUPPLIER',
  'CONTRACTOR',
  'SERVICE_PROVIDER',
  'OTHER',
];

export const SUPPLIER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'];

const BLANK_FORM: SupplierForm = {
  companyId: '',
  divisionId: '',
  productCategoryIds: [],
  supplierType: 'GENERAL_SUPPLIER',
  supplierCode: '',
  name: '',
  legalName: '',
  tin: '',
  vrn: '',
  phone: '',
  email: '',
  address: '',
  contactPerson: '',
  creditLimit: '0',
  paymentTerms: '',
  status: 'ACTIVE',
  notes: '',
};

export function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function categoryGroups(categories: ProductCategory[]) {
  return categories.reduce<Record<string, ProductCategory[]>>((groups, category) => {
    const key = category.categoryType || 'OTHER';
    groups[key] = groups[key] ?? [];
    groups[key].push(category);
    return groups;
  }, {});
}

function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="col-span-2 border-t pt-4" style={{ borderColor: 'var(--aurora-border)' }}>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
        {title}
      </h3>
      {description && (
        <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
          {description}
        </p>
      )}
    </div>
  );
}

export function SupplierFormModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Supplier;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<SupplierForm>(() =>
    initial
      ? {
          companyId: initial.companyId,
          divisionId: initial.divisionId ?? '',
          productCategoryIds:
            initial.productCategories?.map((item) => item.productCategory.id) ?? [],
          supplierType: initial.supplierType,
          supplierCode: initial.supplierCode ?? '',
          name: initial.name,
          legalName: initial.legalName ?? '',
          tin: initial.tin ?? '',
          vrn: initial.vrn ?? '',
          phone: initial.phone ?? '',
          email: initial.email ?? '',
          address: initial.address ?? '',
          contactPerson: initial.contactPerson ?? '',
          creditLimit: String(initial.creditLimit ?? 0),
          paymentTerms: initial.paymentTerms ?? '',
          status: initial.status,
          notes: initial.notes ?? '',
        }
      : { ...BLANK_FORM },
  );
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [categorySearch, setCategorySearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof SupplierForm>(k: K, v: SupplierForm[K]) =>
    setForm((current) => ({ ...current, [k]: v }));

  useEffect(() => {
    if (!form.companyId) {
      setDivisions([]);
      setCategories([]);
      return;
    }
    let cancelled = false;
    Promise.allSettled([
      backendList<Division>('/divisions', { query: { companyId: form.companyId, limit: 500 } }),
      backendList<ProductCategory>('/product-categories', {
        query: { companyId: form.companyId, limit: 5000 },
      }),
    ]).then(([divisionResult, categoryResult]) => {
      if (cancelled) return;
      setDivisions(divisionResult.status === 'fulfilled' ? divisionResult.value : []);
      setCategories(categoryResult.status === 'fulfilled' ? categoryResult.value : []);
    });
    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  const filteredCategories = useMemo(() => {
    const search = categorySearch.trim().toLowerCase();
    return categories
      .filter((category) => !search || category.name.toLowerCase().includes(search))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [categories, categorySearch]);

  const groupedCategories = useMemo(() => categoryGroups(filteredCategories), [filteredCategories]);

  const toggleCategory = (id: string) =>
    setForm((current) => ({
      ...current,
      productCategoryIds: current.productCategoryIds.includes(id)
        ? current.productCategoryIds.filter((categoryId) => categoryId !== id)
        : [...current.productCategoryIds, id],
    }));

  const handleSubmit = async () => {
    if (!form.companyId) return setError('Company is required');
    if (!form.divisionId) return setError('Division is required');
    if (!form.name.trim()) return setError('Supplier name is required');
    if (form.productCategoryIds.length === 0) {
      return setError('Select at least one product category this supplier serves');
    }

    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        companyId: form.companyId,
        divisionId: form.divisionId,
        productCategoryIds: form.productCategoryIds,
        supplierType: form.supplierType,
        name: form.name.trim(),
        status: form.status,
        creditLimit: Number(form.creditLimit) || 0,
      };
      if (form.supplierCode.trim()) body.supplierCode = form.supplierCode.trim();
      if (form.legalName.trim()) body.legalName = form.legalName.trim();
      if (form.tin.trim()) body.tin = form.tin.trim();
      if (form.vrn.trim()) body.vrn = form.vrn.trim();
      if (form.phone.trim()) body.phone = form.phone.trim();
      if (form.email.trim()) body.email = form.email.trim();
      if (form.address.trim()) body.address = form.address.trim();
      if (form.contactPerson.trim()) body.contactPerson = form.contactPerson.trim();
      if (form.paymentTerms.trim()) body.paymentTerms = form.paymentTerms.trim();
      if (form.notes.trim()) body.notes = form.notes.trim();

      if (mode === 'create') {
        await backendPost('/suppliers', body);
      } else {
        await backendPatch(`/suppliers/${initial!.id}`, body);
      }
      showToast('success', mode === 'create' ? 'Supplier created' : 'Supplier updated', form.name);
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save supplier';
      setError(message);
      showToast('error', 'Could not save supplier', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'Create Supplier' : 'Edit Supplier'}
      size="xl"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={saving}>
            {mode === 'create' ? 'Create Supplier' : 'Save Changes'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-950/20 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SectionTitle title="Scope" description="Supplier visibility and procurement ownership." />
        <FormSelect
          label="Company"
          required
          value={form.companyId}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              companyId: event.target.value,
              divisionId: '',
              productCategoryIds: [],
            }))
          }
          placeholder="Select company"
          disabled={mode === 'edit'}
        >
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name} ({company.code})
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Division"
          required
          value={form.divisionId}
          onChange={(event) => set('divisionId', event.target.value)}
          placeholder={form.companyId ? 'Select division' : 'Select company first'}
        >
          {divisions.map((division) => (
            <option key={division.id} value={division.id}>
              {division.name} ({division.code})
            </option>
          ))}
        </FormSelect>

        <SectionTitle title="Supplier Identity" description="Core supplier master data." />
        <FormSelect
          label="Type"
          required
          value={form.supplierType}
          onChange={(event) => set('supplierType', event.target.value)}
        >
          {SUPPLIER_TYPES.map((type) => (
            <option key={type} value={type}>
              {humanize(type)}
            </option>
          ))}
        </FormSelect>
        <FormInput
          label="Supplier Code"
          value={form.supplierCode}
          onChange={(event) => set('supplierCode', event.target.value)}
          placeholder="Auto-generated when blank"
        />
        <FormInput
          label="Name"
          required
          value={form.name}
          onChange={(event) => set('name', event.target.value)}
        />
        <FormInput
          label="Legal Name"
          value={form.legalName}
          onChange={(event) => set('legalName', event.target.value)}
        />

        <SectionTitle
          title="Contact & Tax"
          description="Information used on purchasing documents."
        />
        <FormInput
          label="TIN"
          value={form.tin}
          onChange={(event) => set('tin', event.target.value)}
        />
        <FormInput
          label="VRN"
          value={form.vrn}
          onChange={(event) => set('vrn', event.target.value)}
        />
        <FormInput
          label="Phone"
          value={form.phone}
          onChange={(event) => set('phone', event.target.value)}
        />
        <FormInput
          label="Email"
          type="email"
          value={form.email}
          onChange={(event) => set('email', event.target.value)}
        />
        <FormInput
          label="Contact Person"
          value={form.contactPerson}
          onChange={(event) => set('contactPerson', event.target.value)}
        />
        <FormTextarea
          label="Address"
          rows={2}
          value={form.address}
          onChange={(event) => set('address', event.target.value)}
        />

        <SectionTitle
          title="Product Categories"
          description="Controls which product categories this supplier can serve."
        />
        <div
          className="md:col-span-2 rounded-lg border p-3"
          style={{ borderColor: 'var(--aurora-border)' }}
        >
          <FormInput
            label="Search Categories"
            value={categorySearch}
            onChange={(event) => setCategorySearch(event.target.value)}
            placeholder="Search category name..."
          />
          <div className="mt-3 max-h-64 space-y-4 overflow-auto pr-1">
            {Object.entries(groupedCategories).map(([type, rows]) => (
              <div key={type}>
                <p
                  className="mb-2 text-xs font-semibold uppercase"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  {humanize(type)}
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {rows.map((category) => (
                    <label key={category.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.productCategoryIds.includes(category.id)}
                        onChange={() => toggleCategory(category.id)}
                        className="rounded"
                      />
                      <span style={{ color: 'var(--aurora-text)' }}>{category.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {filteredCategories.length === 0 && (
              <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                No categories match this search.
              </p>
            )}
          </div>
        </div>

        <SectionTitle title="Credit & Terms" description="Operational terms, not bank details." />
        <FormInput
          label="Credit Limit"
          type="number"
          value={form.creditLimit}
          onChange={(event) => set('creditLimit', event.target.value)}
        />
        <FormInput
          label="Payment Terms"
          value={form.paymentTerms}
          onChange={(event) => set('paymentTerms', event.target.value)}
          placeholder="Net 30, COD, etc."
        />
        <FormSelect
          label="Status"
          required
          value={form.status}
          onChange={(event) => set('status', event.target.value)}
        >
          {SUPPLIER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {humanize(status)}
            </option>
          ))}
        </FormSelect>
        <FormTextarea
          label="Notes"
          rows={2}
          value={form.notes}
          onChange={(event) => set('notes', event.target.value)}
        />
      </div>
    </Modal>
  );
}
