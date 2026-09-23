import { Prisma } from '@prisma/client';
import { DeskReportQuery } from './desk-reports.dto';
import { reportPeriod, Row, Table } from './desk-reports.domain';

const D = (v: Prisma.Decimal.Value = 0) => new Prisma.Decimal(v);
export const day = (d: Date) => d.toISOString().slice(0, 10);
const col = (key: string, label: string, money = false) => ({ key, label, money });
export const table = (
  id: string,
  title: string,
  columns: Table['columns'],
  rows: Row[],
): Table => ({ id, title, columns, rows });
export const addDays = (date: string, n: number) =>
  day(new Date(new Date(date).getTime() + n * 86400000));
export type FinancingPayment = {
  reversal?: boolean;
  interest?: Prisma.Decimal;
  fees?: Prisma.Decimal;
  penalties?: Prisma.Decimal;
  id: string;
  date: Date;
  amount: Prisma.Decimal;
  principal: Prisma.Decimal | null;
  reference: string;
  currency: string;
};
export type FinancingLoan = {
  principalAtDate?: Prisma.Decimal;
  id: string;
  reference: string;
  lender: string;
  company: string;
  currency: string;
  type: string;
  status: string;
  date: Date;
  maturity: Date;
  current: Prisma.Decimal;
  payments: FinancingPayment[];
  installments: {
    id: string;
    due: Date;
    amount: Prisma.Decimal;
    payments: { date: Date; amount: Prisma.Decimal }[];
  }[];
};

/** Historical principal is bridged backwards from the current register using recorded principal repayments.
 * A missing allocation fails closed: no invented historical principal or instalment forecast. */
export function financingReport(loans: FinancingLoan[], q: DeskReportQuery) {
  const period = reportPeriod(q),
    rows: Row[] = [],
    payments: Row[] = [],
    due: Row[] = [],
    issues: Row[] = [];
  for (const loan of loans) {
    if (day(loan.date) > period.to) continue;
    const excluded = ['INTER_COMPANY_LOAN', 'SUPPLIER_CREDIT'].includes(loan.type);
    const invalid = loan.payments.some(
      (p) =>
        p.currency !== loan.currency ||
        p.principal === null ||
        (!p.reversal && p.principal.lt(0)) ||
        p.principal.abs().gt(p.amount.abs()),
    );
    const historical = period.to < reportPeriod({}).to;
    const unallocatedLater = loan.payments.some(
      (p) => day(p.date) > period.to && (p.principal === null || p.currency !== loan.currency),
    );
    const balance =
      loan.principalAtDate ??
      ((invalid && historical) || unallocatedLater || loan.current.lt(0)
        ? null
        : loan.payments
            .filter((p) => day(p.date) > period.to)
            .reduce((n, p) => n.plus(p.principal ?? 0), D(loan.current)));
    if (invalid)
      issues.push({
        id: loan.id,
        currency: loan.currency,
        reference: loan.reference,
        issue:
          'Repayment allocation or currency needs reconciliation. Historical principal may be unavailable.',
      });
    if (loan.current.lt(0))
      issues.push({
        id: loan.id,
        currency: loan.currency,
        reference: loan.reference,
        issue: 'Negative principal in the source register; review repayments.',
      });
    if (
      loan.principalAtDate === undefined &&
      ['CANCELLED', 'WRITTEN_OFF', 'RESTRUCTURED'].includes(loan.status)
    )
      issues.push({
        id: loan.id,
        currency: loan.currency,
        reference: loan.reference,
        issue: `Current status is ${loan.status}. Earlier balances may be restated; review source adjustments.`,
      });
    rows.push({
      id: loan.id,
      reference: loan.reference,
      lender: loan.lender,
      company: loan.company,
      currency: loan.currency,
      type: loan.type.replaceAll('_', ' '),
      status: loan.status,
      principal: balance?.toFixed(2) ?? '',
      maturity: day(loan.maturity),
      treatment: excluded
        ? 'Separate register — excluded from external debt'
        : 'External borrowing',
      schedule: loan.installments.length ? 'Instalments' : 'No repayment schedule',
      href: `/group-control/loans-debts/loans/${loan.id}`,
    });
    for (const p of loan.payments.filter(
      (p) => day(p.date) >= period.from && day(p.date) <= period.to,
    ))
      payments.push({
        id: p.id,
        loanId: loan.id,
        date: day(p.date),
        reference: loan.reference,
        paymentReference: p.reference,
        company: loan.company,
        currency: p.currency,
        amount: p.amount.toFixed(2),
        principal: p.principal?.toFixed(2) ?? '',
        charges: p.principal === null ? '' : p.amount.minus(p.principal).toFixed(2),
        interest: p.interest?.toFixed(2) ?? '',
        fees: p.fees?.toFixed(2) ?? '',
        penalties: p.penalties?.toFixed(2) ?? '',
        href: `/group-control/loans-debts/loans/${loan.id}`,
      });
    for (const i of loan.installments) {
      const remaining = i.amount.minus(
        i.payments.filter((p) => day(p.date) <= period.to).reduce((n, p) => n.plus(p.amount), D()),
      );
      if (remaining.gt(0) && day(i.due) <= addDays(period.to, 90))
        due.push({
          id: i.id,
          loanId: loan.id,
          reference: loan.reference,
          company: loan.company,
          lender: loan.lender,
          currency: loan.currency,
          dueDate: day(i.due),
          amount: remaining.toFixed(2),
          treatment: excluded ? 'Excluded register' : 'External borrowing',
          href: '/accounting-engine/loan-repayments',
        });
    }
    if (!excluded && balance?.gt(0) && !loan.installments.length)
      issues.push({
        id: loan.id,
        currency: loan.currency,
        reference: loan.reference,
        issue:
          'No instalment schedule. This loan is excluded from scheduled commitments; maturity is shown in the register.',
      });
  }
  const currencies = [...new Set(rows.map((r) => String(r.currency)))].sort().map((currency) => {
    const external = rows.filter(
      (r) => r.currency === currency && r.treatment === 'External borrowing',
    );
    const scheduled = due.filter(
      (r) => r.currency === currency && r.treatment === 'External borrowing',
    );
    const sum = (items: Row[], key: string) =>
      items.reduce((n, r) => n.plus(r[key] || 0), D()).toFixed(2);
    return {
      currency,
      principal: external.some((r) => r.principal === '') ? null : sum(external, 'principal'),
      overdue: sum(
        scheduled.filter((r) => r.dueDate < period.to),
        'amount',
      ),
      due7: sum(
        scheduled.filter((r) => r.dueDate >= period.to && r.dueDate <= addDays(period.to, 7)),
        'amount',
      ),
      due30: sum(
        scheduled.filter((r) => r.dueDate >= period.to && r.dueDate <= addDays(period.to, 30)),
        'amount',
      ),
      due90: sum(
        scheduled.filter((r) => r.dueDate >= period.to),
        'amount',
      ),
    };
  });
  return {
    source: 'ERP loans',
    period,
    generatedAt: new Date().toISOString(),
    currencies,
    basis:
      'Principal is reconstructed from the current loan register plus recorded principal repayments after the selected date. Later edits, write-offs and restructuring restate history. Missing repayment allocations are flagged. Scheduled commitments include principal, interest and fees; they are not added to principal debt. ERP intercompany and supplier-credit records are listed separately to avoid overlap with Cash Desk and Invoice Desk. This is not a closed accounting snapshot.',
    tables: [
      table(
        'borrowings',
        'Borrowing register',
        [
          col('reference', 'Loan'),
          col('lender', 'Lender'),
          col('company', 'Borrower'),
          col('currency', 'Currency'),
          col('type', 'Type'),
          col('principal', 'Principal at date', true),
          col('maturity', 'Maturity'),
          col('schedule', 'Repayment plan'),
          col('treatment', 'Reporting treatment'),
        ],
        rows,
      ),
      table(
        'repayments',
        'Loan repayment history',
        [
          col('date', 'Date'),
          col('reference', 'Loan'),
          col('paymentReference', 'Payment reference'),
          col('company', 'Borrower'),
          col('currency', 'Currency'),
          col('amount', 'Cash paid', true),
          col('principal', 'Principal paid', true),
          col('charges', 'Interest / charges', true),
          col('interest', 'Interest', true),
          col('fees', 'Fees', true),
          col('penalties', 'Penalties', true),
        ],
        payments,
      ),
      table(
        'commitments',
        'Loan instalments due through 90 days',
        [
          col('dueDate', 'Due'),
          col('reference', 'Loan'),
          col('company', 'Borrower'),
          col('lender', 'Lender'),
          col('currency', 'Currency'),
          col('amount', 'Remaining instalment', true),
          col('treatment', 'Reporting treatment'),
        ],
        due.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))),
      ),
      table(
        'issues',
        'Loan reconciliation checks',
        [col('reference', 'Loan'), col('currency', 'Currency'), col('issue', 'Needs attention')],
        issues,
      ),
    ],
  };
}

export type InternalLoan = {
  id: string;
  currency: string;
  principal: Prisma.Decimal;
  recognitionReversalDate?: Date;
  current: Prisma.Decimal;
  date: Date;
  due: Date | null;
  description: string;
  lenderId: string;
  borrowerId: string;
  lender: string;
  borrower: string;
  payments: {
    id: string;
    date: Date;
    amount: Prisma.Decimal;
    principal?: Prisma.Decimal;
    interest?: Prisma.Decimal;
    fees?: Prisma.Decimal;
    reference: string;
  }[];
};
export function internalReport(
  loans: InternalLoan[],
  includedAccounts: Set<string>,
  q: DeskReportQuery,
) {
  const period = reportPeriod(q),
    rows: Row[] = [],
    payments: Row[] = [];
  for (const loan of loans) {
    const made = loan.payments.filter((p) => day(p.date) <= period.to),
      paid = made.reduce((n, p) => n.plus(p.principal ?? p.amount), D()),
      balance = (
        loan.recognitionReversalDate && day(loan.recognitionReversalDate) <= period.to
          ? D()
          : loan.principal
      ).minus(paid);
    const lender = includedAccounts.has(loan.lenderId),
      borrower = includedAccounts.has(loan.borrowerId);
    const check = (loan.recognitionReversalDate ? D() : loan.principal)
      .minus(loan.payments.reduce((n, p) => n.plus(p.principal ?? p.amount), D()))
      .eq(loan.current)
      ? 'Matched'
      : 'Balance mismatch';
    rows.push({
      id: loan.id,
      currency: loan.currency,
      lender: loan.lender,
      borrower: loan.borrower,
      date: day(loan.date),
      dueDate: loan.due ? day(loan.due) : '',
      description: loan.description,
      principal: loan.principal.toFixed(2),
      paid: paid.toFixed(2),
      outstanding: balance.toFixed(2),
      receivable: lender ? balance.toFixed(2) : '0.00',
      payable: borrower ? balance.toFixed(2) : '0.00',
      eliminated: lender && borrower ? balance.toFixed(2) : '0.00',
      treatment:
        lender && borrower ? 'Both sides in scope — eliminate' : 'One side in scope — retain',
      check,
      href: '/cash-desk',
    });
    for (const p of made.filter((p) => day(p.date) >= period.from))
      payments.push({
        id: p.id,
        date: day(p.date),
        lender: loan.lender,
        borrower: loan.borrower,
        currency: loan.currency,
        amount: p.amount.toFixed(2),
        principal: (p.principal ?? p.amount).toFixed(2),
        interest: (p.interest ?? D()).toFixed(2),
        fees: (p.fees ?? D()).toFixed(2),
        reference: p.reference,
        href: '/cash-desk',
      });
  }
  const currencies = [...new Set(rows.map((r) => String(r.currency)))].sort().map((currency) => {
    const r = rows.filter((r) => r.currency === currency),
      sum = (key: string) => r.reduce((n, x) => n.plus(x[key]), D());
    return {
      currency,
      receivable: sum('receivable').minus(sum('eliminated')).toFixed(2),
      payable: sum('payable').minus(sum('eliminated')).toFixed(2),
      eliminated: sum('eliminated').toFixed(2),
    };
  });
  return {
    source: 'Cash Desk intercompany loans',
    period,
    generatedAt: new Date().toISOString(),
    currencies,
    basis:
      'Balances include disbursements, repayments and reversals on their business dates. A loan is eliminated only when both accounts belong to the selected accessible scope. This eliminates matched loan principal, not other intercompany trading or interest. Counterparty account names are hidden when outside your access.',
    tables: [
      table(
        'internal',
        'Intercompany balances',
        [
          col('lender', 'Lender'),
          col('borrower', 'Borrower'),
          col('currency', 'Currency'),
          col('dueDate', 'Due'),
          col('principal', 'Original principal', true),
          col('paid', 'Repaid through date', true),
          col('outstanding', 'Outstanding', true),
          col('treatment', 'Group treatment'),
          col('check', 'Reconciliation'),
        ],
        rows,
      ),
      table(
        'internal-payments',
        'Intercompany repayment history',
        [
          col('date', 'Date'),
          col('lender', 'Lender'),
          col('borrower', 'Borrower'),
          col('currency', 'Currency'),
          col('reference', 'Reference'),
          col('amount', 'Repaid', true),
          col('principal', 'Principal', true),
          col('interest', 'Interest', true),
          col('fees', 'Fees', true),
        ],
        payments,
      ),
    ],
  };
}
