// Shared sales-order constants used by the Operations sales-order screen
// (app/(dashboard)/operations/sales-orders/page.tsx) and the Westsides
// quick-sale flow so the experiences cannot drift apart. Values mirror the
// backend SalesType / SalesPaymentMethod / CashAccountType enums.

export const SALES_TYPES = [
  'CASH_SALE',
  'CREDIT_SALE',
  'WHOLESALE',
  'RETAIL',
  'SERVICE',
  'INTERNAL_COMPANY',
  'OTHER',
];

export const SALES_TYPE_LABELS: Record<string, string> = {
  CASH_SALE: 'Cash Sale',
  CREDIT_SALE: 'Credit Sale',
  WHOLESALE: 'Wholesale',
  RETAIL: 'Retail Sale',
  SERVICE: 'Service',
  INTERNAL_COMPANY: 'Internal Company',
  OTHER: 'Other',
};

// Value/label option list for <FormSelect> consumers (e.g. Mobile POS).
export const SALES_TYPE_OPTIONS = SALES_TYPES.map((value) => ({
  value,
  label: SALES_TYPE_LABELS[value] ?? value,
}));

export const CURRENCIES = ['TZS', 'USD', 'EUR'];

export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'MOBILE_MONEY', label: 'Mobile Money' },
  { value: 'BANK_CARD', label: 'Bank Card' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CREDIT', label: 'Credit (invoice)' },
  { value: 'MIXED', label: 'Mixed' },
  { value: 'OTHER', label: 'Other' },
];

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  CASH_ON_HAND: 'Cash on hand',
  PETTY_CASH: 'Petty cash',
  BANK: 'Bank',
  MOBILE_MONEY: 'Mobile money',
  OTHER: 'Other',
};

// CREDIT_SALE defaults to a CREDIT (invoice) payment; cash/retail sales collect
// payment at the counter. Mirrors the Operations form behavior.
export function defaultPaymentMethodForSalesType(salesType: string, current?: string) {
  if (salesType === 'CASH_SALE' || salesType === 'RETAIL') {
    return current && current !== 'CREDIT' ? current : 'CASH';
  }
  if (salesType === 'CREDIT_SALE') return 'CREDIT';
  return current ?? 'CREDIT';
}
