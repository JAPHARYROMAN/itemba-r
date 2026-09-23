'use client';
import { TradingPartnerEditor } from '@/components/workspace/trading-partner-editor';
import {
  partnerHumanize,
  partnerStatuses,
  partnerTypes,
  type TradingPartner,
  type PartnerCategory,
} from '@/components/workspace/trading-partner-types';
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
export type ProductCategory = PartnerCategory;
export interface Supplier extends TradingPartner {
  supplierType: string;
}
export const SUPPLIER_STATUSES = partnerStatuses;
export const SUPPLIER_TYPES = partnerTypes.suppliers;
export const humanize = partnerHumanize;
export function SupplierFormModal({
  initial,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Supplier;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <TradingPartnerEditor kind="suppliers" record={initial} onClose={onClose} onSaved={onSaved} />
  );
}
