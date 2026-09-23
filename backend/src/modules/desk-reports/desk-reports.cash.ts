import { Prisma } from '@prisma/client';
import { DeskReportQuery } from './desk-reports.dto';
import { reportPeriod, Row, Table } from './desk-reports.domain';
const D = (v: Prisma.Decimal.Value = 0) => new Prisma.Decimal(v);
type Entry = {
  id: string;
  businessDate: Date;
  amount: Prisma.Decimal;
  account: {
    id: string;
    name: string;
    currency: string;
    companyId: string;
    divisionId: string;
    branchId: string;
    company: { name: string };
    division: { name: string };
    branch: { name: string };
  };
  movement: {
    id: string;
    kind: string;
    description: string;
    reference: string;
    payee: string | null;
    expenseCategory: string | null;
    reversedAt: Date | null;
    reversalOfId: string | null;
  };
};
export function cashReport(entries: Entry[], q: DeskReportQuery) {
  const period = reportPeriod(q),
    currencies = new Map<
      string,
      {
        currency: string;
        opening: Prisma.Decimal;
        inflow: Prisma.Decimal;
        outflow: Prisma.Decimal;
        closing: Prisma.Decimal;
        expenses: Prisma.Decimal;
        previous: Prisma.Decimal;
      }
    >();
  const accounts = new Map<string, Row>(),
    categories = new Map<string, Row>(),
    payees = new Map<string, Row>(),
    branches = new Map<string, Row>(),
    months = new Map<string, Row>();
  const ledger: Row[] = [],
    expenses: Row[] = [];
  const add = (row: Row, key: string, value: Prisma.Decimal) => {
    row[key] = D(row[key] ?? 0)
      .plus(value)
      .toFixed(2);
  };
  for (const entry of entries) {
    const a = entry.account,
      m = entry.movement,
      date = entry.businessDate.toISOString().slice(0, 10),
      amount = D(entry.amount);
    if (date > period.to) continue;
    const c = currencies.get(a.currency) ?? {
      currency: a.currency,
      opening: D(),
      inflow: D(),
      outflow: D(),
      closing: D(),
      expenses: D(),
      previous: D(),
    };
    currencies.set(a.currency, c);
    const account = accounts.get(a.id) ?? {
      id: a.id,
      name: a.name,
      company: a.company.name,
      division: a.division.name,
      branch: a.branch.name,
      currency: a.currency,
      opening: '0.00',
      inflow: '0.00',
      outflow: '0.00',
      closing: '0.00',
    };
    accounts.set(a.id, account);
    c.closing = c.closing.plus(amount);
    add(account, 'closing', amount);
    if (date < period.from) {
      c.opening = c.opening.plus(amount);
      add(account, 'opening', amount);
    }
    const validExpense = m.kind === 'EXPENSE' && !m.reversedAt && amount.lt(0);
    if (validExpense && date >= period.previousFrom && date <= period.previousTo)
      c.previous = c.previous.plus(amount.abs());
    if (date < period.from) continue;
    if (amount.gte(0)) {
      c.inflow = c.inflow.plus(amount);
      add(account, 'inflow', amount);
    } else {
      c.outflow = c.outflow.plus(amount.abs());
      add(account, 'outflow', amount.abs());
    }
    const row = {
      id: entry.id,
      movementId: m.id,
      date,
      company: a.company.name,
      division: a.division.name,
      branch: a.branch.name,
      account: a.name,
      currency: a.currency,
      kind: m.kind,
      reference: m.reference,
      description: m.description,
      payee: m.payee || 'Unspecified',
      category: m.expenseCategory || 'UNCATEGORIZED',
      inflow: amount.gt(0) ? amount.toFixed(2) : '0.00',
      outflow: amount.lt(0) ? amount.abs().toFixed(2) : '0.00',
      amount: amount.abs().toFixed(2),
      status: m.reversedAt ? 'Reversed' : m.reversalOfId ? 'Reversal entry' : 'Recorded',
    };
    ledger.push(row);
    const monthKey = `${date.slice(0, 7)}:${a.currency}`,
      month = months.get(monthKey) ?? {
        month: date.slice(0, 7),
        currency: a.currency,
        inflow: '0.00',
        outflow: '0.00',
        expenses: '0.00',
      };
    months.set(monthKey, month);
    add(month, amount.gt(0) ? 'inflow' : 'outflow', amount.abs());
    if (validExpense) {
      const value = amount.abs();
      c.expenses = c.expenses.plus(value);
      add(month, 'expenses', value);
      expenses.push(row);
      for (const [map, id, name] of [
        [categories, row.category, row.category],
        [payees, row.payee, row.payee],
        [branches, a.branchId, a.branch.name],
      ] as const) {
        const key = `${id}:${a.currency}`,
          r = map.get(key) ?? {
            id,
            name,
            currency: a.currency,
            companyId: a.companyId,
            divisionId: a.divisionId,
            branchId: a.branchId,
            company: a.company.name,
            division: a.division.name,
            branch: a.branch.name,
            amount: '0.00',
            count: 0,
          };
        add(r, 'amount', value);
        r.count = Number(r.count) + 1;
        map.set(key, r);
      }
    }
  }
  for (const currency of currencies.keys())
    for (
      let date = new Date(`${period.from.slice(0, 7)}-01`);
      date.toISOString().slice(0, 7) <= period.to.slice(0, 7);
      date.setUTCMonth(date.getUTCMonth() + 1)
    ) {
      const month = date.toISOString().slice(0, 7),
        key = `${month}:${currency}`;
      if (!months.has(key))
        months.set(key, { month, currency, inflow: '0.00', outflow: '0.00', expenses: '0.00' });
    }
  const col = (key: string, label: string, money = false) => ({ key, label, money });
  const totalsCols = [
    col('currency', 'Currency'),
    col('opening', 'Opening', true),
    col('inflow', 'Money in', true),
    col('outflow', 'Money out', true),
    col('closing', 'Closing', true),
  ];
  const expenseCols = [
    col('date', 'Date'),
    col('description', 'Description'),
    col('category', 'Category'),
    col('payee', 'Payee'),
    col('company', 'Company'),
    col('branch', 'Branch'),
    col('account', 'Account'),
    col('reference', 'Reference'),
    col('currency', 'Currency'),
    col('amount', 'Amount', true),
  ];
  const rank = (map: Map<string, Row>) =>
    [...map.values()].sort(
      (a, b) =>
        String(a.currency).localeCompare(String(b.currency)) || D(b.amount).comparedTo(D(a.amount)),
    );
  const running = new Map([...currencies].map(([currency, c]) => [currency, c.opening]));
  for (const row of ledger) {
    const value = running.get(String(row.currency))!.plus(row.inflow).minus(row.outflow);
    running.set(String(row.currency), value);
    row.balance = value.toFixed(2);
  }
  const tables: Table[] = [
    {
      id: 'categories',
      title: 'Expenses by category',
      columns: [
        col('name', 'Category'),
        col('currency', 'Currency'),
        col('count', 'Payments'),
        col('amount', 'Paid expenses', true),
      ],
      rows: rank(categories),
    },
    {
      id: 'payees',
      title: 'Expenses by payee',
      columns: [
        col('name', 'Payee'),
        col('currency', 'Currency'),
        col('count', 'Payments'),
        col('amount', 'Paid expenses', true),
      ],
      rows: rank(payees),
    },
    { id: 'expenses', title: 'Expense details', columns: expenseCols, rows: expenses },
    {
      id: 'branches',
      title: 'Expenses by branch',
      columns: [
        col('company', 'Company'),
        col('division', 'Division'),
        col('branch', 'Branch'),
        col('currency', 'Currency'),
        col('count', 'Payments'),
        col('amount', 'Paid expenses', true),
      ],
      rows: rank(branches),
    },
    {
      id: 'accounts',
      title: 'Account balances',
      columns: [
        col('name', 'Account'),
        col('company', 'Company'),
        col('division', 'Division'),
        col('branch', 'Branch'),
        ...totalsCols,
      ],
      rows: [...accounts.values()],
    },
    {
      id: 'statement',
      title: 'Cash book',
      columns: [
        col('date', 'Date'),
        col('account', 'Account'),
        col('company', 'Company'),
        col('branch', 'Branch'),
        col('kind', 'Movement'),
        col('description', 'Description'),
        col('reference', 'Reference'),
        col('status', 'Status'),
        col('currency', 'Currency'),
        col('inflow', 'In', true),
        col('outflow', 'Out', true),
        col('balance', 'Running balance', true),
      ],
      rows: ledger,
    },
    {
      id: 'monthly',
      title: 'Monthly trend',
      columns: [
        col('month', 'Month'),
        col('currency', 'Currency'),
        col('inflow', 'Money in', true),
        col('outflow', 'Money out', true),
        col('expenses', 'Paid expenses', true),
      ],
      rows: [...months.values()].sort((a, b) => String(a.month).localeCompare(String(b.month))),
    },
  ];
  return {
    source: 'Cash Desk',
    period,
    generatedAt: new Date().toISOString(),
    basis:
      'Cash balances use signed entries, including opening entries and reversals, by business date. Transfers may appear on both sides and are not revenue. Expense analysis uses currently unreversed expenses; later reversals restate earlier periods.',
    currencies: [...currencies.values()].map((c) => ({
      ...c,
      opening: c.opening.toFixed(2),
      inflow: c.inflow.toFixed(2),
      outflow: c.outflow.toFixed(2),
      closing: c.closing.toFixed(2),
      expenses: c.expenses.toFixed(2),
      previous: c.previous.toFixed(2),
      change: c.previous.isZero()
        ? null
        : c.expenses.minus(c.previous).div(c.previous).mul(100).toFixed(1),
    })),
    tables,
  };
}
