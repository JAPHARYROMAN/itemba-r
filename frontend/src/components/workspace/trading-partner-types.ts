export type PartnerKind = 'customers' | 'suppliers';
export interface PartnerChoice {
  id: string;
  name: string;
  code?: string | null;
}
export interface PartnerCategory extends PartnerChoice {
  categoryType: string;
}
export interface TradingPartner {
  id: string;
  name: string;
  companyId: string;
  status: string;
  customerCode?: string | null;
  supplierCode?: string | null;
  customerType?: string;
  supplierType?: string;
  legalName?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  tin?: string | null;
  vrn?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  creditLimit: number | string;
  currentBalance: number | string;
  divisionId?: string | null;
  branchId?: string | null;
  company?: { name: string; code?: string | null } | null;
  division?: { name: string; code?: string | null } | null;
  branch?: { name: string; code?: string | null } | null;
  productCategories?: Array<{ productCategory: PartnerCategory }>;
}
export const partnerTypes = {
  customers: [
    'WALK_IN',
    'INDIVIDUAL',
    'COMPANY',
    'CORPORATE',
    'FLEET',
    'CONTRACTOR',
    'FARM_BUYER',
    'INTERNAL_COMPANY',
    'OTHER',
  ],
  suppliers: [
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
  ],
};
export const partnerStatuses = ['ACTIVE', 'INACTIVE', 'BLOCKED'];
export const partnerLabel = (kind: PartnerKind) => (kind === 'customers' ? 'Customer' : 'Supplier');
export const partnerHumanize = (value: string) =>
  value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
export const partnerCode = (r: TradingPartner) => r.customerCode || r.supplierCode || 'No code';
export function partnerMoney(value: number | string | null | undefined) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  return `TZS ${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function partnerForm(kind: PartnerKind, record?: TradingPartner, companyId = '') {
  return {
    companyId: record?.companyId || companyId,
    divisionId: record?.divisionId || '',
    branchId: record?.branchId || '',
    type:
      record?.customerType ||
      record?.supplierType ||
      (kind === 'customers' ? 'INDIVIDUAL' : 'GENERAL_SUPPLIER'),
    code: record?.customerCode || record?.supplierCode || '',
    name: record?.name || '',
    legalName: record?.legalName || '',
    contactPerson: record?.contactPerson || '',
    phone: record?.phone || '',
    email: record?.email || '',
    address: record?.address || '',
    tin: record?.tin || '',
    vrn: record?.vrn || '',
    creditLimit: String(record?.creditLimit ?? 0),
    paymentTerms: record?.paymentTerms || '',
    status: record?.status || 'ACTIVE',
    notes: record?.notes || '',
    productCategoryIds: record?.productCategories?.map((c) => c.productCategory.id) || [],
  };
}
