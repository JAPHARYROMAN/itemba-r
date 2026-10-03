import type { Movement } from './types';

/** A counterparty or settled document shown on a movement: text always, a link when allowed. */
export type MovementLink = { label: string; text: string; href: string | null };
type Can = (...permissions: string[]) => boolean;
const none: Can = () => false;

/**
 * Who the money went to or came from. The link opens the party's profile when the reader
 * may see it; otherwise the name is plain text. A name is never turned into a link by
 * guessing: only the stored id links, and only to the profile that owns it.
 */
export function movementParty(m: Movement, can: Can = none): MovementLink | null {
  if (m.supplier)
    return {
      label: 'Supplier',
      text: m.supplier.name,
      href: can('suppliers.view')
        ? `/invoice-desk/suppliers/${encodeURIComponent(m.supplier.id)}`
        : null,
    };
  if (m.customer)
    return {
      label: 'Customer',
      text: m.customer.name,
      href: can('customers.view')
        ? `/sales-desk/customers/${encodeURIComponent(m.customer.id)}`
        : null,
    };
  if (m.partyType === 'EMPLOYEE')
    return { label: 'Employee', text: m.payee || 'Employee', href: null };
  if (m.partyType === 'COMPANY')
    return { label: 'Group company', text: m.payee || 'Group company', href: null };
  return null;
}

/**
 * The documents this movement settled. Registers open filtered to the document number
 * (`?search=`), Invoice Desk and Sales Desk open the record itself. Supplier payments,
 * customer payments and refunds have no register of their own yet, so they stay as text.
 */
export function movementDocuments(m: Movement, can: Can = none): MovementLink[] {
  const docs: MovementLink[] = [];
  const register = (path: string, number: string) => `${path}?search=${encodeURIComponent(number)}`;
  if (m.payable)
    docs.push({
      label: 'Payable',
      text: m.payable.payableNumber,
      href: can('payables.view') ? register('/cash-desk/payables', m.payable.payableNumber) : null,
    });
  if (m.receivable)
    docs.push({
      label: 'Receivable',
      text: m.receivable.receivableNumber,
      href: can('receivables.view')
        ? register('/cash-desk/receivables', m.receivable.receivableNumber)
        : null,
    });
  if (m.expense)
    docs.push({
      label: 'Expense',
      text: m.expense.expenseNumber,
      href: can('expenses.view') ? register('/cash-desk/expenses', m.expense.expenseNumber) : null,
    });
  if (m.refund) docs.push({ label: 'Refund', text: m.refund.refundNumber, href: null });
  if (m.supplierPayment)
    docs.push({ label: 'Supplier payment', text: m.supplierPayment.paymentNumber, href: null });
  if (m.customerPayment)
    docs.push({ label: 'Customer payment', text: m.customerPayment.paymentNumber, href: null });
  if (m.invoicePayment)
    docs.push({
      label: 'Supplier invoice',
      text: m.invoicePayment.invoice.invoiceNumber,
      href: can('invoice_desk.view')
        ? `/invoice-desk?record=${encodeURIComponent(m.invoicePayment.invoiceId)}`
        : null,
    });
  if (m.salesPayment)
    docs.push({
      label: 'Sale',
      text: m.salesPayment.sale.saleNumber,
      href: can('sales_desk.view')
        ? `/sales-desk/sales/${encodeURIComponent(m.salesPayment.saleId)}`
        : null,
    });
  return docs;
}
