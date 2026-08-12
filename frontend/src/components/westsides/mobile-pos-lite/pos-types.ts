import type { MobilePosLiteProduct } from '@/lib/mobile-pos-lite-store';
import type { PosStringKey } from './pos-i18n';

export type Session = {
  terminal: {
    id: string;
    code: string;
    name: string;
    configVersion: number;
    offlineCashEnabled: boolean;
    /** Kaunta rollout pilot flag: 1 = classic shell, 2 = Kaunta shell (Phase 2+). */
    uiVersion?: number;
  };
  company: { id: string; name: string; code: string };
  division: { id: string; name: string; code: string };
  branch: { id: string; name: string; code: string };
  rep: { id: string; name: string };
  paymentMethods: Array<{ code: string; label: string; requiresReference: boolean }>;
  purchasesEnabled?: boolean;
};

export type Customer = {
  id: string;
  name: string;
  customerCode?: string | null;
  phone?: string | null;
};
export type Supplier = {
  id: string;
  name: string;
  supplierCode?: string | null;
  phone?: string | null;
};
export type CartLine = { product: MobilePosLiteProduct; quantity: number };
export type PurchaseLine = { product: MobilePosLiteProduct; quantity: number; unitCost: string };
export type DaySummary = {
  count: number;
  totalAmount: number;
  sales: Array<{
    id: string;
    salesOrderNumber: string;
    totalAmount: number;
    paymentMethod: string;
    createdAt: string;
    customerName?: string | null;
  }>;
};
export type SaleResult = {
  id: string;
  salesOrderNumber?: string;
  totalAmount?: number;
  receiptNumber?: string;
};

/** The screen-state union of the POS orchestrator. */
export type PosScreen = 'home' | 'sale' | 'payment' | 'success' | 'queue' | 'purchase' | 'mySales';

/** Signature of the `t` function returned by `usePosLang()`. */
export type PosTranslate = (key: PosStringKey, vars?: Record<string, string | number>) => string;
