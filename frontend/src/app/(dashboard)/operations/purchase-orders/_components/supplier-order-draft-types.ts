export type SupplierOrderDraftStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';

export interface SupplierOrderDraftLine {
  id?: string;
  lineNumber?: number;
  itemCode?: string | null;
  description: string;
  quantity: number | string;
  unitLabel: string;
  unitPrice?: number | string | null;
  discountAmount?: number | string;
  taxAmount?: number | string;
  lineTotal?: number | string | null;
  notes?: string | null;
}

export interface SupplierOrderDraft {
  id: string;
  draftNumber: string;
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  supplierId?: string | null;
  supplierName: string;
  supplierAddress?: string | null;
  supplierContact?: string | null;
  supplierTin?: string | null;
  supplierVrn?: string | null;
  supplierPhone?: string | null;
  supplierEmail?: string | null;
  draftDate: string;
  neededBy?: string | null;
  currency: string;
  title?: string | null;
  deliveryInstructions?: string | null;
  terms?: string | null;
  notes?: string | null;
  subtotal: number | string;
  discountAmount: number | string;
  taxAmount: number | string;
  totalAmount: number | string;
  hasUnpricedLines: boolean;
  status: SupplierOrderDraftStatus;
  sentAt?: string | null;
  acceptedAt?: string | null;
  declinedAt?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  updatedAt: string;
  company?: CompanyOption;
  division?: { id: string; name: string; code: string } | null;
  branch?: { id: string; name: string; code?: string | null; address?: string | null } | null;
  supplier?: { id: string; name: string; supplierCode?: string | null; status?: string } | null;
  createdBy?: { id: string; fullName: string; email: string } | null;
  lines: SupplierOrderDraftLine[];
}

export interface CompanyOption {
  id: string;
  name: string;
  code: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  group?: {
    name?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
  } | null;
  profile?: {
    registeredName?: string | null;
    brelaRegNumber?: string | null;
    tin?: string | null;
    vrn?: string | null;
    registeredAddress?: string | null;
    postalAddress?: string | null;
  } | null;
}

export interface DivisionOption {
  id: string;
  name: string;
  code: string;
}
export interface BranchOption {
  id: string;
  name: string;
  code?: string | null;
  divisionId: string;
}
export interface SupplierOption {
  id: string;
  name: string;
  supplierCode?: string | null;
  address?: string | null;
  contactPerson?: string | null;
  tin?: string | null;
  vrn?: string | null;
  phone?: string | null;
  email?: string | null;
}

export function money(value: number | string | null | undefined, currency = 'TZS') {
  return `${currency} ${Number(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function dateOnly(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}
