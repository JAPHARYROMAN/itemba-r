import { lineUnitPrice } from '../core/pos-price';
import type { CartLine, Customer, SaleResult, Session } from '../core/pos-types';

/**
 * One receipt, described once and drawn twice: as HTML for the browser's
 * print dialog (any printer the OS knows) and as ESC/POS bytes for a directly
 * connected thermal printer (POS_REMAKE_PLAN_2026-09-23.md section 6).
 * It carries charged prices only (owner decision D3) and never a cost.
 */
export type ReceiptLine = { name: string; quantity: number; unitPrice: number; total: number };

export type ReceiptModel = {
  company: string;
  branch: string;
  terminal: string;
  rep: string;
  orderNumber: string | null;
  /** Saved on the phone, not yet accepted by the office. */
  held: boolean;
  issuedAt: Date;
  lines: ReceiptLine[];
  total: number;
  paymentLabel: string;
  received: number | null;
  change: number | null;
  customer: string | null;
};

export function buildReceipt({
  session,
  cart,
  total,
  saleResult,
  held,
  paymentLabel,
  paymentMethod,
  receivedAmount,
  customer,
  issuedAt,
}: {
  session: Session;
  cart: CartLine[];
  total: number;
  saleResult: SaleResult | null;
  held: boolean;
  paymentLabel: string;
  paymentMethod: string;
  receivedAmount: number | null;
  customer: Customer | null;
  issuedAt: Date;
}): ReceiptModel {
  const grand = Number(saleResult?.totalAmount ?? total);
  const cash = paymentMethod === 'CASH' && receivedAmount !== null && receivedAmount >= grand;
  return {
    company: session.company.name,
    branch: session.branch.name,
    terminal: session.terminal.name,
    rep: session.rep.name,
    orderNumber: held ? null : (saleResult?.salesOrderNumber ?? null),
    held,
    issuedAt,
    lines: cart.map((line) => {
      const unitPrice = lineUnitPrice(line);
      return {
        name: line.product.name,
        quantity: line.quantity,
        unitPrice,
        total: unitPrice * line.quantity,
      };
    }),
    total: grand,
    paymentLabel,
    received: cash ? receivedAmount : null,
    change: cash && receivedAmount !== null ? receivedAmount - grand : null,
    customer: customer?.name ?? null,
  };
}

export function receiptAmount(value: number): string {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(value);
}

export function receiptTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}
