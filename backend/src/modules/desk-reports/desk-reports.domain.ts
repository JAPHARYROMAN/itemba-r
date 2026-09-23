import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DeskReportQuery } from './desk-reports.dto';

const D = (v: Prisma.Decimal.Value = 0) => new Prisma.Decimal(v);
const iso = (d: Date) => d.toISOString().slice(0, 10);
export type Cell = string | number;
export type Row = Record<string, Cell>;
export type Table = {
  id: string;
  title: string;
  columns: { key: string; label: string; money?: boolean }[];
  rows: Row[];
};
const column = (key: string, label: string, money = false) => ({ key, label, money });
export function reportPeriod(q: DeskReportQuery) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const to = q.to || today,
    from = q.from || `${to.slice(0, 7)}-01`;
  for (const value of [from, to])
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(new Date(value).getTime()) ||
      iso(new Date(value)) !== value
    )
      throw new BadRequestException('Enter a valid date in YYYY-MM-DD format.');
  if (from > to) throw new BadRequestException('Start date must be on or before end date.');
  const days = (new Date(to).getTime() - new Date(from).getTime()) / 86400000 + 1;
  if (days > 3660) throw new BadRequestException('Choose a report period of ten years or less.');
  const previousTo = iso(new Date(new Date(from).getTime() - 86400000));
  const previousFrom = iso(new Date(new Date(from).getTime() - days * 86400000));
  return { from, to, previousFrom, previousTo };
}
export type TradeDocument = {
  id: string;
  reference: string;
  date: Date;
  dueDate: Date;
  amount: Prisma.Decimal;
  currency: string;
  partyId: string;
  party: string;
  company: string;
  division: string;
  branch: string;
  companyId: string;
  divisionId: string;
  branchId: string;
  payments: { id: string; date: Date; amount: Prisma.Decimal; reference: string }[];
};
type Bucket = {
  currency: string;
  opening: Prisma.Decimal;
  issued: Prisma.Decimal;
  paid: Prisma.Decimal;
  closing: Prisma.Decimal;
  overdue: Prisma.Decimal;
  previous: Prisma.Decimal;
  count: number;
};
export function tradeReport(
  documents: TradeDocument[],
  q: DeskReportQuery,
  source: 'Sales Desk' | 'Invoice Desk',
) {
  const period = reportPeriod(q),
    currencies = new Map<string, Bucket>();
  const parties = new Map<string, Row>(),
    groups = new Map<string, Row>(),
    months = new Map<string, Row>();
  const details: Row[] = [],
    payments: Row[] = [],
    ledger: Row[] = [],
    ageing: Row[] = [];
  const add = (row: Row, key: string, amount: Prisma.Decimal) => {
    row[key] = D(row[key] ?? 0)
      .plus(amount)
      .toFixed(2);
  };
  const tradeLabel = source === 'Sales Desk' ? 'Sales' : 'Purchases';
  const inPeriod = (date: string) => date >= period.from && date <= period.to;
  for (const doc of documents) {
    const date = iso(doc.date);
    if (date > period.to) continue;
    const amount = D(doc.amount);
    const c = currencies.get(doc.currency) ?? {
      currency: doc.currency,
      opening: D(),
      issued: D(),
      paid: D(),
      closing: D(),
      overdue: D(),
      previous: D(),
      count: 0,
    };
    currencies.set(doc.currency, c);
    const key = `${doc.partyId}:${doc.currency}`;
    const party = parties.get(key) ?? {
      id: doc.partyId,
      name: doc.party,
      company: doc.company,
      currency: doc.currency,
      count: 0,
      opening: '0.00',
      issued: '0.00',
      paid: '0.00',
      closing: '0.00',
      current: '0.00',
      days1to30: '0.00',
      days31to60: '0.00',
      days61to90: '0.00',
      days90plus: '0.00',
    };
    parties.set(key, party);
    const groupKey = `${doc.branchId}:${doc.currency}`;
    const group = groups.get(groupKey) ?? {
      id: doc.branchId,
      companyId: doc.companyId,
      divisionId: doc.divisionId,
      branchId: doc.branchId,
      company: doc.company,
      division: doc.division,
      branch: doc.branch,
      currency: doc.currency,
      issued: '0.00',
      paid: '0.00',
      closing: '0.00',
      count: 0,
    };
    groups.set(groupKey, group);
    const monthRow = (month: string) => {
      const k = `${month}:${doc.currency}`;
      const row = months.get(k) ?? {
        month,
        currency: doc.currency,
        issued: '0.00',
        paid: '0.00',
        count: 0,
      };
      months.set(k, row);
      return row;
    };
    let paid = D();
    if (date < period.from) {
      c.opening = c.opening.plus(amount);
      add(party, 'opening', amount);
    }
    if (inPeriod(date)) {
      c.issued = c.issued.plus(amount);
      c.count++;
      add(party, 'issued', amount);
      party.count = Number(party.count) + 1;
      add(group, 'issued', amount);
      group.count = Number(group.count) + 1;
      const month = monthRow(date.slice(0, 7));
      add(month, 'issued', amount);
      month.count = Number(month.count) + 1;
      ledger.push({
        id: `invoice:${doc.id}`,
        documentId: doc.id,
        partyId: doc.partyId,
        date,
        reference: doc.reference,
        party: doc.party,
        company: doc.company,
        branch: doc.branch,
        currency: doc.currency,
        type: 'Invoice',
        charge: amount.toFixed(2),
        payment: '0.00',
      });
    }
    if (date >= period.previousFrom && date <= period.previousTo)
      c.previous = c.previous.plus(amount);
    for (const p of doc.payments) {
      const pd = iso(p.date);
      if (pd > period.to) continue;
      paid = paid.plus(p.amount);
      if (pd < period.from) {
        c.opening = c.opening.minus(p.amount);
        add(party, 'opening', D(p.amount).negated());
      }
      if (inPeriod(pd)) {
        c.paid = c.paid.plus(p.amount);
        add(party, 'paid', p.amount);
        add(group, 'paid', p.amount);
        add(monthRow(pd.slice(0, 7)), 'paid', p.amount);
        const entry = {
          id: p.id,
          documentId: doc.id,
          partyId: doc.partyId,
          date: pd,
          reference: p.reference || doc.reference,
          invoice: doc.reference,
          party: doc.party,
          company: doc.company,
          branch: doc.branch,
          currency: doc.currency,
          amount: p.amount.toFixed(2),
        };
        payments.push(entry);
        ledger.push({ ...entry, type: 'Payment', charge: '0.00', payment: p.amount.toFixed(2) });
      }
    }
    const outstanding = amount.minus(paid),
      days = Math.max(
        0,
        Math.floor((new Date(period.to).getTime() - doc.dueDate.getTime()) / 86400000),
      );
    c.closing = c.closing.plus(outstanding);
    add(party, 'closing', outstanding);
    add(group, 'closing', outstanding);
    const age =
      days === 0
        ? 'current'
        : days <= 30
          ? 'days1to30'
          : days <= 60
            ? 'days31to60'
            : days <= 90
              ? 'days61to90'
              : 'days90plus';
    if (outstanding.gt(0)) {
      add(party, age, outstanding);
      if (days > 0) c.overdue = c.overdue.plus(outstanding);
      ageing.push({
        id: doc.id,
        partyId: doc.partyId,
        party: doc.party,
        reference: doc.reference,
        company: doc.company,
        branch: doc.branch,
        date,
        dueDate: iso(doc.dueDate),
        currency: doc.currency,
        outstanding: outstanding.toFixed(2),
        days,
        bucket: age,
      });
    }
    if (inPeriod(date))
      details.push({
        id: doc.id,
        partyId: doc.partyId,
        reference: doc.reference,
        party: doc.party,
        date,
        dueDate: iso(doc.dueDate),
        company: doc.company,
        division: doc.division,
        branch: doc.branch,
        currency: doc.currency,
        amount: amount.toFixed(2),
        paid: paid.toFixed(2),
        outstanding: outstanding.toFixed(2),
      });
  }
  ledger.sort(
    (a, b) =>
      String(a.date).localeCompare(String(b.date)) ||
      (a.type === b.type
        ? String(a.id).localeCompare(String(b.id))
        : a.type === 'Invoice'
          ? -1
          : 1),
  );
  const running = new Map([...currencies].map(([key, c]) => [key, c.opening]));
  for (const row of ledger) {
    const next = running.get(String(row.currency))!.plus(row.charge).minus(row.payment);
    running.set(String(row.currency), next);
    row.balance = next.toFixed(2);
  }
  const sortedParties = [...parties.values()].sort(
    (a, b) =>
      String(a.currency).localeCompare(String(b.currency)) || D(b.closing).comparedTo(D(a.closing)),
  );
  for (const currency of currencies.keys())
    for (
      let date = new Date(`${period.from.slice(0, 7)}-01`);
      iso(date).slice(0, 7) <= period.to.slice(0, 7);
      date.setUTCMonth(date.getUTCMonth() + 1)
    ) {
      const month = iso(date).slice(0, 7),
        key = `${month}:${currency}`;
      if (!months.has(key))
        months.set(key, { month, currency, issued: '0.00', paid: '0.00', count: 0 });
    }
  const tables: Table[] = [
    {
      id: 'parties',
      title: source === 'Sales Desk' ? 'Customers' : 'Suppliers',
      columns: [
        column('name', 'Name'),
        column('company', 'Company'),
        column('currency', 'Currency'),
        column('count', 'Invoices in period'),
        column('opening', 'Opening balance', true),
        column('issued', tradeLabel, true),
        column('paid', 'Payments in period', true),
        column('closing', 'Closing balance', true),
      ],
      rows: sortedParties,
    },
    {
      id: 'ageing',
      title: 'Ageing summary',
      columns: [
        column('name', 'Name'),
        column('currency', 'Currency'),
        column('current', 'Not overdue', true),
        column('days1to30', '1–30 days', true),
        column('days31to60', '31–60 days', true),
        column('days61to90', '61–90 days', true),
        column('days90plus', 'Over 90 days', true),
        column('closing', 'Balance', true),
      ],
      rows: sortedParties.filter((r) => D(r.closing).gt(0)),
    },
    {
      id: 'overdue',
      title: 'Outstanding invoices',
      columns: [
        column('reference', 'Invoice'),
        column('party', 'Name'),
        column('company', 'Company'),
        column('branch', 'Branch'),
        column('dueDate', 'Due date'),
        column('days', 'Days overdue'),
        column('currency', 'Currency'),
        column('outstanding', 'Outstanding', true),
      ],
      rows: ageing.sort((a, b) => Number(b.days) - Number(a.days)),
    },
    {
      id: 'documents',
      title: 'Invoices in period',
      columns: [
        column('reference', 'Invoice'),
        column('party', 'Name'),
        column('date', 'Date'),
        column('company', 'Company'),
        column('division', 'Division'),
        column('branch', 'Branch'),
        column('currency', 'Currency'),
        column('amount', 'Amount', true),
        column('paid', 'Paid by period end', true),
        column('outstanding', 'Balance', true),
      ],
      rows: details.sort((a, b) => String(b.date).localeCompare(String(a.date))),
    },
    {
      id: 'payments',
      title: 'Payments in period',
      columns: [
        column('date', 'Date'),
        column('party', 'Name'),
        column('invoice', 'Invoice'),
        column('reference', 'Reference'),
        column('company', 'Company'),
        column('branch', 'Branch'),
        column('currency', 'Currency'),
        column('amount', 'Amount', true),
      ],
      rows: payments.sort((a, b) => String(b.date).localeCompare(String(a.date))),
    },
    {
      id: 'statement',
      title: 'Account statement',
      columns: [
        column('date', 'Date'),
        column('party', 'Name'),
        column('reference', 'Reference'),
        column('type', 'Entry'),
        column('currency', 'Currency'),
        column('charge', 'Invoiced', true),
        column('payment', 'Payment', true),
        column('balance', 'Running balance', true),
      ],
      rows: ledger,
    },
    {
      id: 'branches',
      title: 'Branch breakdown',
      columns: [
        column('company', 'Company'),
        column('division', 'Division'),
        column('branch', 'Branch'),
        column('currency', 'Currency'),
        column('count', 'Invoices'),
        column('issued', tradeLabel, true),
        column('paid', 'Payments in period', true),
        column('closing', 'Closing balance', true),
      ],
      rows: [...groups.values()],
    },
    {
      id: 'monthly',
      title: 'Monthly trend',
      columns: [
        column('month', 'Month'),
        column('currency', 'Currency'),
        column('count', 'Invoices'),
        column('issued', tradeLabel, true),
        column('paid', 'Payments in period', true),
      ],
      rows: [...months.values()].sort((a, b) => String(a.month).localeCompare(String(b.month))),
    },
  ];
  return {
    source,
    period,
    generatedAt: new Date().toISOString(),
    basis:
      'Reconstructed from currently valid invoices and unreversed payments through the period end. Later voids, reversals and edits restate earlier periods; this is not a locked historical ledger.',
    currencies: [...currencies.values()].map((c) => ({
      ...c,
      opening: c.opening.toFixed(2),
      issued: c.issued.toFixed(2),
      paid: c.paid.toFixed(2),
      closing: c.closing.toFixed(2),
      overdue: c.overdue.toFixed(2),
      previous: c.previous.toFixed(2),
      change: c.previous.isZero()
        ? null
        : c.issued.minus(c.previous).div(c.previous).mul(100).toFixed(1),
    })),
    tables,
  };
}
