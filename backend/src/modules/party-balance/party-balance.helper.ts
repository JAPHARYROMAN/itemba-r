import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type PartyKind = 'supplier' | 'customer';
type Db = PrismaService | Prisma.TransactionClient;

/** Payable / receivable statuses that still carry an outstanding balance. */
export const OPEN_DOCUMENT_STATUSES = ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] as const;

const ZERO = new Prisma.Decimal(0);
const money = (value: Prisma.Decimal) => value.toFixed(2);
const utcDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const dayDiff = (from: Date, to: Date) =>
  Math.floor((utcDay(to).getTime() - utcDay(from).getTime()) / 86400000);

export interface PartyBalanceErpBucket {
  currency: string;
  /** Open outstanding across every open document. */
  open: string;
  /** Portion past its due date (derived from dueDate, never from a stored status). */
  overdue: string;
  /** Not yet due, or no due date. */
  current: string;
  days1to30: string;
  days31to60: string;
  days61to90: string;
  over90: string;
  documents: number;
}

export interface PartyBalanceDeskBucket {
  currency: string;
  outstanding: string;
  overdue: string;
  documents: number;
}

export interface PartyBalanceNotebookBucket {
  currency: string;
  outstanding: string;
  records: number;
}

export interface PartyBalance {
  kind: PartyKind;
  partyId: string;
  companyId: string;
  asOf: string;
  baseCurrency: string;
  /** ERP sub-ledger: payables (supplier) or receivables (customer). */
  erp: PartyBalanceErpBucket[];
  advances: Array<{ currency: string; amount: string }>;
  /** Desk ledger: unpromoted Invoice Desk invoices or Sales Desk sales for the canonical party. */
  desk: PartyBalanceDeskBucket[];
  /** NoteBook creditor / debtor records linked to the party. Informal; never part of `total`. */
  notebook: PartyBalanceNotebookBucket[];
  /** erp.open + desk.outstanding, per currency. */
  total: Array<{ currency: string; amount: string }>;
  creditLimit: string;
  /** creditLimit minus the base-currency total; null when no limit is set. */
  creditAvailable: string | null;
  /** The cached Supplier.currentBalance / Customer.currentBalance, for comparison. */
  cached: string;
  lastPaymentAt: string | null;
}

export async function baseCurrencyFor(db: Db, companyId: string): Promise<string> {
  const profile = await db.companyProfile.findUnique({
    where: { companyId },
    select: { currency: true },
  });
  return profile?.currency ?? 'TZS';
}

/**
 * The single writer of Supplier.currentBalance / Customer.currentBalance (party linkage,
 * W5). Rule: the party's open ERP outstanding in the company's base currency. Every module
 * that used to keep its own copy of this calculation delegates here, so the cache can no
 * longer disagree with itself. The cache is a convenience for lists and quick checks; the
 * live, currency-aware figure is `computePartyBalance`.
 */
export async function refreshCachedPartyBalance(
  db: Db,
  kind: PartyKind,
  companyId: string,
  partyId?: string | null,
): Promise<void> {
  if (!partyId) return;
  const currency = (await baseCurrencyFor(db, companyId)) as never;
  const status = { in: [...OPEN_DOCUMENT_STATUSES] as never };
  if (kind === 'supplier') {
    const sum = await db.payable.aggregate({
      where: { companyId, supplierId: partyId, deletedAt: null, currency, status },
      _sum: { outstandingAmount: true },
    });
    const advances = await db.supplierPayment.aggregate({
      where: {
        companyId,
        supplierId: partyId,
        currency,
        status: 'COMPLETED',
        deletedAt: null,
        purchaseAdvance: { isNot: null },
      },
      _sum: { unappliedAmount: true },
    });
    await db.supplier.updateMany({
      where: { id: partyId, companyId, deletedAt: null },
      data: {
        currentBalance: new Prisma.Decimal(sum._sum.outstandingAmount ?? 0).minus(
          advances._sum.unappliedAmount ?? 0,
        ),
      },
    });
    return;
  }
  const sum = await db.receivable.aggregate({
    where: { companyId, customerId: partyId, deletedAt: null, currency, status },
    _sum: { outstandingAmount: true },
  });
  await db.customer.updateMany({
    where: { id: partyId, companyId, deletedAt: null },
    data: { currentBalance: sum._sum.outstandingAmount ?? 0 },
  });
}

/**
 * What a customer owes right now across the two ledgers that carry customer debt: open
 * receivables and unpromoted Sales Desk sales. Used by the credit-limit check instead of
 * the cached balance alone. Credit limits are denominated in the company's base currency;
 * foreign-currency credit requires an explicit conversion policy before it can be checked.
 */
export async function liveCustomerExposure(
  db: Db,
  companyId: string,
  customerId: string,
  denomination?: string,
): Promise<number> {
  const baseCurrency = await baseCurrencyFor(db, companyId);
  if (denomination && denomination !== baseCurrency) {
    throw new BadRequestException(
      `Customer credit limits are denominated in ${baseCurrency}. A ${denomination} credit sale requires an explicit currency conversion before checking this limit.`,
    );
  }
  const currency = baseCurrency as never;
  const [receivables, deskSales] = await Promise.all([
    db.receivable.aggregate({
      where: {
        companyId,
        customerId,
        currency,
        deletedAt: null,
        status: { in: [...OPEN_DOCUMENT_STATUSES] as never },
      },
      _sum: { outstandingAmount: true },
    }),
    db.salesDeskSale.findMany({
      where: {
        companyId,
        currency,
        voidedAt: null,
        canonicalSalesOrderId: null,
        customer: { canonicalCustomerId: customerId },
      },
      select: { totalAmount: true, paidAmount: true },
    }),
  ]);
  const desk = deskSales.reduce(
    (sum, s) => sum.plus(new Prisma.Decimal(s.totalAmount).minus(s.paidAmount)),
    ZERO,
  );
  return Number(new Prisma.Decimal(receivables._sum.outstandingAmount ?? 0).plus(desk));
}

interface PartyRow {
  id: string;
  companyId: string;
  creditLimit: Prisma.Decimal | number | string;
  currentBalance: Prisma.Decimal | number | string;
}

/**
 * The one balance computation (party linkage, W5): ERP sub-ledger with date-based overdue
 * and aging, the desk ledger, and the NoteBook, per currency, plus credit position.
 * Everything that shows "what does this party owe / is owed" reads this.
 */
export async function computePartyBalance(
  db: Db,
  kind: PartyKind,
  party: PartyRow,
  asOf: Date = new Date(),
): Promise<PartyBalance> {
  const { id, companyId } = party;
  const status = { in: [...OPEN_DOCUMENT_STATUSES] as never };
  const [baseCurrency, erpRows, deskRows, notebookRows, lastPayment] = await Promise.all([
    baseCurrencyFor(db, companyId),
    kind === 'supplier'
      ? db.payable.findMany({
          where: { companyId, supplierId: id, deletedAt: null, status },
          select: { currency: true, outstandingAmount: true, dueDate: true },
        })
      : db.receivable.findMany({
          where: { companyId, customerId: id, deletedAt: null, status },
          select: { currency: true, outstandingAmount: true, dueDate: true },
        }),
    kind === 'supplier'
      ? db.invoiceDeskInvoice.findMany({
          where: {
            companyId,
            voidedAt: null,
            canonicalInvoiceId: null,
            supplier: { canonicalSupplierId: id },
          },
          select: { currency: true, totalAmount: true, paidAmount: true, dueDate: true },
        })
      : db.salesDeskSale.findMany({
          where: {
            companyId,
            voidedAt: null,
            canonicalSalesOrderId: null,
            customer: { canonicalCustomerId: id },
          },
          select: { currency: true, totalAmount: true, paidAmount: true, dueDate: true },
        }),
    db.recordEntry.findMany({
      where: {
        companyId,
        voidedAt: null,
        ...(kind === 'supplier'
          ? { kind: 'CREDITOR', supplierId: id }
          : { kind: 'DEBTOR', customerId: id }),
      },
      select: { currency: true, amount: true, settledAmount: true },
    }),
    kind === 'supplier'
      ? db.supplierPayment.findFirst({
          where: { companyId, supplierId: id, status: 'COMPLETED', deletedAt: null },
          orderBy: { paymentDate: 'desc' },
          select: { paymentDate: true },
        })
      : db.customerPayment.findFirst({
          where: { companyId, customerId: id, status: 'COMPLETED', deletedAt: null },
          orderBy: { paymentDate: 'desc' },
          select: { paymentDate: true },
        }),
  ]);

  const erp = new Map<
    string,
    { open: Prisma.Decimal; buckets: Prisma.Decimal[]; documents: number }
  >();
  for (const row of erpRows) {
    const outstanding = new Prisma.Decimal(row.outstandingAmount);
    if (outstanding.lte(0)) continue;
    const bucket = erp.get(row.currency) ?? {
      open: ZERO,
      buckets: [ZERO, ZERO, ZERO, ZERO, ZERO],
      documents: 0,
    };
    bucket.open = bucket.open.plus(outstanding);
    bucket.documents += 1;
    const days = row.dueDate ? dayDiff(row.dueDate, asOf) : 0;
    const index = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
    bucket.buckets[index] = bucket.buckets[index].plus(outstanding);
    erp.set(row.currency, bucket);
  }

  const desk = new Map<
    string,
    { outstanding: Prisma.Decimal; overdue: Prisma.Decimal; documents: number }
  >();
  for (const row of deskRows) {
    const balance = new Prisma.Decimal(row.totalAmount).minus(row.paidAmount);
    if (balance.lte(0)) continue;
    const bucket = desk.get(row.currency) ?? { outstanding: ZERO, overdue: ZERO, documents: 0 };
    bucket.outstanding = bucket.outstanding.plus(balance);
    if (row.dueDate && row.dueDate < utcDay(asOf)) bucket.overdue = bucket.overdue.plus(balance);
    bucket.documents += 1;
    desk.set(row.currency, bucket);
  }

  const notebook = new Map<string, { outstanding: Prisma.Decimal; records: number }>();
  for (const row of notebookRows) {
    const balance = new Prisma.Decimal(row.amount).minus(row.settledAmount);
    if (balance.lte(0)) continue;
    const bucket = notebook.get(row.currency) ?? { outstanding: ZERO, records: 0 };
    bucket.outstanding = bucket.outstanding.plus(balance);
    bucket.records += 1;
    notebook.set(row.currency, bucket);
  }

  const advances = new Map<string, Prisma.Decimal>();
  if (kind === 'supplier') {
    const groups = await db.supplierPayment.groupBy({
      by: ['currency'],
      where: {
        companyId,
        supplierId: id,
        status: 'COMPLETED',
        deletedAt: null,
        purchaseAdvance: { isNot: null },
        unappliedAmount: { gt: 0 },
      },
      _sum: { unappliedAmount: true },
    });
    for (const g of groups)
      advances.set(g.currency, new Prisma.Decimal(g._sum.unappliedAmount ?? 0));
  }
  const currencies = new Set([...erp.keys(), ...desk.keys(), ...advances.keys()]);
  const total = [...currencies].sort().map((currency) => ({
    currency,
    amount: money(
      (erp.get(currency)?.open ?? ZERO)
        .plus(desk.get(currency)?.outstanding ?? ZERO)
        .minus(advances.get(currency) ?? ZERO),
    ),
  }));
  const creditLimit = new Prisma.Decimal(party.creditLimit ?? 0);
  const baseTotal = new Prisma.Decimal(total.find((t) => t.currency === baseCurrency)?.amount ?? 0);

  return {
    kind,
    partyId: id,
    companyId,
    asOf: asOf.toISOString(),
    baseCurrency,
    advances: [...advances]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, amount]) => ({ currency, amount: money(amount) })),
    erp: [...erp.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, b]) => ({
        currency,
        open: money(b.open),
        overdue: money(b.buckets[1].plus(b.buckets[2]).plus(b.buckets[3]).plus(b.buckets[4])),
        current: money(b.buckets[0]),
        days1to30: money(b.buckets[1]),
        days31to60: money(b.buckets[2]),
        days61to90: money(b.buckets[3]),
        over90: money(b.buckets[4]),
        documents: b.documents,
      })),
    desk: [...desk.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, b]) => ({
        currency,
        outstanding: money(b.outstanding),
        overdue: money(b.overdue),
        documents: b.documents,
      })),
    notebook: [...notebook.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, b]) => ({
        currency,
        outstanding: money(b.outstanding),
        records: b.records,
      })),
    total,
    creditLimit: money(creditLimit),
    creditAvailable: creditLimit.gt(0)
      ? money(Prisma.Decimal.max(creditLimit.minus(baseTotal), ZERO))
      : null,
    cached: money(new Prisma.Decimal(party.currentBalance ?? 0)),
    lastPaymentAt: lastPayment?.paymentDate?.toISOString() ?? null,
  };
}

/** A party's balance in list form: the same split as `PartyBalance`, without aging. */
export interface PartyBalanceSummary {
  kind: PartyKind;
  partyId: string;
  companyId: string;
  name: string;
  code: string;
  baseCurrency: string;
  erp: Array<{ currency: string; open: string; overdue: string; documents: number }>;
  advances: Array<{ currency: string; amount: string }>;
  desk: Array<{ currency: string; outstanding: string; overdue: string; documents: number }>;
  notebook: PartyBalanceNotebookBucket[];
  /** erp.open + desk.outstanding, per currency. */
  total: Array<{ currency: string; amount: string }>;
  /** erp.overdue + desk.overdue, per currency. */
  overdue: Array<{ currency: string; amount: string }>;
  creditLimit: string;
  creditAvailable: string | null;
  cached: string;
  lastPaymentAt: string | null;
}

/** The company scope a list read runs under (CompanyScopeService.companyWhereFor). */
export type PartyCompanyWhere = { companyId?: string | { in: string[] }; id?: { in: string[] } };

type Grouped = { partyId: string; currency: string; amount: Prisma.Decimal; count: number };
type Buckets = Map<string, Map<string, { amount: Prisma.Decimal; count: number }>>;
const decimal = (value: Prisma.Decimal | number | string | null | undefined) =>
  new Prisma.Decimal(value ?? 0);
/** Sums grouped rows per party and currency; two desk parties mapped to one canonical add up. */
const bucket = (rows: Grouped[]): Buckets => {
  const map: Buckets = new Map();
  for (const row of rows) {
    if (row.amount.lte(0)) continue;
    const party = map.get(row.partyId) ?? new Map();
    const current = party.get(row.currency) ?? { amount: ZERO, count: 0 };
    current.amount = current.amount.plus(row.amount);
    current.count += row.count;
    party.set(row.currency, current);
    map.set(row.partyId, party);
  }
  return map;
};
const sortedEntries = (map?: Map<string, { amount: Prisma.Decimal; count: number }>) =>
  [...(map?.entries() ?? [])].sort(([a], [b]) => a.localeCompare(b));

/**
 * The list form of the resolver (party linkage, Phase 2): every supplier or customer in the
 * company scope that owes or is owed anything, computed set-wise with grouped queries, never
 * a per-party loop. Same rules as `computePartyBalance`: open documents only, rows with no
 * balance ignored, overdue by due date, NoteBook listed but never in the total. Cash Desk
 * balances and Sales collections read this; profiles read the per-party form for aging.
 */
export async function computePartyBalanceList(
  db: Db,
  kind: PartyKind,
  companyWhere: PartyCompanyWhere,
  asOf: Date = new Date(),
): Promise<PartyBalanceSummary[]> {
  const status = { in: [...OPEN_DOCUMENT_STATUSES] as never };
  const parties: Array<{
    id: string;
    companyId: string;
    name: string;
    code: string;
    creditLimit: Prisma.Decimal;
    currentBalance: Prisma.Decimal;
  }> =
    kind === 'supplier'
      ? (
          await db.supplier.findMany({
            where: { ...companyWhere, deletedAt: null },
            select: {
              id: true,
              companyId: true,
              name: true,
              supplierCode: true,
              creditLimit: true,
              currentBalance: true,
            },
          })
        ).map((s) => ({ ...s, code: s.supplierCode }))
      : (
          await db.customer.findMany({
            where: { ...companyWhere, deletedAt: null },
            select: {
              id: true,
              companyId: true,
              name: true,
              customerCode: true,
              creditLimit: true,
              currentBalance: true,
            },
          })
        ).map((c) => ({ ...c, code: c.customerCode }));
  if (!parties.length) return [];
  const overdueBefore = utcDay(asOf);

  const erpWhere = { ...companyWhere, deletedAt: null, status, outstandingAmount: { gt: 0 } };
  const erpOpen: Grouped[] =
    kind === 'supplier'
      ? (
          await db.payable.groupBy({
            by: ['supplierId', 'currency'],
            where: { ...erpWhere, supplierId: { not: null } },
            _sum: { outstandingAmount: true },
            _count: { _all: true },
          })
        ).map((g) => ({
          partyId: g.supplierId as string,
          currency: g.currency,
          amount: decimal(g._sum.outstandingAmount),
          count: g._count._all,
        }))
      : (
          await db.receivable.groupBy({
            by: ['customerId', 'currency'],
            where: { ...erpWhere, customerId: { not: null } },
            _sum: { outstandingAmount: true },
            _count: { _all: true },
          })
        ).map((g) => ({
          partyId: g.customerId as string,
          currency: g.currency,
          amount: decimal(g._sum.outstandingAmount),
          count: g._count._all,
        }));
  const erpOverdue: Grouped[] =
    kind === 'supplier'
      ? (
          await db.payable.groupBy({
            by: ['supplierId', 'currency'],
            where: { ...erpWhere, supplierId: { not: null }, dueDate: { lt: overdueBefore } },
            _sum: { outstandingAmount: true },
          })
        ).map((g) => ({
          partyId: g.supplierId as string,
          currency: g.currency,
          amount: decimal(g._sum.outstandingAmount),
          count: 0,
        }))
      : (
          await db.receivable.groupBy({
            by: ['customerId', 'currency'],
            where: { ...erpWhere, customerId: { not: null }, dueDate: { lt: overdueBefore } },
            _sum: { outstandingAmount: true },
          })
        ).map((g) => ({
          partyId: g.customerId as string,
          currency: g.currency,
          amount: decimal(g._sum.outstandingAmount),
          count: 0,
        }));

  // Desk documents are grouped by their desk party, then mapped to the canonical party.
  const deskRows: Array<Grouped & { overdue: boolean }> = [];
  if (kind === 'supplier') {
    const where = {
      ...companyWhere,
      voidedAt: null,
      canonicalInvoiceId: null,
      supplier: { canonicalSupplierId: { not: null } },
      paidAmount: { lt: db.invoiceDeskInvoice.fields.totalAmount },
    };
    for (const overdue of [false, true]) {
      const groups = await db.invoiceDeskInvoice.groupBy({
        by: ['supplierId', 'currency'],
        where: overdue ? { ...where, dueDate: { lt: overdueBefore } } : where,
        _sum: { totalAmount: true, paidAmount: true },
        _count: { _all: true },
      });
      for (const g of groups)
        deskRows.push({
          partyId: g.supplierId,
          currency: g.currency,
          amount: decimal(g._sum.totalAmount).minus(decimal(g._sum.paidAmount)),
          count: g._count._all,
          overdue,
        });
    }
  } else {
    const where = {
      ...companyWhere,
      voidedAt: null,
      canonicalSalesOrderId: null,
      customer: { canonicalCustomerId: { not: null } },
      paidAmount: { lt: db.salesDeskSale.fields.totalAmount },
    };
    for (const overdue of [false, true]) {
      const groups = await db.salesDeskSale.groupBy({
        by: ['customerId', 'currency'],
        where: overdue ? { ...where, dueDate: { lt: overdueBefore } } : where,
        _sum: { totalAmount: true, paidAmount: true },
        _count: { _all: true },
      });
      for (const g of groups)
        deskRows.push({
          partyId: g.customerId,
          currency: g.currency,
          amount: decimal(g._sum.totalAmount).minus(decimal(g._sum.paidAmount)),
          count: g._count._all,
          overdue,
        });
    }
  }
  const deskPartyIds = [...new Set(deskRows.map((r) => r.partyId))];
  const canonical = new Map<string, string>();
  if (deskPartyIds.length) {
    const links =
      kind === 'supplier'
        ? (
            await db.invoiceDeskSupplier.findMany({
              where: { id: { in: deskPartyIds } },
              select: { id: true, canonicalSupplierId: true },
            })
          ).map((s) => [s.id, s.canonicalSupplierId] as const)
        : (
            await db.salesDeskCustomer.findMany({
              where: { id: { in: deskPartyIds } },
              select: { id: true, canonicalCustomerId: true },
            })
          ).map((c) => [c.id, c.canonicalCustomerId] as const);
    for (const [id, canonicalId] of links) if (canonicalId) canonical.set(id, canonicalId);
  }
  const deskCanonical = (overdue: boolean) =>
    deskRows.flatMap((r) => {
      const partyId = canonical.get(r.partyId);
      return r.overdue === overdue && partyId ? [{ ...r, partyId }] : [];
    });

  const notebookRows: Grouped[] =
    kind === 'supplier'
      ? (
          await db.recordEntry.groupBy({
            by: ['supplierId', 'currency'],
            where: {
              ...companyWhere,
              voidedAt: null,
              kind: 'CREDITOR',
              supplierId: { not: null },
              settledAmount: { lt: db.recordEntry.fields.amount },
            },
            _sum: { amount: true, settledAmount: true },
            _count: { _all: true },
          })
        ).map((g) => ({
          partyId: g.supplierId as string,
          currency: g.currency,
          amount: decimal(g._sum.amount).minus(decimal(g._sum.settledAmount)),
          count: g._count._all,
        }))
      : (
          await db.recordEntry.groupBy({
            by: ['customerId', 'currency'],
            where: {
              ...companyWhere,
              voidedAt: null,
              kind: 'DEBTOR',
              customerId: { not: null },
              settledAmount: { lt: db.recordEntry.fields.amount },
            },
            _sum: { amount: true, settledAmount: true },
            _count: { _all: true },
          })
        ).map((g) => ({
          partyId: g.customerId as string,
          currency: g.currency,
          amount: decimal(g._sum.amount).minus(decimal(g._sum.settledAmount)),
          count: g._count._all,
        }));

  const lastPayments = new Map<string, Date | null>(
    kind === 'supplier'
      ? (
          await db.supplierPayment.groupBy({
            by: ['supplierId'],
            where: { ...companyWhere, status: 'COMPLETED', deletedAt: null },
            _max: { paymentDate: true },
          })
        ).map((g) => [g.supplierId, g._max.paymentDate] as const)
      : (
          await db.customerPayment.groupBy({
            by: ['customerId'],
            where: { ...companyWhere, status: 'COMPLETED', deletedAt: null },
            _max: { paymentDate: true },
          })
        ).map((g) => [g.customerId, g._max.paymentDate] as const),
  );
  const profiles = await db.companyProfile.findMany({
    where: { companyId: { in: [...new Set(parties.map((p) => p.companyId))] } },
    select: { companyId: true, currency: true },
  });
  const baseCurrencies = new Map(profiles.map((p) => [p.companyId, p.currency as string]));

  const advanceRows: Grouped[] =
    kind === 'supplier'
      ? (
          await db.supplierPayment.groupBy({
            by: ['supplierId', 'currency'],
            where: {
              ...companyWhere,
              status: 'COMPLETED',
              deletedAt: null,
              purchaseAdvance: { isNot: null },
              unappliedAmount: { gt: 0 },
            },
            _sum: { unappliedAmount: true },
          })
        ).map((g) => ({
          partyId: g.supplierId,
          currency: g.currency,
          amount: decimal(g._sum.unappliedAmount),
          count: 0,
        }))
      : [];
  const advancesBy = bucket(advanceRows);
  const erpOpenBy = bucket(erpOpen),
    erpOverdueBy = bucket(erpOverdue),
    deskOpenBy = bucket(deskCanonical(false)),
    deskOverdueBy = bucket(deskCanonical(true)),
    notebookBy = bucket(notebookRows);
  const summaries: PartyBalanceSummary[] = [];
  for (const party of parties) {
    const erp = erpOpenBy.get(party.id),
      desk = deskOpenBy.get(party.id),
      notebook = notebookBy.get(party.id),
      advances = advancesBy.get(party.id);
    if (!erp && !desk && !notebook && !advances) continue;
    const erpLate = erpOverdueBy.get(party.id),
      deskLate = deskOverdueBy.get(party.id);
    const currencies = [
      ...new Set([...(erp?.keys() ?? []), ...(desk?.keys() ?? []), ...(advances?.keys() ?? [])]),
    ].sort();
    const total = currencies.map((currency) => ({
      currency,
      amount: money(
        (erp?.get(currency)?.amount ?? ZERO)
          .plus(desk?.get(currency)?.amount ?? ZERO)
          .minus(advances?.get(currency)?.amount ?? ZERO),
      ),
    }));
    const overdue = currencies.map((currency) => ({
      currency,
      amount: money(
        (erpLate?.get(currency)?.amount ?? ZERO).plus(deskLate?.get(currency)?.amount ?? ZERO),
      ),
    }));
    const baseCurrency = baseCurrencies.get(party.companyId) ?? 'TZS';
    const creditLimit = decimal(party.creditLimit);
    const baseTotal = decimal(total.find((t) => t.currency === baseCurrency)?.amount);
    summaries.push({
      kind,
      partyId: party.id,
      companyId: party.companyId,
      name: party.name,
      code: party.code,
      baseCurrency,
      advances: sortedEntries(advances).map(([currency, b]) => ({
        currency,
        amount: money(b.amount),
      })),
      erp: sortedEntries(erp).map(([currency, b]) => ({
        currency,
        open: money(b.amount),
        overdue: money(erpLate?.get(currency)?.amount ?? ZERO),
        documents: b.count,
      })),
      desk: sortedEntries(desk).map(([currency, b]) => ({
        currency,
        outstanding: money(b.amount),
        overdue: money(deskLate?.get(currency)?.amount ?? ZERO),
        documents: b.count,
      })),
      notebook: sortedEntries(notebook).map(([currency, b]) => ({
        currency,
        outstanding: money(b.amount),
        records: b.count,
      })),
      total,
      overdue,
      creditLimit: money(creditLimit),
      creditAvailable: creditLimit.gt(0)
        ? money(Prisma.Decimal.max(creditLimit.minus(baseTotal), ZERO))
        : null,
      cached: money(decimal(party.currentBalance)),
      lastPaymentAt: lastPayments.get(party.id)?.toISOString() ?? null,
    });
  }
  const baseTotalOf = (s: PartyBalanceSummary) =>
    decimal(s.total.find((t) => t.currency === s.baseCurrency)?.amount);
  return summaries.sort(
    (a, b) => baseTotalOf(b).comparedTo(baseTotalOf(a)) || a.name.localeCompare(b.name),
  );
}
