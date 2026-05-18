'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  Card,
  FormInput,
  FormSelect,
  Modal,
  PageHeader,
  PageSpinner,
  StatCard,
  StatusBadge,
} from '@/components/ui';
import { unwrapList } from '@/lib/unwrap';

interface Company {
  id: string;
  name: string;
  code?: string | null;
}

interface Loan {
  id: string;
  companyId?: string | null;
  loanReference?: string | null;
  lenderName: string;
  outstandingBalance?: number | string | null;
  currency?: string | null;
  status?: string | null;
}

interface CashAccount {
  id: string;
  companyId: string;
  accountName: string;
  accountType: string;
  currency?: string | null;
}

interface LoanSchedule {
  id: string;
  repaymentScheduleNumber: string;
  companyId: string;
  loanDebtId: string;
  installmentNumber: number;
  dueDate: string;
  principalAmount: number | string;
  interestAmount: number | string;
  feeAmount: number | string;
  totalAmount: number | string;
  paidAmount: number | string;
  outstandingAmount: number | string;
  status: string;
  journalEntryId?: string | null;
}

interface LoanPayment {
  id: string;
  repaymentPaymentNumber: string;
  paymentDate: string;
  amount: number | string;
  currency: string;
  paymentMethod: string;
  cashAccountId?: string | null;
  reference?: string | null;
  journalEntryId?: string | null;
}

const today = new Date().toISOString().slice(0, 10);
const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CHEQUE', 'OTHER'];

function optionLabel(row: { name: string; code?: string | null }) {
  return row.code ? `${row.code} - ${row.name}` : row.name;
}

function loanLabel(row: Loan) {
  return `${row.loanReference ? `${row.loanReference} - ` : ''}${row.lenderName}`;
}

function cashAccountLabel(row: CashAccount) {
  return `${row.accountName} (${row.accountType})`;
}

function fmtDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('en-GB') : '-';
}

function fmtMoney(value: number | string | null | undefined, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number.isFinite(Number(value ?? 0)) ? Number(value ?? 0) : 0)}`;
}

function errorMessage(json: any, fallback: string) {
  if (Array.isArray(json?.message)) return json.message.join(', ');
  return json?.message ?? json?.error ?? fallback;
}

export default function LoanRepaymentsPage() {
  const [rows, setRows] = useState<LoanSchedule[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [payments, setPayments] = useState<LoanPayment[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<LoanSchedule | null>(null);
  const [generating, setGenerating] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [generateForm, setGenerateForm] = useState({ companyId: '', loanId: '' });
  const [paymentForm, setPaymentForm] = useState({
    paymentDate: today,
    amount: '',
    currency: 'TZS',
    paymentMethod: 'BANK_TRANSFER',
    cashAccountId: '',
    reference: '',
  });

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => setCompanies(unwrapList<Company>(j)))
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    const id = generateForm.companyId || companyId;
    const loanParams = new URLSearchParams({ limit: '300' });
    const cashParams = new URLSearchParams({ isActive: 'true', limit: '200' });
    if (id) {
      loanParams.set('companyId', id);
      cashParams.set('companyId', id);
    }

    Promise.allSettled([
      fetch(`/api/backend/loans?${loanParams}`).then((r) => r.json()),
      id ? fetch(`/api/backend/cash-accounts?${cashParams}`).then((r) => r.json()) : Promise.resolve({ data: [] }),
    ]).then(([loanResult, cashResult]) => {
      setLoans(loanResult.status === 'fulfilled' ? unwrapList<Loan>(loanResult.value) : []);
      setCashAccounts(cashResult.status === 'fulfilled' ? unwrapList<CashAccount>(cashResult.value) : []);
    });
  }, [companyId, generateForm.companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (companyId) params.set('companyId', companyId);
      if (status) params.set('status', status);
      const json = await fetch(`/api/backend/loan-repayment-schedules?${params}`).then((r) => r.json());
      const list = unwrapList<LoanSchedule>(json);
      setRows(list);
      setSelected((current) => current ? list.find((row) => row.id === current.id) ?? current : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load loan repayment schedules');
    } finally {
      setLoading(false);
    }
  }, [companyId, status]);

  useEffect(() => {
    load();
  }, [load]);

  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const loanById = useMemo(() => new Map(loans.map((loan) => [loan.id, loan])), [loans]);
  const cashAccountById = useMemo(() => new Map(cashAccounts.map((account) => [account.id, account])), [cashAccounts]);
  const dueCount = rows.filter((row) => ['DUE', 'OVERDUE', 'PARTIALLY_PAID'].includes(row.status)).length;
  const paidCount = rows.filter((row) => row.status === 'PAID').length;
  const outstandingTotal = rows.reduce((sum, row) => sum + Number(row.outstandingAmount ?? 0), 0);

  const loadPayments = async (schedule: LoanSchedule) => {
    setSelected(schedule);
    setPaymentForm((current) => ({
      ...current,
      amount: String(schedule.outstandingAmount ?? ''),
      currency: loanById.get(schedule.loanDebtId)?.currency ?? current.currency,
      cashAccountId: '',
    }));
    try {
      const json = await fetch(`/api/backend/loan-repayment-schedules/${schedule.id}/payments`).then((r) => r.json());
      setPayments(unwrapList<LoanPayment>(json));
    } catch {
      setPayments([]);
    }
  };

  const openGenerate = () => {
    setGenerateForm({ companyId, loanId: '' });
    setGenerating(true);
  };

  const generateSchedule = async () => {
    if (!generateForm.loanId) {
      setError('Select a loan to generate its repayment schedule');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/backend/loan-repayment-schedules/generate/${generateForm.loanId}`, {
        method: 'POST',
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(json, 'Schedule generation failed'));
      setGenerating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Schedule generation failed');
    } finally {
      setSaving(false);
    }
  };

  const recordPayment = async () => {
    if (!selected || !paymentForm.amount || Number(paymentForm.amount) <= 0) {
      setError('Payment amount must be greater than zero');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/backend/loan-repayment-schedules/${selected.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentDate: paymentForm.paymentDate,
          amount: Number(paymentForm.amount),
          currency: paymentForm.currency || 'TZS',
          paymentMethod: paymentForm.paymentMethod,
          cashAccountId: paymentForm.cashAccountId || undefined,
          reference: paymentForm.reference || undefined,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(json, 'Payment failed'));
      setPaymentOpen(false);
      await load();
      await loadPayments(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setSaving(false);
    }
  };

  const filteredLoans = generateForm.companyId
    ? loans.filter((loan) => loan.companyId === generateForm.companyId)
    : loans;
  const selectedCompanyId = selected?.companyId ?? companyId;
  const availableCashAccounts = selectedCompanyId
    ? cashAccounts.filter((account) => account.companyId === selectedCompanyId)
    : cashAccounts;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Loan Repayment Schedules"
        subtitle="Generate amortization schedules, inspect installments, and record repayment postings"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Installments" value={rows.length} />
        <StatCard label="Due / Partial" value={dueCount} />
        <StatCard label="Paid" value={paidCount} />
        <StatCard label="Outstanding" value={fmtMoney(outstandingTotal)} />
      </div>

      <Card className="p-4">
        <div className="grid md:grid-cols-[1fr_180px_auto] gap-3 items-end">
          <FormSelect
            label="Company"
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              setSelected(null);
              setPayments([]);
            }}
            placeholder="All companies"
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>{optionLabel(company)}</option>
            ))}
          </FormSelect>
          <FormSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses">
            {['UPCOMING', 'DUE', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'].map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </FormSelect>
          <Btn onClick={openGenerate}>Generate Schedule</Btn>
        </div>
      </Card>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_460px] gap-5">
        <Card className="overflow-hidden">
          {loading ? (
            <PageSpinner />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                    <th className="px-4 py-3">Schedule</th>
                    <th className="px-4 py-3">Company</th>
                    <th className="px-4 py-3">Loan</th>
                    <th className="px-4 py-3">Due Date</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Outstanding</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                        No repayment schedules
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const loan = loanById.get(row.loanDebtId);
                      const currency = loan?.currency ?? 'TZS';
                      return (
                        <tr
                          key={row.id}
                          onClick={() => loadPayments(row)}
                          className="border-t cursor-pointer hover:bg-slate-50"
                          style={{ borderColor: 'var(--aurora-border)' }}
                        >
                          <td className="px-4 py-3">
                            <div className="font-mono text-xs">{row.repaymentScheduleNumber}</div>
                            <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>Installment {row.installmentNumber}</div>
                          </td>
                          <td className="px-4 py-3">{optionLabel(companyById.get(row.companyId) ?? { name: row.companyId })}</td>
                          <td className="px-4 py-3">{loan ? loanLabel(loan) : row.loanDebtId}</td>
                          <td className="px-4 py-3">{fmtDate(row.dueDate)}</td>
                          <td className="px-4 py-3 text-right font-mono">{fmtMoney(row.totalAmount, currency)}</td>
                          <td className="px-4 py-3 text-right font-mono">{fmtMoney(row.outstandingAmount, currency)}</td>
                          <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-4">
          {!selected ? (
            <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              Select an installment to see payment history and record a repayment.
            </div>
          ) : (
            <>
              <div>
                <div className="font-semibold">{selected.repaymentScheduleNumber}</div>
                <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                  {loanById.get(selected.loanDebtId) ? loanLabel(loanById.get(selected.loanDebtId) as Loan) : selected.loanDebtId}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <StatCard label="Principal" value={fmtMoney(selected.principalAmount, loanById.get(selected.loanDebtId)?.currency ?? 'TZS')} />
                <StatCard label="Interest" value={fmtMoney(selected.interestAmount, loanById.get(selected.loanDebtId)?.currency ?? 'TZS')} />
                <StatCard label="Paid" value={fmtMoney(selected.paidAmount, loanById.get(selected.loanDebtId)?.currency ?? 'TZS')} />
                <StatCard label="Outstanding" value={fmtMoney(selected.outstandingAmount, loanById.get(selected.loanDebtId)?.currency ?? 'TZS')} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Btn
                  size="sm"
                  variant="success"
                  disabled={selected.status === 'PAID' || selected.status === 'CANCELLED'}
                  onClick={() => setPaymentOpen(true)}
                >
                  Record Payment
                </Btn>
              </div>
              <div className="max-h-[340px] overflow-auto border rounded-lg" style={{ borderColor: 'var(--aurora-border)' }}>
                {payments.length === 0 ? (
                  <div className="p-4 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No payments recorded for this installment.</div>
                ) : (
                  payments.map((payment) => (
                    <div key={payment.id} className="border-b p-3 text-sm" style={{ borderColor: 'var(--aurora-border)' }}>
                      <div className="flex justify-between gap-3">
                        <div>
                          <div className="font-medium">{payment.repaymentPaymentNumber}</div>
                          <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                            {fmtDate(payment.paymentDate)} - {payment.paymentMethod}
                          </div>
                        </div>
                        <div className="text-right font-mono">{fmtMoney(payment.amount, payment.currency)}</div>
                      </div>
                      <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {payment.cashAccountId ? cashAccountLabel(cashAccountById.get(payment.cashAccountId) ?? { id: payment.cashAccountId, companyId: selected.companyId, accountName: payment.cashAccountId, accountType: 'Account' }) : 'No cash account selected'}
                        {payment.reference ? ` - ${payment.reference}` : ''}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      {generating && (
        <Modal
          open
          title="Generate Loan Repayment Schedule"
          onClose={() => setGenerating(false)}
          size="lg"
          footer={
            <>
              <Btn variant="secondary" onClick={() => setGenerating(false)}>Cancel</Btn>
              <Btn loading={saving} onClick={generateSchedule}>Generate</Btn>
            </>
          }
        >
          <div className="grid gap-3">
            <FormSelect
              label="Company"
              value={generateForm.companyId}
              onChange={(e) => setGenerateForm({ companyId: e.target.value, loanId: '' })}
              placeholder="All companies"
            >
              {companies.map((company) => <option key={company.id} value={company.id}>{optionLabel(company)}</option>)}
            </FormSelect>
            <FormSelect
              label="Loan"
              required
              value={generateForm.loanId}
              onChange={(e) => setGenerateForm((f) => ({ ...f, loanId: e.target.value }))}
              placeholder="Select loan"
            >
              {filteredLoans.map((loan) => (
                <option key={loan.id} value={loan.id}>
                  {loanLabel(loan)} - {fmtMoney(loan.outstandingBalance, loan.currency ?? 'TZS')}
                </option>
              ))}
            </FormSelect>
          </div>
        </Modal>
      )}

      {paymentOpen && selected && (
        <Modal
          open
          title="Record Loan Repayment"
          onClose={() => setPaymentOpen(false)}
          size="lg"
          footer={
            <>
              <Btn variant="secondary" onClick={() => setPaymentOpen(false)}>Cancel</Btn>
              <Btn loading={saving} onClick={recordPayment}>Record Payment</Btn>
            </>
          }
        >
          <div className="grid md:grid-cols-2 gap-3">
            <FormInput label="Payment Date" type="date" value={paymentForm.paymentDate} onChange={(e) => setPaymentForm((f) => ({ ...f, paymentDate: e.target.value }))} />
            <FormInput label="Amount" required type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))} />
            <FormSelect label="Payment Method" value={paymentForm.paymentMethod} onChange={(e) => setPaymentForm((f) => ({ ...f, paymentMethod: e.target.value }))}>
              {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
            </FormSelect>
            <FormInput label="Currency" value={paymentForm.currency} onChange={(e) => setPaymentForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} />
            <FormSelect label="Cash / Bank Account" value={paymentForm.cashAccountId} onChange={(e) => setPaymentForm((f) => ({ ...f, cashAccountId: e.target.value }))} placeholder="Optional account">
              {availableCashAccounts.map((account) => <option key={account.id} value={account.id}>{cashAccountLabel(account)}</option>)}
            </FormSelect>
            <FormInput label="Reference" value={paymentForm.reference} onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))} />
          </div>
        </Modal>
      )}
    </div>
  );
}
