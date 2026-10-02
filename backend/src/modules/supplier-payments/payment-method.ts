import { PaymentMethodGeneral } from '@prisma/client';

/**
 * Maps the free-text payment method strings used by Invoice Desk ("Bank transfer",
 * "Mobile money", ...) and Expenses onto the shared PaymentMethodGeneral enum.
 * Unknown text becomes OTHER; an empty value stays undefined (schema default CASH).
 */
export function toPaymentMethodGeneral(
  method: string | null | undefined,
): PaymentMethodGeneral | undefined {
  const value = method?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === 'cash') return PaymentMethodGeneral.CASH;
  if (value.includes('mobile') || value.includes('mpesa') || value.includes('m-pesa'))
    return PaymentMethodGeneral.MOBILE_MONEY;
  if (value.includes('bank') && value.includes('card')) return PaymentMethodGeneral.BANK_CARD;
  if (value === 'card' || value.includes('card')) return PaymentMethodGeneral.BANK_CARD;
  if (value.includes('bank') || value.includes('transfer') || value.includes('eft'))
    return PaymentMethodGeneral.BANK_TRANSFER;
  if (value.includes('cheque') || value.includes('check')) return PaymentMethodGeneral.CHEQUE;
  return PaymentMethodGeneral.OTHER;
}
