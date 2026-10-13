import { BadRequestException, Injectable } from '@nestjs/common';
import { CurrencyCode, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { dateRangeEnd } from '../../common/utils/date-range';
import { CONVENTIONAL_CODES } from '../../common/services/account-resolver.service';
import { recoverSettlementHistory } from '../../common/utils/settlement-history';
import {
  CustomerAccountMovement,
  CustomerAccountProjection,
  CustomerAccountQuery,
  CustomerAccountSnapshot,
} from './customer-account-projection.types';

const D = (n: Prisma.Decimal | string | number = 0) => new Prisma.Decimal(n);
const MAX_ROWS = 20000;
// Explicitly include historical soft-deleted records: posted facts are not erased
// by a source's later deletion. Records without lifecycle evidence are flagged.
const historical = { OR: [{ deletedAt: null }, { deletedAt: { not: null } }] };
const journalHistory = { include: { reversedBy_: true } } as const;
type SourceRows = {
  customers: any[];
  sales: any[];
  receivables: any[];
  payments: any[];
  creditNotes: any[];
  refunds: any[];
  journals: any[];
  roleAccounts?: Record<string, Partial<Record<'AR_CONTROL' | 'CASH_ON_HAND' | 'BANK', string>>>;
  sourceEdits?: any[];
};
const date = (value: Date | string) => new Date(value);
const eligibleJournal = (journal: any) =>
  journal && ['POSTED', 'REVERSED'].includes(journal.status);
const roleLine = (
  line: any,
  role: 'AR_CONTROL' | 'CASH_ON_HAND' | 'BANK',
  companyId: string,
  accounts?: SourceRows['roleAccounts'],
) =>
  accounts
    ? !!accounts[companyId]?.[role] &&
      (line.accountId ?? line.account?.id) === accounts[companyId]?.[role]
    : line.account?.accountSubType?.toLowerCase() === role.toLowerCase() ||
      CONVENTIONAL_CODES[role].includes(line.account?.accountCode);
const reversalDate = (row: any): Date | null => {
  const dates = [
    eligibleJournal(row.reversalJournalEntry) ? row.reversalJournalEntry.transactionDate : null,
    ...(row.journalEntry?.reversedBy_ ?? [])
      .filter(eligibleJournal)
      .map((j: any) => j.transactionDate),
  ]
    .filter(Boolean)
    .map(date);
  if (!dates.length && row.reversedAt && !row.journalEntryId && !row.journalEntry)
    dates.push(date(row.reversedAt));
  return dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
};

@Injectable()
export class CustomerAccountProjectionService {
  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
  ) {}

  async read(user: AuthUser, query: CustomerAccountQuery): Promise<CustomerAccountProjection> {
    const asOf = dateRangeEnd(query.dateTo);
    if (isNaN(asOf.getTime())) throw new BadRequestException('Invalid statement closing date');
    const currency = query.currency ?? CurrencyCode.TZS;
    if (!Object.values(CurrencyCode).includes(currency))
      throw new BadRequestException('Invalid statement currency');
    const grants = await this.org.accessibleIds(user);
    const matchesScope = (row: { divisionId?: string | null; branchId?: string | null }) =>
      (!query.divisionId || row.divisionId === query.divisionId) &&
      (!query.branchId || row.branchId === query.branchId) &&
      (grants.unrestricted ||
        grants.divisionIds.includes(row.divisionId ?? '') ||
        grants.branchIds.includes(row.branchId ?? ''));
    const companyScope = await this.companies.companyWhereFor(user, query.companyId);
    const businessScope = {
      AND: [
        companyScope,
        await this.org.recordWhereFor(user),
        {
          ...(query.divisionId ? { divisionId: query.divisionId } : {}),
          ...(query.branchId ? { branchId: query.branchId } : {}),
        },
      ],
    };
    return this.db.$transaction(
      async (tx) => {
        const customers = await tx.customer.findMany({
          where: {
            deletedAt: null,
            AND: [companyScope, ...(query.customerIds ? [{ id: { in: query.customerIds } }] : [])],
          },
          include: {
            company: { select: { id: true, name: true, code: true, email: true, phone: true } },
          },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: MAX_ROWS + 1,
        });
        this.checkRows(customers);
        const customerId = { in: customers.map((c) => c.id) };
        const sourceScope = { AND: [...businessScope.AND, historical], currency, customerId };
        const [sales, receivables, payments, creditNotes, refunds] = await Promise.all([
          tx.salesOrder.findMany({
            where: { ...sourceScope, status: { not: 'DRAFT' } },
            take: MAX_ROWS + 1,
          }),
          tx.receivable.findMany({
            where: sourceScope,
            include: { journalEntry: journalHistory },
            take: MAX_ROWS + 1,
          }),
          tx.customerPayment.findMany({
            where: {
              AND: [
                companyScope,
                historical,
                {
                  OR: [
                    { AND: businessScope.AND },
                    { allocations: { some: { receivable: { is: sourceScope } } } },
                  ],
                },
              ],
              currency,
              customerId,
              status: { in: ['COMPLETED', 'REVERSED'] },
            },
            include: {
              journalEntry: journalHistory,
              reversalJournalEntry: true,
              _count: { select: { allocations: true } },
              allocations: {
                where: { receivable: { is: sourceScope } },
                include: { receivable: true },
              },
            },
            take: MAX_ROWS + 1,
          }),
          tx.creditNote.findMany({
            where: { ...sourceScope, issueDate: { lte: asOf }, status: { in: ['ISSUED', 'VOID'] } },
            include: { journalEntry: journalHistory },
            take: MAX_ROWS + 1,
          }),
          tx.refund.findMany({
            where: { ...sourceScope, refundDate: { lte: asOf }, status: { in: ['PAID', 'VOID'] } },
            include: { journalEntry: journalHistory },
            take: MAX_ROWS + 1,
          }),
        ]);
        [sales, receivables, payments, creditNotes, refunds].forEach((rows) =>
          this.checkRows(rows),
        );
        const journals = await tx.journalEntry.findMany({
          where: {
            AND: [...businessScope.AND, historical],
            status: { in: ['POSTED', 'REVERSED'] },
            OR: [
              {
                id: {
                  in: receivables.flatMap((r) => (r.journalEntryId ? [r.journalEntryId] : [])),
                },
              },
              { referenceType: 'Receivable', referenceId: { in: receivables.map((r) => r.id) } },
              { referenceType: 'SalesOrder', referenceId: { in: sales.map((s) => s.id) } },
              {
                id: {
                  in: refunds.flatMap((r) =>
                    r.reversalJournalEntryId ? [r.reversalJournalEntryId] : [],
                  ),
                },
              },
            ],
          },
          include: {
            reversedBy_: {
              include: {
                lines: {
                  include: {
                    account: {
                      select: { accountCode: true, accountSubType: true, accountType: true },
                    },
                  },
                },
              },
            },
            lines: {
              include: {
                account: { select: { accountCode: true, accountSubType: true, accountType: true } },
              },
            },
          },
          take: MAX_ROWS + 1,
        });
        this.checkRows(journals);
        const sourceEdits = await tx.auditLog.findMany({
          where: {
            ...companyScope,
            action: 'RECEIVABLE_UPDATE',
            entityType: 'Receivable',
            OR: [
              { entityId: { in: receivables.map((r) => r.id) } },
              ...(query.customerIds ?? []).map((id) => ({
                oldValue: { path: ['customerId'], equals: id },
              })),
            ],
          },
          select: {
            entityId: true,
            companyId: true,
            oldValue: true,
            newValue: true,
            createdAt: true,
          },
          take: MAX_ROWS + 1,
        });
        this.checkRows(sourceEdits);
        const chart = await tx.chartOfAccount.findMany({
          where: {
            companyId: { in: [...new Set(customers.map((c) => c.companyId))] },
            isActive: true,
            deletedAt: null,
            OR: [
              {
                accountSubType: { in: ['ar_control', 'cash_on_hand', 'bank'], mode: 'insensitive' },
              },
              {
                accountCode: {
                  in: [
                    ...CONVENTIONAL_CODES.AR_CONTROL,
                    ...CONVENTIONAL_CODES.CASH_ON_HAND,
                    ...CONVENTIONAL_CODES.BANK,
                  ],
                },
              },
            ],
          },
          select: { id: true, companyId: true, accountCode: true, accountSubType: true },
        });
        const roleAccounts: NonNullable<SourceRows['roleAccounts']> = {};
        for (const companyId of [...new Set(customers.map((c) => c.companyId))]) {
          roleAccounts[companyId] = {};
          for (const role of ['AR_CONTROL', 'CASH_ON_HAND', 'BANK'] as const) {
            const companyChart = chart.filter((c) => c.companyId === companyId);
            const resolved =
              companyChart.find((c) => c.accountSubType?.toLowerCase() === role.toLowerCase()) ??
              CONVENTIONAL_CODES[role]
                .map((code) => companyChart.find((c) => c.accountCode === code))
                .find(Boolean);
            if (resolved) roleAccounts[companyId][role] = resolved.id;
          }
        }
        const postedSales = sales.map((sale) => ({
          ...sale,
          journalEntry:
            journals.find((j) => j.id === sale.journalEntryId && j.companyId === sale.companyId) ??
            journals.find(
              (j) =>
                j.referenceType === 'SalesOrder' &&
                j.referenceId === sale.id &&
                j.companyId === sale.companyId &&
                !j.reversalOfId,
            ),
        }));
        const postedRefunds = refunds.map((refund) => ({
          ...refund,
          reversalJournalEntry: journals.find(
            (j) => j.id === refund.reversalJournalEntryId && j.companyId === refund.companyId,
          ),
        }));
        return {
          asOf,
          currency,
          scope: {
            companyId: query.companyId,
            divisionId: query.divisionId,
            branchId: query.branchId,
            ...grants,
            divisionIds: [...grants.divisionIds].sort(),
            branchIds: [...grants.branchIds].sort(),
          },
          accounts: assembleCustomerAccounts(
            {
              customers,
              sales: postedSales,
              receivables,
              payments: payments.map((payment) => ({
                ...payment,
                headerVisible: matchesScope(payment),
              })),
              creditNotes,
              refunds: postedRefunds,
              journals,
              roleAccounts,
              sourceEdits: sourceEdits.filter((edit) =>
                matchesScope((edit.oldValue ?? edit.newValue ?? {}) as any),
              ),
            },
            asOf,
          ).filter((account) => {
            const c = customers.find((row) => row.id === account.customer.id)!;
            const matchesSelection =
              (!query.divisionId || c.divisionId === query.divisionId) &&
              (!query.branchId || c.branchId === query.branchId);
            const identityAllowed =
              grants.unrestricted ||
              grants.divisionIds.includes(c.divisionId ?? '') ||
              grants.branchIds.includes(c.branchId ?? '');
            return (
              (identityAllowed && matchesSelection) ||
              account.movements.length > 0 ||
              (account.integrityIssues?.length ?? 0) > 0
            );
          }),
          warnings: [
            'ERP customer account only. Standalone Direct Sales are displayed separately and are excluded from these balances.',
          ],
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
    );
  }
  private checkRows(rows: unknown[]) {
    if (rows.length > MAX_ROWS)
      throw new BadRequestException(
        'Choose a smaller company, division, branch or customer selection.',
      );
  }
}

/** Pure reconstruction of dated source activity; never writes a ledger or balance cache. */
export function assembleCustomerAccounts(rows: SourceRows, asOf: Date): CustomerAccountSnapshot[] {
  return rows.customers.map((customer) => {
    const identity = {
      id: customer.id,
      companyId: customer.companyId,
      name: customer.name,
      customerCode: customer.customerCode,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      createdAt: customer.createdAt,
      company: customer.company,
    };
    const account: CustomerAccountSnapshot = {
      customer: identity,
      sales: [],
      movements: [],
      obligations: [],
      payments: [],
      aging: {
        current: 0,
        days1_30: 0,
        days31_60: 0,
        days61_90: 0,
        over90: 0,
        total: 0,
        oldestDaysOverdue: 0,
      },
      openInvoiceBalance: D(),
      customerCredit: D(),
      netBalance: D(),
      warnings: [],
      integrityIssues: [],
    };
    const belongs = (row: any) =>
      row.customerId === customer.id && row.companyId === customer.companyId;
    const receivables = rows.receivables.filter(
      (r) =>
        belongs(r) &&
        (eligibleJournal(r.journalEntry)
          ? date(r.journalEntry.transactionDate)
          : date(r.issueDate)) <= asOf,
    );
    const receivableMap = new Map(receivables.map((r) => [r.id, r]));
    const sales = rows.sales.filter(belongs);
    for (const edit of rows.sourceEdits ?? []) {
      const before = edit.oldValue ?? {},
        after = edit.newValue ?? {};
      if (
        edit.companyId !== customer.companyId ||
        ![before.customerId, after.customerId].includes(customer.id)
      )
        continue;
      if (before.customerId !== after.customerId) {
        account.integrityIssues!.push('changed-source-ownership');
        account.warnings.push(
          'An invoice was reassigned between customers after posting. Historical customer ownership requires reconciliation.',
        );
      }
      if (before.dueDate !== after.dueDate) {
        account.integrityIssues!.push('changed-payment-terms');
        account.warnings.push(
          'Invoice due dates were edited after posting. Historical payment timing requires reconciliation.',
        );
      }
    }
    const salesByReceivable = new Map<string, any>();
    for (const sale of sales) if (sale.receivableId) salesByReceivable.set(sale.receivableId, sale);
    for (const r of receivables)
      if (r.sourceType === 'SalesOrder') {
        const sale = sales.find((s) => s.id === r.sourceId);
        if (sale) salesByReceivable.set(r.id, sale);
      }
    const add = (movement: CustomerAccountMovement) => {
      if (movement.date <= asOf) account.movements.push(movement);
    };
    const reverse = (movement: CustomerAccountMovement, reversed: Date | null, label: string) => {
      if (reversed)
        add({
          ...movement,
          date: reversed,
          type: 'ADJUSTMENT',
          reference: `${movement.reference}-REV`,
          description: label,
          debit: movement.credit,
          credit: movement.debit,
          reversalOfId: `${movement.sourceType}:${movement.sourceId}`,
        });
    };
    for (const r of receivables) {
      const sale = salesByReceivable.get(r.id);
      const accrualDate = eligibleJournal(r.journalEntry)
        ? date(r.journalEntry.transactionDate)
        : date(r.issueDate);
      if (accrualDate > asOf) continue;
      if (r.journalEntryId && !eligibleJournal(r.journalEntry)) {
        account.integrityIssues!.push('missing-posting');
        account.warnings.push(`Invoice ${r.receivableNumber} has no posted accrual evidence.`);
      }
      if (
        r.journalEntry &&
        (r.companyId !== r.journalEntry.companyId ||
          (r.divisionId ?? null) !== (r.journalEntry.divisionId ?? null) ||
          (r.branchId ?? null) !== (r.journalEntry.branchId ?? null))
      ) {
        account.integrityIssues!.push('changed-source-scope');
        account.warnings.push(
          `Invoice ${r.receivableNumber} changed organizational scope after posting. Its historical ownership cannot be verified.`,
        );
      }
      const movement: CustomerAccountMovement = {
        date: accrualDate,
        type: 'INVOICE',
        reference: r.receivableNumber,
        description: `Invoice ${r.receivableNumber}`,
        sourceId: r.id,
        sourceType: 'Receivable',
        sourceUrl: '/finance/receivables',
        debit: D(r.amount),
        credit: D(),
        receivableId: r.id,
        salesOrderId: sale?.id,
      };
      add(movement);
      account.obligations.push({
        id: r.id,
        issueDate: accrualDate,
        dueDate: r.dueDate ? date(r.dueDate) : null,
        amount: D(r.amount),
        outstanding: D(r.amount),
        salesOrderId: sale?.id,
        payments: [],
      });
      if (r.deletedAt)
        account.warnings.push(
          `Invoice ${r.receivableNumber} was deleted; its posted activity remains included.`,
        );
      if (r.status === 'CANCELLED') {
        const cancelled = reversalDate(r) ?? (sale ? reversalDate(sale) : null);
        if (cancelled) reverse(movement, cancelled, `Cancellation of ${r.receivableNumber}`);
        else {
          account.integrityIssues!.push('missing-cancellation');
          account.warnings.push(
            `Invoice ${r.receivableNumber} has no dated cancellation evidence. Its historical balance cannot be verified.`,
          );
        }
      }
    }
    for (const sale of sales) {
      if (!eligibleJournal(sale.journalEntry)) {
        if (sale.status === 'CANCELLED' && !sale.confirmedAt) continue;
        account.integrityIssues!.push('missing-posting');
        account.warnings.push(
          `Sale ${sale.salesOrderNumber} has no posted journal evidence and is excluded.`,
        );
        continue;
      }
      const posted = date(sale.journalEntry.transactionDate);
      if (posted > asOf) continue;
      const cancelled = reversalDate(sale);
      if ((sale.status === 'CANCELLED' || sale.journalEntry.status === 'REVERSED') && !cancelled) {
        account.integrityIssues!.push('missing-reversal');
        account.warnings.push(
          `Sale ${sale.salesOrderNumber} has no posted cancellation or reversal evidence.`,
        );
      }
      account.sales.push({
        id: sale.id,
        date: posted,
        totalAmount: D(sale.totalAmount),
        taxAmount: D(sale.taxAmount ?? 0),
        status: cancelled && cancelled <= asOf ? 'CANCELLED' : 'CONFIRMED',
        paymentMethod: sale.paymentMethod,
        sourceUrl: `/sales-desk/sales/${sale.id}`,
      });
      // A linked receivable already supplies the gross invoice. Mixed tender
      // cash is reconstructed from its posted creation journal below.
      if (
        sale.paymentMethod === 'CREDIT' ||
        receivables.some((r) => salesByReceivable.get(r.id)?.id === sale.id)
      )
        continue;
      const invoice: CustomerAccountMovement = {
        date: posted,
        type: 'INVOICE',
        reference: sale.salesOrderNumber,
        description: `Cash sale ${sale.salesOrderNumber}`,
        sourceId: sale.id,
        sourceType: 'SalesOrder',
        sourceUrl: `/sales-desk/sales/${sale.id}`,
        debit: D(sale.totalAmount),
        credit: D(),
        salesOrderId: sale.id,
      };
      const receipt: CustomerAccountMovement = {
        ...invoice,
        type: 'PAYMENT',
        reference: sale.paymentReference ?? sale.salesOrderNumber,
        description: `Immediate receipt for ${sale.salesOrderNumber}`,
        debit: D(),
        credit: D(sale.totalAmount),
      };
      add(invoice);
      add(receipt);
      reverse(invoice, cancelled, `Cancellation of ${sale.salesOrderNumber}`);
      reverse(receipt, cancelled, `Reversal of immediate receipt ${sale.salesOrderNumber}`);
      account.payments.push({
        id: `sale:${sale.id}`,
        date: posted,
        reference: receipt.reference,
        method: sale.paymentMethod,
        amount: D(sale.totalAmount),
        appliedAmount: D(sale.totalAmount),
        unappliedAmount: D(),
        status: cancelled && cancelled <= asOf ? 'REVERSED' : 'COMPLETED',
        reversedAt: cancelled,
        sourceType: 'SalesOrder',
        sourceUrl: receipt.sourceUrl,
        allocations: [],
      });
    }
    const paymentJournals = new Set(
      rows.payments.flatMap((p) => [p.journalEntryId, p.reversalJournalEntryId].filter(Boolean)),
    );
    for (const p of rows.payments.filter(belongs)) {
      if (!eligibleJournal(p.journalEntry)) {
        account.integrityIssues!.push('missing-posting');
        account.warnings.push('A customer receipt has no posted accounting evidence.');
      }
      const allocations = p.allocations
        .filter((a: any) => receivableMap.has(a.receivableId))
        .map((a: any) => {
          const r = receivableMap.get(a.receivableId)!;
          // Creation of the receipt and its allocations is one atomic operation;
          // only allocations changed later require their later effective date.
          const later =
            a.createdAt &&
            p.createdAt &&
            date(a.createdAt).getTime() > date(p.createdAt).getTime() + 1000;
          return {
            receivableId: r.id,
            amount: D(a.amount),
            issueDate: account.obligations.find((o) => o.id === r.id)!.issueDate,
            dueDate: r.dueDate ? date(r.dueDate) : null,
            date: later
              ? new Date(Math.max(date(p.paymentDate).getTime(), date(a.createdAt).getTime()))
              : date(p.paymentDate),
          };
        })
        .filter((allocation: any) => allocation.date <= asOf);
      const applied = allocations
        .filter((a: any) => a.date <= asOf)
        .reduce((sum: Prisma.Decimal, a: any) => sum.plus(a.amount), D());
      const partial =
        p.headerVisible === false || (p._count && p._count.allocations > p.allocations.length);
      const amount = partial ? applied : D(p.amount);
      const unapplied = partial ? D() : Prisma.Decimal.max(amount.minus(applied), D());
      const reversed = reversalDate(p);
      const visibleId =
        p.headerVisible === false
          ? `allocation-${createHash('sha256').update(p.id).digest('hex').slice(0, 24)}`
          : p.id;
      const movement: CustomerAccountMovement = {
        date: date(p.paymentDate),
        type: 'PAYMENT',
        reference: p.headerVisible === false ? 'Invoice payment allocation' : p.paymentNumber,
        description:
          p.headerVisible === false
            ? 'Payment applied to invoices in this organizational scope'
            : `Payment ${p.paymentNumber}${p.reference ? ` / ${p.reference}` : ''}`,
        sourceId: visibleId,
        sourceType: p.headerVisible === false ? 'PaymentAllocation' : 'CustomerPayment',
        sourceUrl: `/sales-desk/customers/${customer.id}`,
        debit: D(),
        credit: amount,
      };
      const historyPayment = {
        id: visibleId,
        date: date(p.paymentDate),
        reference: movement.reference,
        method: p.headerVisible === false ? 'OTHER' : p.method,
        amount,
        appliedAmount: applied,
        unappliedAmount: unapplied,
        status: reversed && reversed <= asOf ? 'REVERSED' : 'COMPLETED',
        reversedAt: reversed,
        sourceType: movement.sourceType,
        sourceUrl: movement.sourceUrl,
        allocations,
      };
      if (partial) {
        for (const a of allocations) {
          const scoped = {
            ...movement,
            date: a.date,
            credit: a.amount,
            sourceId: `${visibleId}-${a.receivableId}`,
            reference: `Allocation to ${receivableMap.get(a.receivableId)!.receivableNumber}`,
            receivableId: a.receivableId,
          };
          add(scoped);
          reverse(scoped, reversed, `Reversal of ${scoped.reference}`);
          account.payments.push({
            ...historyPayment,
            id: scoped.sourceId,
            date: a.date,
            reference: scoped.reference,
            amount: a.amount,
            appliedAmount: a.amount,
            allocations: [a],
          });
        }
      } else {
        add(movement);
        reverse(movement, reversed, `Reversal of ${movement.reference}`);
        if (movement.date <= asOf) account.payments.push(historyPayment);
      }
      if (partial)
        account.warnings.push(
          `Scoped receipt: ${movement.reference} shows only allocations in this organizational scope; unassigned deposits are excluded.`,
        );
      if (p.status === 'REVERSED' && !reversed) {
        account.integrityIssues!.push('missing-reversal');
        account.warnings.push(`Payment ${movement.reference} has no dated reversal evidence.`);
      }
      for (const a of allocations) {
        const obligation = account.obligations.find((r) => r.id === a.receivableId)!;
        obligation.payments.push({
          date: a.date,
          amount: a.amount,
          paymentId: visibleId,
          reversedAt: reversed,
        });
      }
    }
    const unverifiedJournals = new Set<string>();
    for (const j of rows.journals) {
      const r = receivableMap.get(j.referenceId);
      if (!r || paymentJournals.has(j.id) || j.reversalOfId || j.id === r.journalEntryId) continue;
      const settlement = /^Receivable settlement /i.test(j.description);
      const writeoff = /^Receivable write-off /i.test(j.description);
      if (!settlement && !writeoff) continue;
      const arCredit = (j.lines ?? [])
        .filter((line: any) => roleLine(line, 'AR_CONTROL', r.companyId, rows.roleAccounts))
        .reduce(
          (sum: Prisma.Decimal, line: any) => sum.plus(D(line.credit)).minus(D(line.debit)),
          D(),
        );
      const cashDebit = (j.lines ?? [])
        .filter(
          (line: any) =>
            roleLine(line, 'CASH_ON_HAND', r.companyId, rows.roleAccounts) ||
            roleLine(line, 'BANK', r.companyId, rows.roleAccounts),
        )
        .reduce(
          (sum: Prisma.Decimal, line: any) => sum.plus(D(line.debit)).minus(D(line.credit)),
          D(),
        );
      if (arCredit.lte(0) || (settlement && !cashDebit.equals(arCredit))) {
        unverifiedJournals.add(j.id);
        account.integrityIssues!.push('unverified-settlement');
        account.warnings.push(
          `Journal ${j.journalNumber} does not contain a verified receivable ${settlement ? 'cash settlement' : 'write-off'} leg.`,
        );
        continue;
      }
      const reversed =
        (j.reversedBy_ ?? [])
          .filter((rj: any) => eligibleJournal(rj))
          .map((rj: any) => date(rj.transactionDate))[0] ?? null;
      if (j.status === 'REVERSED' && !reversed) {
        account.integrityIssues!.push('missing-reversal');
        account.warnings.push(`Journal ${j.journalNumber} has no posted reversal evidence.`);
      }
      const movement: CustomerAccountMovement = {
        date: date(j.transactionDate),
        type: settlement ? 'PAYMENT' : 'ADJUSTMENT',
        reference: j.journalNumber,
        description: j.description,
        sourceId: j.id,
        sourceType: 'JournalEntry',
        sourceUrl: '/finance/journal-entries',
        debit: D(),
        credit: arCredit,
        receivableId: r.id,
        salesOrderId: salesByReceivable.get(r.id)?.id,
      };
      add(movement);
      reverse(movement, reversed, `Reversal of ${j.journalNumber}`);
      if (settlement && movement.date <= asOf) {
        const amount = arCredit;
        account.payments.push({
          id: j.id,
          date: movement.date,
          reference: j.journalNumber,
          method: 'OTHER',
          amount,
          appliedAmount: amount,
          unappliedAmount: D(),
          status: reversed && reversed <= asOf ? 'REVERSED' : 'COMPLETED',
          reversedAt: reversed,
          sourceType: 'JournalEntry',
          sourceUrl: movement.sourceUrl,
          allocations: [
            {
              receivableId: r.id,
              amount,
              issueDate: date(r.issueDate),
              dueDate: r.dueDate ? date(r.dueDate) : null,
              date: movement.date,
            },
          ],
        });
        account.obligations
          .find((o) => o.id === r.id)!
          .payments.push({ date: movement.date, amount, paymentId: j.id, reversedAt: reversed });
      }
    }
    // Keep the existing settlement-history contract: current cumulative paid
    // fields are diagnostics, never invented dated receipts. Reconciliation
    // sees future receipts too; movement inclusion still honors the closing date.
    const settlementLines = (lines: any[] = []) =>
      lines.map((line) => {
        if (!rows.roleAccounts) return line;
        const role = (['AR_CONTROL', 'CASH_ON_HAND', 'BANK'] as const).find((candidate) =>
          roleLine(line, candidate, customer.companyId, rows.roleAccounts),
        );
        return {
          ...line,
          account: {
            ...line.account,
            accountSubType: role?.toLowerCase() ?? 'unresolved',
          },
        };
      });
    const recovered = recoverSettlementHistory({
      kind: 'customer',
      documents: receivables.map((r) => ({ ...r, reference: r.receivableNumber })),
      journals: rows.journals
        .filter((j) => !j.companyId || j.companyId === customer.companyId)
        .map((j) => ({
          ...j,
          lines: settlementLines(j.lines),
          reversedBy_: (j.reversedBy_ ?? []).map((reversal: any) => ({
            ...reversal,
            lines: settlementLines(reversal.lines),
          })),
        })),
      modernJournalIds: [...paymentJournals],
      completedAllocations: rows.payments
        .filter((p) => belongs(p) && p.status !== 'REVERSED')
        .flatMap((p) =>
          (p.allocations ?? []).map((a: any) => ({
            documentId: a.receivableId,
            amount: a.amount,
          })),
        ),
    });
    account.settlementHistory = recovered.history;
    for (const recoveredMovement of recovered.movements) {
      const journal = rows.journals.find(
        (j) =>
          j.id === recoveredMovement.sourceId ||
          (j.reversedBy_ ?? []).some((reversal: any) => reversal.id === recoveredMovement.sourceId),
      );
      const r =
        journal &&
        (receivableMap.get(journal.referenceId) ??
          receivables.find((invoice) => invoice.journalEntryId === journal.id));
      if (!journal || !r || unverifiedJournals.has(journal.id)) continue;
      const initialReceipt = recoveredMovement.description.startsWith('Initial sale receipt');
      // Existing verified settlement/write-off/cancellation legs are retained
      // once, including reversals which use the original source identity.
      if (
        account.movements.some(
          (movement) =>
            movement.date.getTime() === recoveredMovement.date.getTime() &&
            movement.debit.equals(recoveredMovement.debit) &&
            movement.credit.equals(recoveredMovement.credit) &&
            ((movement.sourceType === 'JournalEntry' && movement.sourceId === journal.id) ||
              movement.reversalOfId === `Receivable:${r.id}`),
        )
      )
        continue;
      const creationReversal =
        journal.id === r.journalEntryId && recoveredMovement.sourceId !== journal.id;
      if (
        creationReversal &&
        account.movements.some(
          (movement) =>
            movement.reversalOfId === `Receivable:${r.id}` &&
            movement.date.getTime() === recoveredMovement.date.getTime(),
        )
      )
        continue;
      const movement: CustomerAccountMovement = {
        ...recoveredMovement,
        ...(creationReversal
          ? {
              debit: D(),
              credit: D(r.amount),
              reversalOfId: `Receivable:${r.id}`,
            }
          : {}),
        type: initialReceipt ? 'PAYMENT' : 'ADJUSTMENT',
        sourceType: 'JournalEntry',
        sourceUrl: '/finance/journal-entries',
        receivableId: r.id,
        salesOrderId: salesByReceivable.get(r.id)?.id,
      };
      add(movement);
      if (initialReceipt && movement.date <= asOf) {
        const reversed =
          (journal.reversedBy_ ?? [])
            .filter(eligibleJournal)
            .map((reversal: any) => date(reversal.transactionDate))
            .sort((a: Date, b: Date) => a.getTime() - b.getTime())[0] ?? null;
        const amount = movement.credit;
        account.payments.push({
          id: `initial:${journal.id}`,
          date: movement.date,
          reference: journal.journalNumber,
          method: 'OTHER',
          amount,
          appliedAmount: amount,
          unappliedAmount: D(),
          status: reversed && reversed <= asOf ? 'REVERSED' : 'COMPLETED',
          reversedAt: reversed,
          sourceType: 'JournalEntry',
          sourceUrl: movement.sourceUrl,
          allocations: [
            {
              receivableId: r.id,
              amount,
              issueDate: account.obligations.find((o) => o.id === r.id)!.issueDate,
              dueDate: r.dueDate ? date(r.dueDate) : null,
              date: movement.date,
            },
          ],
        });
        account.obligations
          .find((o) => o.id === r.id)!
          .payments.push({
            date: movement.date,
            amount,
            paymentId: journal.id,
            reversedAt: reversed,
          });
        // The creation-journal reversal restores the net AR leg. Split it into
        // gross invoice and initial receipt reversal to preserve bank-style history.
        reverse(movement, reversed, `Reversal of initial receipt ${journal.journalNumber}`);
      }
    }
    if (recovered.history.status === 'INCOMPLETE') {
      account.integrityIssues!.push('incomplete-settlement-history');
      account.warnings.push(
        `Settlement history is incomplete. Unresolved evidence: ${recovered.history.unresolvedAmount}. This account is not reconciled.`,
        ...recovered.history.gaps.map((gap) => `${gap.reference}: ${gap.reason}`),
      );
    }
    for (const n of rows.creditNotes.filter(belongs)) {
      const original = eligibleJournal(n.journalEntry);
      if (!original) {
        account.integrityIssues!.push('missing-posting');
        account.warnings.push('A credit note has no posted accounting evidence.');
      }
      if (n.status === 'VOID' && !original) continue;
      const r = receivableMap.get(n.receivableId);
      const movement: CustomerAccountMovement = {
        date: date(n.issueDate),
        type: 'CREDIT_NOTE',
        reference: n.creditNoteNumber,
        description: `Credit note ${n.creditNoteNumber}${n.reason ? ` / ${n.reason}` : ''}`,
        sourceId: n.id,
        sourceType: 'CreditNote',
        sourceUrl: '/finance/credit-notes',
        debit: D(),
        credit: D(n.totalAmount),
        receivableId: r?.id,
        salesOrderId: n.salesOrderId ?? salesByReceivable.get(r?.id)?.id,
      };
      add(movement);
      reverse(movement, reversalDate(n), `Void of ${n.creditNoteNumber}`);
      if (n.status === 'VOID' && !reversalDate(n)) {
        account.integrityIssues!.push('missing-reversal');
        account.warnings.push(`Credit note ${n.creditNoteNumber} has no dated void evidence.`);
      }
    }
    for (const r of rows.refunds.filter(belongs)) {
      if (!eligibleJournal(r.journalEntry)) {
        account.integrityIssues!.push('missing-posting');
        account.warnings.push('A refund has no posted accounting evidence.');
      }
      if (r.status === 'VOID' && !eligibleJournal(r.journalEntry)) continue;
      const movement: CustomerAccountMovement = {
        date: date(r.refundDate),
        type: 'REFUND',
        reference: r.refundNumber,
        description: `Refund ${r.refundNumber}`,
        sourceId: r.id,
        sourceType: 'Refund',
        sourceUrl: `/sales-desk/customers/${customer.id}`,
        debit: D(r.amount),
        credit: D(),
      };
      add(movement);
      reverse(movement, reversalDate(r), `Void of ${r.refundNumber}`);
      if (r.status === 'VOID' && !reversalDate(r)) {
        account.integrityIssues!.push('missing-reversal');
        account.warnings.push(`Refund ${r.refundNumber} has no dated void evidence.`);
      }
    }
    account.movements.sort(
      (a, b) =>
        a.date.getTime() - b.date.getTime() ||
        { INVOICE: 0, REFUND: 1, PAYMENT: 2, CREDIT_NOTE: 3, ADJUSTMENT: 4 }[a.type] -
          { INVOICE: 0, REFUND: 1, PAYMENT: 2, CREDIT_NOTE: 3, ADJUSTMENT: 4 }[b.type] ||
        `${a.sourceType}:${a.sourceId}:${a.reference}`.localeCompare(
          `${b.sourceType}:${b.sourceId}:${b.reference}`,
        ),
    );
    for (const obligation of account.obligations) {
      let balance = obligation.amount;
      for (const payment of obligation.payments)
        if (payment.date <= asOf && (!payment.reversedAt || payment.reversedAt > asOf))
          balance = balance.minus(payment.amount);
      for (const m of account.movements)
        if (
          m.receivableId === obligation.id &&
          m.type !== 'INVOICE' &&
          m.type !== 'PAYMENT' &&
          !(
            m.reversalOfId &&
            account.movements.some(
              (original) =>
                `${original.sourceType}:${original.sourceId}` === m.reversalOfId &&
                original.type === 'PAYMENT',
            )
          )
        ) {
          // Credit note voids restore the credit applied. Written-off/cancelled
          // amounts are dated adjustments, never a deletion of the original debit.
          balance = balance.plus(m.debit).minus(m.credit);
        }
      obligation.outstanding = Prisma.Decimal.max(balance, D());
      account.openInvoiceBalance = account.openInvoiceBalance.plus(obligation.outstanding);
      if (obligation.outstanding.gt(0)) {
        const days = obligation.dueDate
          ? Math.max(
              0,
              Math.round(
                (asOf.getTime() -
                  dateRangeEnd(obligation.dueDate.toISOString().slice(0, 10)).getTime()) /
                  86400000,
              ),
            )
          : 0;
        const key =
          days <= 0
            ? 'current'
            : days <= 30
              ? 'days1_30'
              : days <= 60
                ? 'days31_60'
                : days <= 90
                  ? 'days61_90'
                  : 'over90';
        account.aging[key] = D(account.aging[key]).plus(obligation.outstanding).toFixed(2);
        account.aging.total = D(account.aging.total).plus(obligation.outstanding).toFixed(2);
        account.aging.oldestDaysOverdue = Math.max(account.aging.oldestDaysOverdue, days);
      }
      const row = receivableMap.get(obligation.id)!;
      if (
        row.status === 'WRITTEN_OFF' &&
        !rows.journals.some(
          (j) => j.referenceId === row.id && /^Receivable write-off /i.test(j.description),
        )
      ) {
        account.integrityIssues!.push('missing-writeoff');
        account.warnings.push(
          `Invoice ${row.receivableNumber} has no dated write-off evidence. Its historical balance cannot be verified.`,
        );
      }
    }
    account.netBalance = account.movements.reduce(
      (sum, m) => sum.plus(m.debit).minus(m.credit),
      D(),
    );
    account.customerCredit = Prisma.Decimal.max(
      account.openInvoiceBalance.minus(account.netBalance),
      D(),
    );
    account.payments.sort(
      (a, b) => b.date.getTime() - a.date.getTime() || a.id.localeCompare(b.id),
    );
    account.integrityIssues = [...new Set(account.integrityIssues)];
    return account;
  });
}
