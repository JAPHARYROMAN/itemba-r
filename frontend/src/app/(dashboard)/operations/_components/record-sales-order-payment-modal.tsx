'use client';

import { useEffect, useMemo, useState } from 'react';
import { Btn, FormInput, FormSelect, FormTextarea, Modal, showToast } from '@/components/ui';
import { backendList, backendPatch } from '@/lib/api-client';
import { ACCOUNT_TYPE_LABELS } from '@/lib/sales-order-constants';

interface CashAccount {
  id: string;
  accountName: string;
  accountType: string;
  currency?: string | null;
  branchId?: string | null;
  divisionId?: string | null;
  linkedBank?: {
    bankName?: string | null;
    accountName?: string | null;
    accountNumber?: string | null;
  } | null;
}

function money(value: unknown, currency = 'TZS') {
  const amount = Number(value ?? 0);
  return `${currency} ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0)}`;
}

function accountOptionLabel(account: CashAccount) {
  const typeLabel = ACCOUNT_TYPE_LABELS[account.accountType] ?? account.accountType;
  const bankName =
    account.accountType === 'BANK' &&
    account.linkedBank?.bankName &&
    !account.accountName.toLowerCase().includes(account.linkedBank.bankName.toLowerCase())
      ? ` - ${account.linkedBank.bankName}`
      : '';
  const currency = account.currency ? ` - ${account.currency}` : '';
  return `${account.accountName}${bankName} (${typeLabel}${currency})`;
}

function localDateString() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 10);
}

export function RecordSalesOrderPaymentModal({
  receivableId,
  companyId,
  divisionId,
  branchId,
  currency,
  outstanding,
  orderLabel,
  onClose,
  onSaved,
}: {
  receivableId: string;
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  currency: string;
  outstanding: number;
  orderLabel?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(localDateString());
  const [cashAccountId, setCashAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!companyId) {
      setAccounts([]);
      setCashAccountId('');
      return;
    }
    let cancelled = false;
    setAccountsLoading(true);
    setError('');
    backendList<CashAccount>('/sales-orders/receipt-accounts', {
      query: {
        companyId,
        divisionId: divisionId || undefined,
        branchId: branchId || undefined,
        limit: 500,
      },
    })
      .then((rows) => {
        if (cancelled) return;
        setAccounts(rows);
        setCashAccountId((current) =>
          current && rows.some((account) => account.id === current) ? current : rows[0]?.id ?? '',
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setAccounts([]);
        setCashAccountId('');
        setError(err instanceof Error ? err.message : 'Could not load receipt accounts');
      })
      .finally(() => {
        if (!cancelled) setAccountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId, companyId, divisionId]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === cashAccountId) ?? null,
    [accounts, cashAccountId],
  );

  const submit = async () => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Enter a valid payment amount');
      return;
    }
    if (numericAmount > outstanding + 0.005) {
      setError(`Amount exceeds outstanding balance of ${money(outstanding, currency)}`);
      return;
    }
    if (!cashAccountId) {
      setError('Select the cash, bank, or mobile-money account that received this payment');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await backendPatch(`/receivables/${receivableId}/record-payment`, {
        amount: numericAmount,
        paymentDate,
        cashAccountId,
        notes: notes.trim() || undefined,
      });
      const newOutstanding = Math.max(0, outstanding - numericAmount);
      showToast(
        'success',
        newOutstanding > 0 ? 'Partial payment recorded' : 'Sales order fully paid',
        `${money(numericAmount, currency)} received${
          selectedAccount ? ` in ${selectedAccount.accountName}` : ''
        }. Balance: ${money(newOutstanding, currency)}`,
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Record Sales Order Payment"
      subtitle={[
        orderLabel || null,
        `Outstanding: ${money(outstanding, currency)}`,
      ]
        .filter(Boolean)
        .join(' - ')}
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" loading={saving} onClick={submit}>
            Record Payment
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}
      <div className="space-y-3">
        <FormInput
          label="Amount Received"
          required
          type="number"
          min="0.01"
          step="0.01"
          max={outstanding}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="Enter partial or full amount"
        />
        <div className="flex items-center justify-between gap-3 text-xs">
          <span style={{ color: 'var(--aurora-text-muted)' }}>
            Outstanding balance: {money(outstanding, currency)}
          </span>
          <button
            type="button"
            className="font-medium text-blue-500 hover:text-blue-400"
            onClick={() => setAmount(String(outstanding || ''))}
          >
            Use full balance
          </button>
        </div>
        <FormSelect
          label="Receipt Account"
          required
          value={cashAccountId}
          onChange={(event) => setCashAccountId(event.target.value)}
          disabled={accountsLoading}
          placeholder={accountsLoading ? 'Loading accounts' : 'Select account'}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {accountOptionLabel(account)}
            </option>
          ))}
        </FormSelect>
        {!accountsLoading && accounts.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            No active receipt account is available for this branch. Create or activate one under
            Finance &gt; Cash Accounts.
          </p>
        )}
        <FormInput
          label="Payment Date"
          type="date"
          value={paymentDate}
          onChange={(event) => setPaymentDate(event.target.value)}
        />
        <FormTextarea
          label="Notes"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Receipt number, mobile-money reference, or remarks"
        />
      </div>
    </Modal>
  );
}
