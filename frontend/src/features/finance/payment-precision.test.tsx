import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordPaymentModal as ReceivablePayment, type Receivable } from './screens/receivables';
import { RecordPaymentModal as PayablePayment, type Payable } from './screens/payables';
import { changeSelectField, getSelectField, selectFieldOptions } from '@/test/select-field';

const document = {
  id: 'document',
  companyId: 'company',
  amount: '979687.50',
  paidAmount: '979500.00',
  currency: 'TZS',
  issueDate: '2026-10-01',
  dueDate: '2026-10-30',
  status: 'PARTIALLY_PAID' as const,
  createdAt: '2026-10-01',
};
const accounts = [
  { id: 'cash', currency: 'TZS', accountName: 'TDM-01 Cash Account', isActive: true },
];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: accounts }) }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe.each(['receivables', 'payables'] as const)('%s fractional payment balance', (kind) => {
  it.each([187.5, '187.50', '187.99'])(
    'shows the exact outstanding %s, rejects 188, and submits the exact settlement unchanged',
    async (outstandingAmount) => {
      const onDone = vi.fn();
      const expectedAmount = Number(outstandingAmount);
      const expectedDisplay = expectedAmount.toFixed(2);
      render(
        kind === 'receivables' ? (
          <ReceivablePayment
            receivable={
              {
                ...document,
                receivableNumber: 'REC-2026-000180',
                customerName: 'Customer',
                outstandingAmount,
              } as Receivable
            }
            onClose={vi.fn()}
            onDone={onDone}
          />
        ) : (
          <PayablePayment
            payable={{ ...document, supplierName: 'Supplier', outstandingAmount } as Payable}
            onClose={vi.fn()}
            onDone={onDone}
          />
        ),
      );
      await waitFor(() =>
        expect(selectFieldOptions(getSelectField('Cash / Bank Account'))).toContain(
          'TDM-01 Cash Account · TZS',
        ),
      );
      expect(screen.getByText(`Outstanding: TZS ${expectedDisplay}`)).toBeInTheDocument();
      const amountInput = screen.getByRole('spinbutton', { name: /Amount/ });
      expect(amountInput).toHaveAttribute('max', String(expectedAmount));
      changeSelectField('Cash / Bank Account', 'cash');
      fireEvent.change(amountInput, { target: { value: '188' } });
      fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        `Amount cannot exceed outstanding balance TZS ${expectedDisplay}`,
      );
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/record-payment'))).toBe(
        false,
      );

      fireEvent.change(amountInput, { target: { value: expectedDisplay } });
      fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));
      await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
      const writes = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/record-payment'),
      );
      expect(writes).toHaveLength(1);
      expect(writes[0][0]).toBe(`/api/backend/${kind}/document/record-payment`);
      expect(JSON.parse((writes[0][1] as RequestInit).body as string)).toMatchObject({
        amount: expectedAmount,
        cashAccountId: 'cash',
        requestId: expect.any(String),
      });
    },
  );
});
