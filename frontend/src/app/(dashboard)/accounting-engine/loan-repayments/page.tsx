'use client';
import '@/components/workspace/workspace.css';
import { WorkspaceSplit } from '@/components/workspace/workspace-split';

import { WorkspaceTable } from '@/components/ui/workspace-table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Btn, Card, ErrorState, FormDateField, FormInput, FormSelect, Modal, PageHeader, PageSpinner, PageToolbar, showToast, StatCard, StatusBadge } from '@/components/ui';
import { LoanInstallmentModal } from '@/features/loans/loan-installment-modal';
import { LoanPaymentAccounts, type PaymentAccounts } from '@/features/loans/loan-finance';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
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
  financialEvent?: {
    principal: string;
    interest: string;
    fees: string;
    reversedAt: string | null;
  } | null;
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
  const { hasPermission, loading: authLoading } = useAuth();
  const canView = hasPermission('accounting_engine.dashboard');
  const beginRequest = useRequestGuard();
  const [rows, setRows] = useState<LoanSchedule[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccounts>({
    cashDeskAccountId: '',
    interestAccountId: '',
    feeAccountId: '',
  });
  const paymentRequests = useRef(new Map<string, string>()),
    paymentPending = useRef(false);
  const [paymentAck, setPaymentAck] = useState(false);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<LoanSchedule | null>(null);
  const paymentHistory = useWorkspaceResource<LoanPayment[]>(
    `/loan-repayment-schedules/${selected?.id ?? ''}/payments`,
    {},
    !!selected,
  );
  const payments = unwrapList<LoanPayment>(paymentHistory.data);
  const [generating, setGenerating] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
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

  const preview = useWorkspaceResource<{
    amount: string;
    principal: string;
    interest: string;
    fees: string;
    currency: string;
    allocationFingerprint: string;
  }>(
    `/loan-repayment-schedules/${selected?.id || ''}/payment-preview`,
    { amount: paymentForm.amount },
    paymentOpen && !!selected && Number(paymentForm.amount) > 0,
  );

  useEffect(() => {
    if (authLoading || !canView) return;
    const controller = new AbortController();
    fetch('/api/backend/companies?limit=100', { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => {
        if (!controller.signal.aborted) setCompanies(unwrapList<Company>(j));
      })
      .catch(() => {
        if (!controller.signal.aborted) setCompanies([]);
      });
    return () => controller.abort();
  }, [authLoading, canView]);

  useEffect(() => {
    if (authLoading || !canView) return;
    const controller = new AbortController();
    const id = generateForm.companyId || companyId;
    const loanParams = new URLSearchParams({ limit: '200' });
    const cashParams = new URLSearchParams({ isActive: 'true', limit: '200' });
    if (id) {
      loanParams.set('companyId', id);
      cashParams.set('companyId', id);
    }

    Promise.allSettled([
      fetch(`/api/backend/loans?${loanParams}`, { signal: controller.signal }).then((r) => r.json()),
      id
        ? fetch(`/api/backend/cash-accounts?${cashParams}`, { signal: controller.signal }).then((r) =>
            r.json(),
          )
        : Promise.resolve({ data: [] }),
    ]).then(([loanResult, cashResult]) => {
      if (controller.signal.aborted) return;
      setLoans(loanResult.status === 'fulfilled' ? unwrapList<Loan>(loanResult.value) : []);
      setCashAccounts(
        cashResult.status === 'fulfilled' ? unwrapList<CashAccount>(cashResult.value) : [],
      );
    });
    return () => controller.abort();
  }, [authLoading, canView, companyId, generateForm.companyId]);

  const load = useCallback(async () => {
    if (authLoading || !canView) return;
    const request = beginRequest();
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (companyId) params.set('companyId', companyId);
      if (status) params.set('status', status);
      const response = await fetch(`/api/backend/loan-repayment-schedules?${params}`, {
        signal: request.signal,
      });
      if (!request.current()) return;
      const json = await response.json();
      if (!request.current()) return;
      if (!response.ok) throw new Error(errorMessage(json, 'Unable to load repayment schedules'));
      const list = unwrapList<LoanSchedule>(json);
      setRows(list);
      setSelected((current) =>
        current ? (list.find((row) => row.id === current.id) ?? null) : null,
      );
    } catch (err) {
      if (!request.current()) return;
      setRows([]);
      setSelected(null);
      setLoadError(err instanceof Error ? err.message : 'Failed to load loan repayment schedules');
    } finally {
      if (request.current()) setLoading(false);
    }
  }, [authLoading, beginRequest, canView, companyId, status]);

  useEffect(() => {
    load();
  }, [load]);

  const companyById = useMemo(
    () => new Map(companies.map((company) => [company.id, company])),
    [companies],
  );
  const loanById = useMemo(() => new Map(loans.map((loan) => [loan.id, loan])), [loans]);
  const cashAccountById = useMemo(
    () => new Map(cashAccounts.map((account) => [account.id, account])),
    [cashAccounts],
  );
  const dueCount = rows.filter((row) =>
    ['DUE', 'OVERDUE', 'PARTIALLY_PAID'].includes(row.status),
  ).length;
  const paidCount = rows.filter((row) => row.status === 'PAID').length;
  const outstandingTotal = rows.reduce((sum, row) => sum + Number(row.outstandingAmount ?? 0), 0);

  const loadPayments = async (schedule: LoanSchedule) => {
    setSelected(schedule);
    setPaymentAck(false);
    setPaymentAccounts({ cashDeskAccountId: '', interestAccountId: '', feeAccountId: '' });
    setPaymentForm((current) => ({
      ...current,
      amount: String(schedule.outstandingAmount ?? ''),
      currency: loanById.get(schedule.loanDebtId)?.currency ?? current.currency,
      cashAccountId: '',
    }));
  };

  const openGenerate = () => {
    setGenerateForm({ companyId, loanId: '' });
    setError('');
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
      const response = await fetch(
        `/api/backend/loan-repayment-schedules/generate/${generateForm.loanId}`,
        {
          method: 'POST',
        },
      );
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
    if (paymentPending.current) return;
    if (
      !paymentAccounts.cashDeskAccountId ||
      !preview.data ||
      preview.error ||
      preview.loading ||
      !paymentAck
    ) {
      setError('Review the allocation and choose a connected paying account first.');
      return;
    }
    if (!selected || !paymentForm.amount || Number(paymentForm.amount) <= 0) {
      setError('Payment amount must be greater than zero');
      return;
    }

    paymentPending.current = true;
    const requestId = paymentRequests.current.get(selected.id) ?? crypto.randomUUID();
    paymentRequests.current.set(selected.id, requestId);
    setSaving(true);
    setError('');
    try {
      const response = await fetch(
        `/api/backend/loan-repayment-schedules/${selected.id}/payments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentDate: paymentForm.paymentDate,
            amount: paymentForm.amount,
            currency: preview.data.currency,
            paymentMethod: paymentForm.paymentMethod,
            requestId,
            allocationFingerprint: preview.data.allocationFingerprint,
            ...paymentAccounts,
            interestAccountId: paymentAccounts.interestAccountId || undefined,
            feeAccountId: paymentAccounts.feeAccountId || undefined,
            reference: paymentForm.reference || undefined,
          }),
        },
      );
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(json, 'Payment failed'));
      // This transaction is acknowledged. A later partial payment is a new
      // transaction; failed/uncertain submissions keep their existing identity.
      paymentRequests.current.delete(selected.id);
      setPaymentAck(false);
      setPaymentOpen(false);
      await load();
      paymentHistory.reload();
      showToast('success', 'Repayment recorded');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      paymentPending.current = false;
      setSaving(false);
    }
  };

  const filteredLoans = generateForm.companyId
    ? loans.filter((loan) => loan.companyId === generateForm.companyId)
    : loans;
  const selectedCompanyId = selected?.companyId ?? companyId;

  if (authLoading || !canView) {
    return (
      <div className="p-6">
        <PageHeader
          title="Loan Repayment Schedules"
          subtitle={authLoading ? 'Loading' : 'Access restricted'}
        />
      </div>
    );
  }

  return (
    <div className="business-workspace accounting-workspace space-y-6">
      <PageHeader
        title="Loan Repayment Schedules"
        subtitle="Generate amortization schedules, inspect installments, and record repayment postings"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard countUp={false} label="Installments" value={rows.length} />
        <StatCard countUp={false} label="Due / Partial" value={dueCount} />
        <StatCard countUp={false} label="Paid" value={paidCount} />
        <StatCard countUp={false} label="Outstanding" value={fmtMoney(outstandingTotal)} />
      </div>

      <PageToolbar
        collapsibleFilters
        activeFilterCount={[companyId, status].filter(Boolean).length}
        filters={
          <>
            {' '}
            <FormSelect
              label="Company"
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setSelected(null);
              }}
              placeholder="All companies"
            >
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {optionLabel(company)}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setSelected(null);
              }}
              placeholder="All statuses"
            >
              {['UPCOMING', 'DUE', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </FormSelect>
          </>
        }
        actions={
          <>
            <Btn variant="secondary" onClick={() => void load()} disabled={loading}>
              Refresh
            </Btn>
            <Btn variant="secondary" onClick={() => setCustomOpen(true)}>
              Add installment
            </Btn>
            <Btn onClick={openGenerate}>Generate schedule</Btn>
          </>
        }
      />

      {loadError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <span>{loadError}</span>
          <Btn size="sm" variant="secondary" onClick={() => void load()}>
            Try again
          </Btn>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <WorkspaceSplit selectedKey={selected?.id} onClose={() => setSelected(null)}>
        <Card className="overflow-hidden">
          {loading ? (
            <PageSpinner />
          ) : (
            <div className="overflow-x-auto">
              <WorkspaceTable className="w-full text-sm">
                <thead>
                  <tr
                    className="text-left text-xs uppercase bg-gray-50"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    <th className="px-4 py-3">Installment</th>
                    <th className="px-4 py-3">Due</th>
                    <th className="px-4 py-3 text-right">Outstanding</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-8 text-center text-sm"
                        style={{ color: 'var(--aurora-text-muted)' }}
                      >
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
                            <strong>{loan ? loanLabel(loan) : row.loanDebtId}</strong>
                            <div className="text-xs mt-1">
                              {row.repaymentScheduleNumber} · #{row.installmentNumber}
                            </div>
                            <small>
                              {optionLabel(
                                companyById.get(row.companyId) ?? { name: row.companyId },
                              )}
                            </small>
                          </td>
                          <td className="px-4 py-3">
                            {fmtDate(row.dueDate)}
                            <div className="text-xs mt-1">
                              {fmtMoney(row.totalAmount, currency)} total
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {fmtMoney(row.outstandingAmount, currency)}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={row.status} />
                            <Link
                              href={`/group-control/loans-debts/loans/${row.loanDebtId}`}
                              className="block mt-2 text-xs text-brand-600"
                              onClick={(event) => event.stopPropagation()}
                            >
                              View loan
                            </Link>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </WorkspaceTable>
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
                  {loanById.get(selected.loanDebtId)
                    ? loanLabel(loanById.get(selected.loanDebtId) as Loan)
                    : selected.loanDebtId}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <StatCard
                  countUp={false}
                  label="Principal"
                  value={fmtMoney(
                    selected.principalAmount,
                    loanById.get(selected.loanDebtId)?.currency ?? 'TZS',
                  )}
                />
                <StatCard
                  countUp={false}
                  label="Interest"
                  value={fmtMoney(
                    selected.interestAmount,
                    loanById.get(selected.loanDebtId)?.currency ?? 'TZS',
                  )}
                />
                <StatCard
                  countUp={false}
                  label="Paid"
                  value={fmtMoney(
                    selected.paidAmount,
                    loanById.get(selected.loanDebtId)?.currency ?? 'TZS',
                  )}
                />
                <StatCard
                  countUp={false}
                  label="Fees"
                  value={fmtMoney(
                    selected.feeAmount,
                    loanById.get(selected.loanDebtId)?.currency ?? 'TZS',
                  )}
                />
                <StatCard
                  countUp={false}
                  label="Outstanding"
                  value={fmtMoney(
                    selected.outstandingAmount,
                    loanById.get(selected.loanDebtId)?.currency ?? 'TZS',
                  )}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Btn
                  size="sm"
                  variant="success"
                  disabled={selected.status === 'PAID' || selected.status === 'CANCELLED'}
                  onClick={() => {
                    setError('');
                    setPaymentAck(false);
                    if (!paymentRequests.current.has(selected.id)) {
                      setPaymentForm((current) => ({
                        ...current,
                        amount: String(selected.outstandingAmount),
                        reference: '',
                      }));
                    }
                    setPaymentOpen(true);
                  }}
                >
                  Record Payment
                </Btn>
              </div>
              <div
                className="max-h-[340px] overflow-auto border rounded-lg"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                {paymentHistory.error ? (
                  <ErrorState message={paymentHistory.error} onRetry={paymentHistory.reload} />
                ) : paymentHistory.loading ? (
                  <PageSpinner />
                ) : payments.length === 0 ? (
                  <div className="p-4 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                    No payments recorded for this installment.
                  </div>
                ) : (
                  payments.map((payment) => (
                    <div
                      key={payment.id}
                      className="border-b p-3 text-sm"
                      style={{ borderColor: 'var(--aurora-border)' }}
                    >
                      <div className="flex justify-between gap-3">
                        <div>
                          <div className="font-medium">
                            {payment.repaymentPaymentNumber}
                            {payment.financialEvent?.reversedAt ? ' · Reversed' : ''}
                          </div>
                          <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                            {fmtDate(payment.paymentDate)} - {payment.paymentMethod}
                          </div>
                        </div>
                        <div className="text-right font-mono">
                          {fmtMoney(payment.amount, payment.currency)}
                        </div>
                      </div>
                      <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {payment.cashAccountId
                          ? cashAccountLabel(
                              cashAccountById.get(payment.cashAccountId) ?? {
                                id: payment.cashAccountId,
                                companyId: selected.companyId,
                                accountName: payment.cashAccountId,
                                accountType: 'Account',
                              },
                            )
                          : 'No cash account selected'}
                        {payment.reference ? ` - ${payment.reference}` : ''}
                        {payment.financialEvent && (
                          <p>
                            Principal {fmtMoney(payment.financialEvent.principal, payment.currency)}{' '}
                            · Interest {fmtMoney(payment.financialEvent.interest, payment.currency)}{' '}
                            · Fees {fmtMoney(payment.financialEvent.fees, payment.currency)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </Card>
      </WorkspaceSplit>

      {customOpen && (
        <LoanInstallmentModal
          loans={loans}
          onClose={() => setCustomOpen(false)}
          onSaved={() => void load()}
        />
      )}
      {generating && (
        <Modal
          open
          title="Generate Loan Repayment Schedule"
          onClose={() => setGenerating(false)}
          size="lg"
          footer={
            <>
              <Btn variant="secondary" onClick={() => setGenerating(false)}>
                Cancel
              </Btn>
              <Btn loading={saving} onClick={generateSchedule}>
                Generate
              </Btn>
            </>
          }
        >
          {error && (
            <p role="alert" className="workspace-error">
              {error}
            </p>
          )}
          <div className="grid gap-3">
            <FormSelect
              label="Company"
              value={generateForm.companyId}
              onChange={(e) => setGenerateForm({ companyId: e.target.value, loanId: '' })}
              placeholder="All companies"
            >
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {optionLabel(company)}
                </option>
              ))}
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
          onClose={() => {
            if (!saving) setPaymentOpen(false);
          }}
          size="lg"
          footer={
            <>
              <Btn variant="secondary" onClick={() => setPaymentOpen(false)}>
                Cancel
              </Btn>
              <Btn
                loading={saving}
                disabled={
                  !paymentAck ||
                  !preview.data ||
                  !!preview.error ||
                  preview.loading ||
                  !paymentAccounts.cashDeskAccountId
                }
                onClick={recordPayment}
              >
                Record Payment
              </Btn>
            </>
          }
        >
          <div className="grid md:grid-cols-2 gap-3">
            <FormDateField
              label="Payment Date"
              value={paymentForm.paymentDate}
              onChange={(value) => setPaymentForm((f) => ({ ...f, paymentDate: value }))}
            />
            <FormInput
              label="Amount"
              required
              type="number"
              min="0.01"
              step="0.01"
              value={paymentForm.amount}
              onChange={(e) => {
                setPaymentAck(false);
                setPaymentForm((f) => ({ ...f, amount: e.target.value }));
              }}
            />
            <FormSelect
              label="Payment Method"
              value={paymentForm.paymentMethod}
              onChange={(e) => setPaymentForm((f) => ({ ...f, paymentMethod: e.target.value }))}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </FormSelect>
            <FormInput
              label="Currency"
              disabled
              value={preview.data?.currency || paymentForm.currency}
              onChange={(e) =>
                setPaymentForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))
              }
            />
            <FormInput
              label="Reference"
              value={paymentForm.reference}
              onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))}
            />
          </div>
          <div className="mt-4 space-y-3">
            <LoanPaymentAccounts
              companyId={selected.companyId}
              currency={preview.data?.currency || paymentForm.currency}
              value={paymentAccounts}
              onChange={setPaymentAccounts}
            />
            {preview.loading && <p role="status">Reviewing allocation…</p>}
            {(preview.error || error) && <p role="alert">{preview.error || error}</p>}
            {preview.data && (
              <div className="rounded-xl border p-3 text-sm">
                <strong>Payment allocation</strong>
                <p>
                  Principal: {fmtMoney(preview.data.principal, preview.data.currency)} · Interest:{' '}
                  {fmtMoney(preview.data.interest, preview.data.currency)} · Fees:{' '}
                  {fmtMoney(preview.data.fees, preview.data.currency)}
                </p>
                <p>
                  Allocated proportionally across the remaining installment amounts. Only principal
                  reduces the loan.
                </p>
              </div>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={paymentAck}
                onChange={(e) => setPaymentAck(e.target.checked)}
              />
              I have reviewed this allocation and confirmed the payment is not already recorded.
              Save cash and accounting together.
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}
