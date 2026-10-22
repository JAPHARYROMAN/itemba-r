import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordPaymentModal as ReceivablePayment, type Receivable } from './screens/receivables';
import { RecordPaymentModal as PayablePayment, type Payable } from './screens/payables';
import {
  changeSelectField,
  getSelectField,
  selectFieldOptions,
  selectFieldValue,
} from '@/test/select-field';
import { dateFieldValue, getDateField } from '@/test/date-field';
import { localToday } from '@/features/invoice-desk/types';

const document = {
  id: 'document',
  companyId: 'company',
  amount: 100,
  outstandingAmount: 100,
  currency: 'USD',
  issueDate: '2026-10-01',
  dueDate: '2026-10-30',
  status: 'OPEN' as const,
  createdAt: '2026-10-01',
};
const replacement = {
  originalPaymentId: 'original',
  originalPaymentNumber: 'PAY-1',
  amount: '60.00',
  cashAccountId: 'bank',
  paymentDate: '2026-10-15',
  notes: 'Replacement for reversed payment PAY-1.',
};
const accounts = [{ id: 'bank', currency: 'USD', accountName: 'USD Bank', isActive: true }];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: accounts }) }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe.each(['receivables', 'payables'] as const)('%s replacement payment', (kind) => {
  const open = (onDone = vi.fn(), correcting = true) =>
    render(
      kind === 'receivables' ? (
        <ReceivablePayment
          receivable={{ ...document, customerName: 'Customer' } as Receivable}
          replacement={correcting ? replacement : undefined}
          onClose={vi.fn()}
          onDone={onDone}
        />
      ) : (
        <PayablePayment
          payable={{ ...document, supplierName: 'Supplier' } as Payable}
          replacement={correcting ? replacement : undefined}
          onClose={vi.fn()}
          onDone={onDone}
        />
      ),
    );

  it('submits an ordinary payment with a stable default financial date and request ID without a manual date edit', async () => {
    const onDone = vi.fn();
    const expectedDate = localToday();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!url.includes('/record-payment'))
        return { ok: true, json: async () => ({ data: accounts }) };
      const body = JSON.parse(init!.body as string);
      if (!body.paymentDate || !body.requestId)
        return {
          ok: false,
          json: async () => ({ message: 'An idempotent payment requires a payment date' }),
        };
      return { ok: true, json: async () => ({ data: {} }) };
    });
    open(onDone, false);
    await waitFor(() =>
      expect(selectFieldOptions(getSelectField('Cash / Bank Account'))).toContain('USD Bank · USD'),
    );
    expect(dateFieldValue(getDateField('Payment Date'))).toBe(expectedDate);
    fireEvent.change(screen.getByRole('spinbutton', { name: /Amount/ }), {
      target: { value: '25' },
    });
    changeSelectField('Cash / Bank Account', 'bank');
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const write = fetchMock.mock.calls.find(([url]) => String(url).includes('/record-payment'));
    expect(JSON.parse((write![1] as RequestInit).body as string)).toMatchObject({
      paymentDate: expectedDate,
      amount: 25,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('prefills the reversed allocation but requires explicit confirmation before creating a new payment', async () => {
    const onDone = vi.fn();
    open(onDone);
    await waitFor(() =>
      expect(selectFieldOptions(getSelectField('Cash / Bank Account'))).toContain('USD Bank · USD'),
    );
    expect(screen.getByRole('spinbutton', { name: /Amount/ })).toHaveValue(60);
    expect(selectFieldValue(getSelectField('Cash / Bank Account'))).toBe('bank');
    expect(dateFieldValue(getDateField('Payment Date'))).toBe('2026-10-15');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/record-payment'))).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Record Replacement Payment' }));
    expect(await screen.findByText(/Confirm the replacement amount, date/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm the replacement/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Record Replacement Payment' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const write = fetchMock.mock.calls.find(([url]) => String(url).includes('/record-payment'));
    expect(write?.[0]).toBe(`/api/backend/${kind}/document/record-payment`);
    expect(JSON.parse((write![1] as RequestInit).body as string)).toMatchObject({
      amount: 60,
      cashAccountId: 'bank',
      paymentDate: '2026-10-15',
      requestId: expect.any(String),
    });
  });

  it('blocks replacement if the active cash account cannot be loaded', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'Unavailable' }) });
    open();
    await screen.findByText(/Could not load accounts. Retry/);
    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm the replacement/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Record Replacement Payment' }));
    expect(await screen.findByText(/Confirm the replacement date and select/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/record-payment'))).toBe(
      false,
    );
  });

  it('guards repeated submission and retries a failed request with the same request ID', async () => {
    let fail!: () => void;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/record-payment'))
        return new Promise((_resolve, reject) => {
          fail = () => reject(new Error('Connection lost'));
        });
      return { ok: true, json: async () => ({ data: accounts }) };
    });
    open();
    await waitFor(() =>
      expect(selectFieldOptions(getSelectField('Cash / Bank Account'))).toContain('USD Bank · USD'),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm the replacement/ }));
    const submit = screen.getByRole('button', { name: 'Record Replacement Payment' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    let writes = fetchMock.mock.calls.filter(([url]) => String(url).includes('/record-payment'));
    expect(writes).toHaveLength(1);
    const firstId = JSON.parse((writes[0][1] as RequestInit).body as string).requestId;
    await act(async () => fail());
    await screen.findByText('Connection lost');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: {} }) });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).includes('/record-payment')),
      ).toHaveLength(2),
    );
    writes = fetchMock.mock.calls.filter(([url]) => String(url).includes('/record-payment'));
    expect(JSON.parse((writes[1][1] as RequestInit).body as string).requestId).toBe(firstId);
  });
});
