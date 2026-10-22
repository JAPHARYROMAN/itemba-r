import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountTransactions, type AccountDocument } from './account-transactions';
import { changeSelectField, getSelectField, selectFieldOptions } from '@/test/select-field';

const { get, post, patch, hasPermission, saved } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  hasPermission: vi.fn(),
  saved: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: get, backendPost: post, backendPatch: patch }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ hasPermission }) }));
vi.mock('@/components/workspace/linked-desk-changes', () => ({ notifyDeskSaved: saved }));

const record: AccountDocument = {
  id: 'document',
  companyId: 'company',
  currency: 'USD',
  amount: '100.00',
  outstandingAmount: '40.00',
  status: 'PARTIALLY_PAID',
  sourceType: 'PurchaseOrder',
};
const offset = {
  id: 'offset',
  companyId: 'company',
  accountCode: '5000',
  accountName: 'Balance corrections',
  accountType: 'EXPENSE',
  isActive: true,
};
const payment = {
  id: 'payment',
  kind: 'SUPPLIER_PAYMENT',
  paymentNumber: 'SP-1',
  paymentDate: '2026-10-15T00:00:00.000Z',
  amount: '60.00',
  allocatedAmount: '60.00',
  currency: 'USD',
  status: 'POSTED',
  cashAccountId: 'bank',
  cashAccountName: 'USD Bank',
  canReverse: true,
  canCorrect: true,
  reversalEndpoint: '/supplier-payments/payment/reverse',
  reversalUnavailableReason: null,
  reversalReason: null as string | null,
  allocations: [{ documentId: 'document', documentNumber: 'AP-1', amount: '60.00' }],
};
const adjustment = {
  id: 'adjustment',
  direction: 'DECREASE',
  amount: '10.00',
  currency: 'USD',
  reason: 'Agreed correction',
  transactionDate: '2026-10-18',
  status: 'POSTED',
  reversalReason: null as string | null,
};

let current: AccountDocument;
let payments: (typeof payment)[];
let adjustments: (typeof adjustment)[];
beforeEach(() => {
  vi.clearAllMocks();
  current = { ...record };
  payments = [{ ...payment }];
  adjustments = [];
  hasPermission.mockReturnValue(true);
  get.mockImplementation(async (path: string) => {
    if (path.endsWith('/offset-accounts'))
      return {
        data: [
          offset,
          {
            ...offset,
            id: 'other-company',
            companyId: 'other',
            accountName: 'Other company account',
          },
        ],
      };
    if (path.endsWith('/adjustments')) return { data: adjustments };
    if (path.endsWith('/payments')) return { data: payments };
    return current;
  });
  post.mockResolvedValue({});
  patch.mockResolvedValue({});
});

function open(
  mode: 'history' | 'adjust' = 'history',
  kind: 'receivables' | 'payables' = 'payables',
) {
  const onChanged = vi.fn();
  const onReplace = vi.fn();
  render(
    <AccountTransactions
      kind={kind}
      document={current}
      initialMode={mode}
      onClose={vi.fn()}
      onChanged={onChanged}
      onReplace={onReplace}
    />,
  );
  return { onChanged, onReplace };
}

async function adjustmentFields(amount = '10') {
  await waitFor(() =>
    expect(selectFieldOptions(getSelectField('Offset account'))).toContain(
      '5000 · Balance corrections · EXPENSE',
    ),
  );
  fireEvent.change(screen.getByRole('spinbutton', { name: /Adjustment amount/ }), {
    target: { value: amount },
  });
  changeSelectField('Offset account', 'offset');
  fireEvent.change(screen.getByRole('textbox', { name: /Adjustment reason/ }), {
    target: { value: 'Correct the agreed account balance' },
  });
}

describe('AccountTransactions', () => {
  it('shows persisted reversal reasons without substituting or changing original payment notes', async () => {
    payments = [
      {
        ...payment,
        status: 'REVERSED',
        canReverse: false,
        canCorrect: false,
        reversalReason: 'The payment used the wrong bank account',
      },
    ];
    adjustments = [
      {
        ...adjustment,
        status: 'REVERSED',
        reversalReason: 'The original correction was incorrect',
      },
    ];
    open();
    expect(
      await screen.findByText('Reversal reason: The payment used the wrong bank account'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Reversal reason: The original correction was incorrect'),
    ).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });
  it('shows paid-document and legacy history to viewers without granting write actions', async () => {
    current = { ...record, status: 'PAID', outstandingAmount: 0 };
    hasPermission.mockImplementation((permission: string) => permission === 'payables.view');
    payments = [
      {
        ...payment,
        kind: 'LEGACY_JOURNAL',
        canReverse: false,
        canCorrect: false,
        reversalEndpoint: null,
        reversalUnavailableReason:
          'Use the original Cash Desk transaction to reverse this payment.',
      },
    ];
    open();
    expect(await screen.findByText('SP-1')).toBeInTheDocument();
    expect(screen.getByText(/Use the original Cash Desk/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /balance adjustment|Reverse |Correct / }),
    ).not.toBeInTheDocument();
    expect(get.mock.calls.some(([path]) => String(path).includes('offset-accounts'))).toBe(false);
  });

  it.each(['Expense', 'AccountAdjustment'])(
    'keeps %s history accessible while disabling a new adjustment',
    async (sourceType) => {
      current = { ...record, sourceType };
      open('adjust');
      await screen.findByText('SP-1');
      expect(screen.getByRole('button', { name: 'New balance adjustment' })).toBeDisabled();
      expect(
        screen.queryByRole('spinbutton', { name: /Adjustment amount/ }),
      ).not.toBeInTheDocument();
      expect(get.mock.calls.some(([path]) => String(path).includes('offset-accounts'))).toBe(false);
    },
  );

  it('does not request financial data without document-view permission', () => {
    hasPermission.mockReturnValue(false);
    open();
    expect(screen.getByText('Access restricted.')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('does not load adjustment accounts when manage permission lacks document-view permission', () => {
    hasPermission.mockImplementation((permission: string) => permission === 'payables.manage');
    open('adjust');
    expect(screen.getByText('Access restricted.')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('uses document-manage permission and the exact document-scoped route for a traceable legacy reversal', async () => {
    hasPermission.mockImplementation((permission: string) =>
      ['payables.view', 'payables.manage'].includes(permission),
    );
    payments = [
      {
        ...payment,
        kind: 'LEGACY_JOURNAL',
        canCorrect: false,
        reversalEndpoint: '/payables/document/payments/payment/reverse',
      },
    ];
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Reverse SP-1' }));
    expect(screen.queryByRole('button', { name: 'Correct SP-1' })).not.toBeInTheDocument();
    expect(screen.getByText(/After reversal, close this history and use Pay/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /Reversal reason/ }), {
      target: { value: 'Correct a historical cash posting' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reversal' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/payables/document/payments/payment/reverse', {
        reason: 'Correct a historical cash posting',
      }),
    );
  });

  it('requires canonical payment-manage permission before reversing a canonical payment', async () => {
    hasPermission.mockImplementation((permission: string) =>
      ['payables.view', 'payables.manage'].includes(permission),
    );
    open();
    await screen.findByText('SP-1');
    expect(screen.queryByRole('button', { name: 'Reverse SP-1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Correct SP-1' })).not.toBeInTheDocument();
  });

  it('posts a non-cash adjustment once, preserves its request ID on retry, and refreshes history', async () => {
    let release!: () => void;
    post.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          release = () => reject(new Error('Temporary failure'));
        }),
    );
    const { onChanged } = open('adjust');
    await adjustmentFields();
    expect(selectFieldOptions(getSelectField('Offset account'))).not.toContainEqual(
      expect.stringMatching(/Other company/),
    );
    expect(screen.getByLabelText('Adjustment impact')).toHaveTextContent(
      'Before: USD 40.00. After: USD 30.00.',
    );
    const submit = screen.getByRole('button', { name: 'Post balance adjustment' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => release());
    expect(await screen.findByText(/Temporary failure/)).toBeInTheDocument();
    const first = post.mock.calls[0][1];
    expect(first).toMatchObject({
      amount: 10,
      direction: 'DECREASE',
      offsetAccountId: 'offset',
      reason: 'Correct the agreed account balance',
      requestId: expect.any(String),
    });
    expect(first).not.toHaveProperty('cashAccountId');
    expect(first).not.toHaveProperty('paymentDate');
    current = { ...record, outstandingAmount: '30.00' };
    adjustments = [adjustment];
    fireEvent.click(submit);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[1][1].requestId).toBe(first.requestId);
    expect(await screen.findByText(/Agreed correction/)).toBeInTheDocument();
    expect(saved).toHaveBeenCalledWith('cash-desk');
    expect(screen.getByText(/No cash was moved/)).toBeInTheDocument();
  });

  it('permits an increase on a paid receivable and describes the separate new item', async () => {
    current = { ...record, status: 'PAID', outstandingAmount: 0 };
    open('adjust', 'receivables');
    await adjustmentFields('25.10');
    changeSelectField('Adjustment direction', 'INCREASE');
    expect(screen.getByLabelText('Adjustment impact')).toHaveTextContent(
      'After including the separate new item: USD 25.10.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Post balance adjustment' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/receivables/document/adjustments',
        expect.objectContaining({ amount: 25.1, direction: 'INCREASE' }),
      ),
    );
  });

  it('blocks a decrease above outstanding but lets the operator correct the form', async () => {
    open('adjust');
    await adjustmentFields('50');
    fireEvent.click(screen.getByRole('button', { name: 'Post balance adjustment' }));
    expect(await screen.findByText(/A decrease cannot exceed/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('spinbutton', { name: /Adjustment amount/ }), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Post balance adjustment' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });

  it('does not submit a new adjustment when the authoritative document cannot be loaded', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === '/payables/document') throw new Error('Document unavailable');
      if (path.endsWith('/offset-accounts')) return { data: [offset] };
      return { data: [] };
    });
    open('adjust');
    await screen.findByText(/Document unavailable/);
    expect(screen.getByRole('button', { name: 'Post balance adjustment' })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('requires a reason to reverse an adjustment and refreshes its retained history', async () => {
    adjustments = [adjustment];
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Reverse adjustment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reversal' }));
    expect(patch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: /Reversal reason/ }), {
      target: { value: 'Wrong original balance correction' },
    });
    adjustments = [{ ...adjustment, status: 'REVERSED' }];
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reversal' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/payables/document/adjustments/adjustment/reverse', {
        reason: 'Wrong original balance correction',
        transactionDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
    expect(await screen.findByText('REVERSED')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse adjustment' })).not.toBeInTheDocument();
  });

  it('reverses a payment once, then opens an explicitly submitted replacement with refreshed balance', async () => {
    const { onReplace, onChanged } = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Correct SP-1' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Reversal reason/ }), {
      target: { value: 'Correct the bank account used' },
    });
    current = { ...record, outstandingAmount: 100, status: 'OPEN' };
    payments = [{ ...payment, status: 'REVERSED', canReverse: false, canCorrect: false }];
    const submit = screen.getByRole('button', { name: 'Reverse and review replacement' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() =>
      expect(onReplace).toHaveBeenCalledWith(
        expect.objectContaining({
          originalPaymentId: 'payment',
          originalPaymentNumber: 'SP-1',
          amount: '60.00',
          paymentDate: '2026-10-15',
          cashAccountId: 'bank',
        }),
        current,
      ),
    );
    expect(patch).toHaveBeenCalledExactlyOnceWith('/supplier-payments/payment/reverse', {
      reason: 'Correct the bank account used',
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('leaves a failed payment reversal available for retry without starting a replacement', async () => {
    patch.mockRejectedValueOnce(new Error('The payment could not be reversed'));
    const { onReplace } = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Correct SP-1' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Reversal reason/ }), {
      target: { value: 'Correct the date used' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reverse and review replacement' }));
    expect(await screen.findByText('The payment could not be reversed')).toBeInTheDocument();
    expect(onReplace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Reverse and review replacement' })).toBeEnabled();
  });

  it('waits for the balance after successful reversal when refresh fails, without repeating the reversal', async () => {
    let reversed = false;
    let recordFailure = true;
    patch.mockImplementation(async () => {
      reversed = true;
    });
    get.mockImplementation(async (path: string) => {
      if (path.endsWith('/adjustments')) return { data: [] };
      if (path.endsWith('/payments'))
        return {
          data: reversed
            ? [{ ...payment, status: 'REVERSED', canReverse: false, canCorrect: false }]
            : [payment],
        };
      if (reversed && recordFailure) throw new Error('Balance refresh failed');
      return current;
    });
    const { onReplace } = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Correct SP-1' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Reversal reason/ }), {
      target: { value: 'Correct the amount collected' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reverse and review replacement' }));
    const resume = await screen.findByRole('button', { name: 'Continue replacement' });
    expect(onReplace).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Correct SP-1' })).not.toBeInTheDocument();
    current = { ...record, outstandingAmount: 100 };
    recordFailure = false;
    fireEvent.click(resume);
    await waitFor(() => expect(onReplace).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('shows every allocation before reversing a multi-document payment and does not offer local replacement', async () => {
    payments = [
      {
        ...payment,
        amount: 100,
        canCorrect: false,
        allocations: [
          ...payment.allocations,
          { documentId: 'other-document', documentNumber: 'AP-2', amount: 40 },
        ],
      },
    ];
    open();
    expect(
      await screen.findByText(/Replacement requires the payment allocation workflow/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Correct SP-1' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reverse SP-1' }));
    const confirmation = screen.getByRole('region', { name: 'Transaction reversal' });
    expect(
      within(confirmation).getByText(/entire payment SP-1 \(USD 100.00\)/),
    ).toBeInTheDocument();
    expect(within(confirmation).getByText('AP-2: USD 40.00')).toBeInTheDocument();
  });
});
