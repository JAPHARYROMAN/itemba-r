'use client';
import { WorkspaceTable } from '@/components/ui/workspace-table';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { Btn, Card, FormDateField, FormInput, FormSelect, Modal } from '@/components/ui';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useAuth } from '@/hooks/use-auth';
import { backendPost } from '@/lib/api-client';
import { localToday, money } from '@/features/invoice-desk/types';

export type LoanLedger = {
  id: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  companyId: string;
  divisionId: string | null;
  branchId: string | null;
};
type Options = {
  cash: {
    id: string;
    name: string;
    currency: string;
    companyId: string;
    divisionId: string;
    branchId: string;
  }[];
  ledger: LoanLedger[];
};
export function useLoanOptions(companyId: string, enabled = true) {
  return useWorkspaceResource<Options>(
    '/loans/accounting-options',
    { companyId },
    enabled && !!companyId,
  );
}
export function LoanLedgerChoice({
  label,
  accounts,
  type,
  value,
  onChange,
  required = true,
}: {
  label: string;
  accounts: LoanLedger[];
  type: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <FormSelect
      label={label}
      value={value}
      required={required}
      onChange={(e) => onChange(e.target.value)}
      options={[
        { value: '', label: 'Choose ledger account' },
        ...accounts
          .filter((a) => a.accountType === type)
          .map((a) => ({ value: a.id, label: `${a.accountCode} · ${a.accountName}` })),
      ]}
    />
  );
}
export type FundingFields = {
  fundingMode: 'NEW' | 'OPENING';
  principalLedgerAccountId: string;
  cashDeskAccountId: string;
  openingOffsetAccountId: string;
  recognitionDate: string;
  fees: string;
  feeAccountId: string;
};
export const emptyFunding: FundingFields = {
  fundingMode: 'NEW',
  principalLedgerAccountId: '',
  cashDeskAccountId: '',
  openingOffsetAccountId: '',
  recognitionDate: '',
  fees: '0',
  feeAccountId: '',
};
export function LoanFundingFields({
  companyId,
  currency,
  value,
  onChange,
}: {
  companyId: string;
  currency: string;
  value: FundingFields;
  onChange: (value: FundingFields) => void;
}) {
  const options = useLoanOptions(companyId),
    set = (key: keyof FundingFields, v: string) => onChange({ ...value, [key]: v });
  return (
    <div className="col-span-2 space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">Connect this borrowing</h3>
      <FormSelect
        label="Loan entry"
        value={value.fundingMode}
        onChange={(e) =>
          onChange({ ...emptyFunding, fundingMode: e.target.value as FundingFields['fundingMode'] })
        }
        options={[
          { value: 'NEW', label: 'New borrowing — receive money now' },
          { value: 'OPENING', label: 'Opening loan — recognize existing principal' },
        ]}
      />
      <p className="text-sm text-slate-500">
        {value.fundingMode === 'NEW'
          ? 'Saving records the loan, net cash received and accounting together.'
          : 'Saving posts outstanding principal against the selected opening equity account. No cash is received. Confirm this liability is not already in your ledger.'}
      </p>
      {options.loading && <p role="status">Loading connected accounts…</p>}
      {options.error && <p role="alert">{options.error}</p>}
      <LoanLedgerChoice
        label="Loan principal payable"
        accounts={options.data?.ledger || []}
        type="LIABILITY"
        value={value.principalLedgerAccountId}
        onChange={(v) => set('principalLedgerAccountId', v)}
      />
      {value.fundingMode === 'NEW' ? (
        <>
          <FormSelect
            label="Receive into Cash Desk account"
            required
            value={value.cashDeskAccountId}
            onChange={(e) => set('cashDeskAccountId', e.target.value)}
            options={[
              { value: '', label: 'Choose connected account' },
              ...(options.data?.cash || [])
                .filter((a) => a.currency === currency)
                .map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
          <FormInput
            label="Fees withheld from proceeds"
            type="number"
            min="0"
            step="0.01"
            value={value.fees}
            onChange={(e) => set('fees', e.target.value)}
          />
          {Number(value.fees) > 0 && (
            <LoanLedgerChoice
              label="Loan fee expense account"
              accounts={options.data?.ledger || []}
              type="EXPENSE"
              value={value.feeAccountId}
              onChange={(v) => set('feeAccountId', v)}
            />
          )}
        </>
      ) : (
        <>
          <FormDateField
            label="Opening recognition date"
            required
            value={value.recognitionDate}
            onChange={(value) => set('recognitionDate', value)}
          />
          <LoanLedgerChoice
            label="Opening equity account"
            accounts={options.data?.ledger || []}
            type="EQUITY"
            value={value.openingOffsetAccountId}
            onChange={(v) => set('openingOffsetAccountId', v)}
          />
        </>
      )}
      <Link className="text-sm text-blue-600" href="/reports?view=accounting&tab=connections">
        Set up cash and ledger connections →
      </Link>
    </div>
  );
}
export type PaymentAccounts = {
  cashDeskAccountId: string;
  interestAccountId: string;
  feeAccountId: string;
};
export function LoanPaymentAccounts({
  companyId,
  currency,
  value,
  onChange,
}: {
  companyId: string;
  currency: string;
  value: PaymentAccounts;
  onChange: (value: PaymentAccounts) => void;
}) {
  const options = useLoanOptions(companyId),
    set = (key: keyof PaymentAccounts, v: string) => onChange({ ...value, [key]: v });
  return (
    <div className="space-y-3">
      {options.error && <p role="alert">{options.error}</p>}
      <FormSelect
        label="Pay from Cash Desk account"
        required
        value={value.cashDeskAccountId}
        onChange={(e) => set('cashDeskAccountId', e.target.value)}
        options={[
          { value: '', label: 'Choose connected account' },
          ...(options.data?.cash || [])
            .filter((a) => a.currency === currency)
            .map((a) => ({ value: a.id, label: a.name })),
        ]}
      />
      <LoanLedgerChoice
        label="Interest expense account"
        required={false}
        accounts={options.data?.ledger || []}
        type="EXPENSE"
        value={value.interestAccountId}
        onChange={(v) => set('interestAccountId', v)}
      />
      <LoanLedgerChoice
        label="Fees and penalties expense account"
        required={false}
        accounts={options.data?.ledger || []}
        type="EXPENSE"
        value={value.feeAccountId}
        onChange={(v) => set('feeAccountId', v)}
      />
      <p className="text-xs text-slate-500">
        Choose expense accounts when the payment includes those charges. Only principal reduces the
        loan balance.
      </p>
      <Link className="text-sm text-blue-600" href="/reports?view=accounting&tab=connections">
        Account connections →
      </Link>
    </div>
  );
}
export function LoanPaymentModal({
  loan,
  onClose,
  onSaved,
}: {
  loan: {
    id: string;
    company?: { id: string } | null;
    currency: string;
    outstandingBalance: string;
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
      amount: '',
      principal: '',
      interest: '0',
      fees: '0',
      penalties: '0',
      repaymentDate: localToday(),
      referenceNumber: '',
    }),
    [accounts, setAccounts] = useState<PaymentAccounts>({
      cashDeskAccountId: '',
      interestAccountId: '',
      feeAccountId: '',
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [ack, setAck] = useState(false);
  const request = useRef<string | null>(null),
    pending = useRef(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending.current || !ack) return;
    pending.current = true;
    setBusy(true);
    setError('');
    request.current ??= crypto.randomUUID();
    try {
      await backendPost(`/loans/${loan.id}/repayments`, {
        ...form,
        principal: form.principal || undefined,
        ...accounts,
        interestAccountId: accounts.interestAccountId || undefined,
        feeAccountId: accounts.feeAccountId || undefined,
        currency: loan.currency,
        requestId: request.current,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to record payment.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="Record loan payment"
      onClose={() => {
        if (!busy) onClose();
      }}
      size="lg"
    >
      <form className="space-y-4" onSubmit={submit}>
        <p className="text-sm">
          Outstanding principal: <strong>{money(loan.outstandingBalance, loan.currency)}</strong>.
          If this loan has installments, use its repayment schedule.
        </p>
        <Link className="text-sm text-blue-600" href="/accounting-engine/loan-repayments">
          Open repayment schedules →
        </Link>
        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          {(['amount', 'principal', 'interest', 'fees', 'penalties'] as const).map((key) => (
            <FormInput
              key={key}
              label={
                {
                  amount: 'Total paid',
                  principal: 'Principal (blank = remainder)',
                  interest: 'Interest',
                  fees: 'Fees',
                  penalties: 'Penalties',
                }[key]
              }
              type="number"
              step="0.01"
              min="0"
              required={key === 'amount'}
              value={form[key]}
              onChange={(e) => {
                setForm({ ...form, [key]: e.target.value });
                setAck(false);
              }}
            />
          ))}
          <FormDateField
            label="Payment date"
            required
            value={form.repaymentDate}
            onChange={(value) => setForm({ ...form, repaymentDate: value })}
          />
          <FormInput
            label="Payment reference"
            value={form.referenceNumber}
            onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })}
          />
        </div>
        <LoanPaymentAccounts
          companyId={loan.company?.id || ''}
          currency={loan.currency}
          value={accounts}
          onChange={(value) => {
            setAccounts(value);
            setAck(false);
          }}
        />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          This payment has not already been recorded. Save its allocation, cash movement and journal
          together.
        </label>
        <Btn type="submit" loading={busy} disabled={!ack || !accounts.cashDeskAccountId}>
          Record payment
        </Btn>
      </form>
    </Modal>
  );
}
type Event = {
  id: string;
  kind: string;
  businessDate: string;
  amount: string;
  principal: string;
  interest: string;
  fees: string;
  penalties: string;
  reversedAt: string | null;
  reversalOfId: string | null;
  cashMovementId: string | null;
  journalEntry: { id: string; journalNumber: string; status: string };
};
type Review = {
  loan: { outstandingBalance: string; currency: string };
  expectedPrincipal: string;
  agrees: boolean;
  issues: string[];
  events: Event[];
  schedules: { id: string }[];
};
export function LoanFinancialHistory({
  loanId,
  onChanged,
}: {
  loanId: string;
  onChanged: () => void;
}) {
  const { hasPermission } = useAuth(),
    allowed = hasPermission('journal_entries.view') && hasPermission('cash_desk.view');
  const resource = useWorkspaceResource<Review>(`/loans/${loanId}/financial`, {}, allowed);
  const [selected, setSelected] = useState<Event | null>(null),
    [reason, setReason] = useState(''),
    [date, setDate] = useState(localToday()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const request = useRef<string | null>(null),
    pending = useRef(false);
  async function reverse(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    request.current ??= crypto.randomUUID();
    try {
      await backendPost(`/loans/${loanId}/financial/${selected.id}/reverse`, {
        requestId: request.current,
        reason,
        businessDate: date,
      });
      setSelected(null);
      resource.reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reversal failed.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (!allowed)
    return <p>Journal and Cash Desk access are required to review the financial connection.</p>;
  return (
    <Card className="p-5 space-y-4">
      <h2 className="font-semibold text-lg">Loan, cash and accounting</h2>
      {resource.loading && <p role="status">Checking financial connections…</p>}
      {resource.error && <p role="alert">{resource.error}</p>}
      {resource.data && (
        <>
          <p className={resource.data.agrees ? 'text-emerald-700' : 'text-amber-700'}>
            {resource.data.agrees ? 'Linked records agree.' : 'These records need review.'}{' '}
            Principal from linked entries:{' '}
            <strong>{money(resource.data.expectedPrincipal, resource.data.loan.currency)}</strong>
          </p>
          {resource.data.issues.map((issue) => (
            <p className="text-sm text-amber-700" key={issue}>
              {issue}
            </p>
          ))}
          <Link className="text-sm text-blue-600" href="/accounting-engine/loan-repayments">
            {resource.data.schedules.length
              ? 'Manage repayment schedule'
              : 'Create repayment schedule'}{' '}
            →
          </Link>
          <div className="overflow-x-auto">
            <WorkspaceTable label="Loan financial history" className="w-full text-sm text-left">
              <thead>
                <tr>
                  {[
                    'Date / event',
                    'Cash / amount',
                    'Principal',
                    'Interest',
                    'Fees',
                    'Penalties',
                    'Journal',
                    '',
                  ].map((h) => (
                    <th className="p-2" key={h}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resource.data.events.map((e) => (
                  <tr className="border-t" key={e.id}>
                    <td className="p-2">
                      {e.businessDate.slice(0, 10)}
                      <br />
                      {e.kind.replaceAll('_', ' ')}
                      {e.reversedAt && <span> · Reversed</span>}
                    </td>
                    <td className="p-2">
                      {e.kind.includes('OPENING')
                        ? 'No cash movement'
                        : money(e.amount, resource.data!.loan.currency)}
                    </td>
                    {(['principal', 'interest', 'fees', 'penalties'] as const).map((k) => (
                      <td className="p-2" key={k}>
                        {money(e[k], resource.data!.loan.currency)}
                      </td>
                    ))}
                    <td className="p-2">
                      <Link className="text-blue-600" href="/finance/journal-entries">
                        {e.journalEntry.journalNumber}
                      </Link>
                      <br />
                      {e.journalEntry.status}
                    </td>
                    <td className="p-2">
                      {!e.reversedAt &&
                        !e.reversalOfId &&
                        hasPermission('loans.manage') &&
                        hasPermission('journal_entries.reverse') &&
                        hasPermission('journal_entries.create') &&
                        hasPermission('journal_entries.post') &&
                        hasPermission('cash_desk.record') && (
                          <Btn
                            variant="secondary"
                            onClick={() => {
                              setSelected(e);
                              setReason('');
                              setError('');
                              request.current = null;
                            }}
                          >
                            Reverse
                          </Btn>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </WorkspaceTable>
          </div>
        </>
      )}
      {selected && (
        <Modal
          open
          title="Reverse loan event"
          onClose={() => {
            if (!busy) setSelected(null);
          }}
        >
          <form className="space-y-4" onSubmit={reverse}>
            <p>
              This reverses the original journal and cash movement and restores the loan and
              installment balances. The original record stays visible.
            </p>
            {error && <p role="alert">{error}</p>}
            <FormDateField
              label="Reversal date"
              required
              value={date}
              onChange={(value) => setDate(value)}
            />
            <FormInput
              label="Reason"
              required
              minLength={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Btn type="submit" loading={busy}>
              Reverse event
            </Btn>
          </form>
        </Modal>
      )}
    </Card>
  );
}
