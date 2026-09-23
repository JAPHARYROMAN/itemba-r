'use client';
import { useRef, useState } from 'react';
import { Btn, FormDateField, FormInput, FormSelect, Modal } from '@/components/ui';
import { backendPost } from '@/lib/api-client';
import { money } from '@/features/invoice-desk/types';
import { useFormGuard } from '@/components/workspace/unsaved-work-provider';
export function LoanInstallmentModal({
  loans,
  onClose,
  onSaved,
}: {
  loans: {
    id: string;
    lenderName: string;
    loanReference?: string | null;
    currency?: string | null;
  }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    loanDebtId: '',
    installmentNumber: '1',
    dueDate: '',
    principalAmount: '',
    interestAmount: '0',
    feeAmount: '0',
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(false),
    reference = useRef<string | null>(null);
  const loan = loans.find((l) => l.id === form.loanDebtId);
  const draft = useFormGuard(form);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    reference.current ??= `LRS-${crypto.randomUUID()}`;
    try {
      await backendPost('/loan-repayment-schedules', {
        ...form,
        installmentNumber: Number(form.installmentNumber),
        repaymentScheduleNumber: reference.current,
      });
      draft.markSaved();
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to add installment.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onChangeCapture={draft.touch}
      title="Add loan installment"
      onClose={() => {
        if (!busy) draft.requestClose(onClose);
      }}
      size="lg"
    >
      <form className="space-y-4" onSubmit={submit}>
        <p className="text-sm text-slate-500">
          Enter the lender’s agreed amounts. Installments can be added before repayments start;
          recording a schedule does not move cash.
        </p>
        {error && <p role="alert">{error}</p>}
        <FormSelect
          label="Loan"
          required
          value={form.loanDebtId}
          onChange={(e) => setForm({ ...form, loanDebtId: e.target.value })}
          options={[
            { value: '', label: 'Choose loan' },
            ...loans.map((l) => ({ value: l.id, label: l.loanReference || l.lenderName })),
          ]}
        />
        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="Installment number"
            required
            type="number"
            min="1"
            step="1"
            value={form.installmentNumber}
            onChange={(e) => setForm({ ...form, installmentNumber: e.target.value })}
          />
          <FormDateField
            label="Due date"
            required
            value={form.dueDate}
            onChange={(value) => setForm({ ...form, dueDate: value })}
          />
          {(['principalAmount', 'interestAmount', 'feeAmount'] as const).map((k) => (
            <FormInput
              key={k}
              label={
                { principalAmount: 'Principal', interestAmount: 'Interest', feeAmount: 'Fees' }[k]
              }
              required
              type="number"
              min="0"
              step="0.01"
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            />
          ))}
        </div>
        <p className="text-sm">
          Installment total:{' '}
          <strong>
            {money(
              String(
                (Number(form.principalAmount) || 0) +
                  (Number(form.interestAmount) || 0) +
                  (Number(form.feeAmount) || 0),
              ),
              loan?.currency || 'TZS',
            )}
          </strong>
        </p>
        <Btn type="submit" loading={busy} disabled={!form.loanDebtId}>
          Add installment
        </Btn>
      </form>
    </Modal>
  );
}
