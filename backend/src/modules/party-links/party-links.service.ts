import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { refreshCachedPartyBalance } from '../party-balance/party-balance.helper';

export const PARTY_LINK_SOURCES = [
  'cash_desk_movements',
  'expenses',
  'record_entries',
  'record_book_expenses',
  'debts',
  'contracts',
  'loans',
  'receivables',
  'payables',
] as const;
export type PartyLinkSource = (typeof PARTY_LINK_SOURCES)[number];
export type PartyKind = 'supplier' | 'customer';
type Tx = Prisma.TransactionClient;

/** One unlinked row, normalised across sources. */
export interface UnlinkedRow {
  source: PartyLinkSource;
  id: string;
  companyId: string;
  divisionId: string | null;
  branchId: string | null;
  kind: PartyKind;
  name: string;
  amount: string | null;
  currency: string | null;
  date: string | null;
  reference: string | null;
}

/** Rows that share a source, company, kind and normalised name. */
export interface UnlinkedGroup {
  key: string;
  source: PartyLinkSource;
  companyId: string;
  companyName: string | null;
  kind: PartyKind;
  name: string;
  rows: number;
  rowIds: string[];
  totals: Array<{ currency: string; amount: string }>;
  latest: string | null;
  /** Exactly one active master in the company with the same normalised name, else null. */
  suggestion: { id: string; name: string } | null;
}

const SOURCE_LABELS: Record<PartyLinkSource, string> = {
  cash_desk_movements: 'Cash Desk movement',
  expenses: 'Expense',
  record_entries: 'NoteBook record',
  record_book_expenses: 'Records Book money out',
  debts: 'Group Control debt',
  contracts: 'Contract',
  loans: 'Loan',
  receivables: 'Receivable',
  payables: 'Payable',
};
const SOURCE_TABLES: Record<PartyLinkSource, string> = {
  cash_desk_movements: 'cash_desk_movements',
  expenses: 'expenses',
  record_entries: 'record_entries',
  record_book_expenses: 'record_book_expenses',
  debts: 'debts',
  contracts: 'contracts',
  loans: 'loans',
  receivables: 'receivables',
  payables: 'payables',
};
const SOURCE_ENTITY: Record<PartyLinkSource, string> = {
  cash_desk_movements: 'CashDeskMovement',
  expenses: 'Expense',
  record_entries: 'RecordEntry',
  record_book_expenses: 'RecordBookExpense',
  debts: 'Debt',
  contracts: 'Contract',
  loans: 'Loan',
  receivables: 'Receivable',
  payables: 'Payable',
};
/** The source app's own write permission, required on top of party_links.manage. */
const SOURCE_PERMISSION: Record<PartyLinkSource, string> = {
  cash_desk_movements: 'cash_desk.record',
  expenses: 'expenses.approve',
  record_entries: 'records.manage',
  record_book_expenses: 'record_book.update',
  debts: 'debts.update',
  contracts: 'contracts.update',
  loans: 'loans.update',
  receivables: 'receivables.manage',
  payables: 'payables.manage',
};
const OPEN = ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] as const;
const TAKE = 2000;

export function normalisePartyName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const money = (value: Prisma.Decimal | number | string | null | undefined) =>
  value === null || value === undefined ? null : new Prisma.Decimal(value).toFixed(2);
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

/**
 * Party matching for rows that carry only a typed name (party linkage, W7). Lists them
 * grouped by source, company, kind and normalised name, suggests a master only when exactly
 * one active master in that company has the same normalised name (a suggestion is never
 * applied on its own), and links a row, or every row with the same name, to the chosen
 * master. Linking changes identity only: amounts, statuses, journals and movements are
 * untouched; the typed name stays as the display snapshot.
 */
@Injectable()
export class PartyLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
  ) {}

  static sourceLabel(source: PartyLinkSource) {
    return SOURCE_LABELS[source];
  }

  // ── listing ───────────────────────────────────────────────────────────────────

  async unlinked(user: AuthUser, query: { companyId?: string; source?: PartyLinkSource }) {
    if (!user.permissions.includes('party_links.view'))
      throw new ForbiddenException('Unmatched parties access is required.');
    const sources = query.source ? [query.source] : [...PARTY_LINK_SOURCES];
    const companyWhere = await this.companies.companyWhereFor(user, query.companyId);
    const orgWhere = await this.org.recordWhereFor(user);
    const rows: UnlinkedRow[] = [];
    for (const source of sources) rows.push(...(await this.load(source, companyWhere, orgWhere)));

    const groups = new Map<string, UnlinkedGroup & { amounts: Map<string, Prisma.Decimal> }>();
    for (const row of rows) {
      const normalised = normalisePartyName(row.name);
      if (!normalised) continue;
      const key = `${row.source}:${row.companyId}:${row.kind}:${normalised}`;
      const group = groups.get(key) ?? {
        key,
        source: row.source,
        companyId: row.companyId,
        companyName: null,
        kind: row.kind,
        name: row.name.trim(),
        rows: 0,
        rowIds: [],
        totals: [],
        latest: null,
        suggestion: null,
        amounts: new Map<string, Prisma.Decimal>(),
      };
      group.rows += 1;
      if (group.rowIds.length < 500) group.rowIds.push(row.id);
      if (row.amount && row.currency)
        group.amounts.set(
          row.currency,
          (group.amounts.get(row.currency) ?? new Prisma.Decimal(0)).plus(row.amount),
        );
      if (row.date && (!group.latest || row.date > group.latest)) group.latest = row.date;
      groups.set(key, group);
    }

    const companyIds = [...new Set([...groups.values()].map((g) => g.companyId))];
    const [companies, suppliers, customers] = await Promise.all([
      companyIds.length
        ? this.prisma.company.findMany({
            where: { id: { in: companyIds } },
            select: { id: true, name: true },
          })
        : [],
      companyIds.length
        ? this.prisma.supplier.findMany({
            where: { companyId: { in: companyIds }, deletedAt: null, status: 'ACTIVE' },
            select: { id: true, name: true, legalName: true, companyId: true },
          })
        : [],
      companyIds.length
        ? this.prisma.customer.findMany({
            where: { companyId: { in: companyIds }, deletedAt: null, status: 'ACTIVE' },
            select: { id: true, name: true, legalName: true, companyId: true },
          })
        : [],
    ]);
    const companyNames = new Map(companies.map((c) => [c.id, c.name]));
    const index = (
      masters: Array<{ id: string; name: string; legalName: string | null; companyId: string }>,
    ) => {
      const map = new Map<string, Set<string>>();
      const names = new Map<string, string>();
      for (const m of masters) {
        names.set(m.id, m.name);
        for (const candidate of [m.name, m.legalName]) {
          const n = normalisePartyName(candidate);
          if (!n) continue;
          const key = `${m.companyId}:${n}`;
          map.set(key, (map.get(key) ?? new Set()).add(m.id));
        }
      }
      return { map, names };
    };
    const supplierIndex = index(suppliers);
    const customerIndex = index(customers);

    const result: UnlinkedGroup[] = [...groups.values()].map((g) => {
      const idx = g.kind === 'supplier' ? supplierIndex : customerIndex;
      const ids = idx.map.get(`${g.companyId}:${normalisePartyName(g.name)}`);
      const suggestionId = ids && ids.size === 1 ? [...ids][0] : null;
      const { amounts, ...rest } = g;
      return {
        ...rest,
        companyName: companyNames.get(g.companyId) ?? null,
        totals: [...amounts.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) })),
        suggestion: suggestionId
          ? { id: suggestionId, name: idx.names.get(suggestionId) ?? '' }
          : null,
      };
    });
    result.sort(
      (a, b) => a.source.localeCompare(b.source) || b.rows - a.rows || a.name.localeCompare(b.name),
    );
    const counts = Object.fromEntries(
      sources.map((s) => [s, rows.filter((r) => r.source === s).length]),
    );
    return { groups: result, counts, sources: SOURCE_LABELS };
  }

  private async load(
    source: PartyLinkSource,
    companyWhere: Record<string, unknown>,
    orgWhere: Record<string, unknown>,
  ): Promise<UnlinkedRow[]> {
    const db = this.prisma;
    const scoped = { AND: [companyWhere, orgWhere] };
    const companyScoped = { AND: [companyWhere] };
    switch (source) {
      case 'cash_desk_movements': {
        const rows = await db.cashDeskMovement.findMany({
          where: {
            partyType: 'NONE',
            kind: { in: ['EXPENSE', 'SUPPLIER_PAYMENT'] },
            reversedAt: null,
            entries: { some: { account: scoped } },
          },
          select: {
            id: true,
            kind: true,
            payee: true,
            description: true,
            amount: true,
            currency: true,
            businessDate: true,
            reference: true,
            entries: {
              select: {
                account: { select: { companyId: true, divisionId: true, branchId: true } },
              },
              take: 1,
            },
          },
          orderBy: { businessDate: 'desc' },
          take: TAKE,
        });
        return rows
          .filter((r) => r.entries[0]?.account)
          .map((r) => ({
            source,
            id: r.id,
            companyId: r.entries[0].account.companyId,
            divisionId: r.entries[0].account.divisionId,
            branchId: r.entries[0].account.branchId,
            kind: 'supplier' as const,
            name: r.payee ?? r.description,
            amount: money(r.amount),
            currency: r.currency,
            date: iso(r.businessDate),
            reference: r.reference,
          }));
      }
      case 'expenses': {
        const rows = await db.expense.findMany({
          where: { supplierId: null, deletedAt: null, vendorName: { not: null }, ...scoped },
          select: {
            id: true,
            companyId: true,
            divisionId: true,
            branchId: true,
            vendorName: true,
            amount: true,
            currency: true,
            expenseDate: true,
            expenseNumber: true,
          },
          orderBy: { expenseDate: 'desc' },
          take: TAKE,
        });
        return rows.map((r) => ({
          source,
          id: r.id,
          companyId: r.companyId,
          divisionId: r.divisionId,
          branchId: r.branchId,
          kind: 'supplier' as const,
          name: r.vendorName ?? '',
          amount: money(r.amount),
          currency: r.currency,
          date: iso(r.expenseDate),
          reference: r.expenseNumber,
        }));
      }
      case 'record_entries': {
        const rows = await db.recordEntry.findMany({
          where: {
            voidedAt: null,
            companyId: { not: null },
            counterparty: { not: null },
            OR: [
              { kind: 'CREDITOR', supplierId: null },
              { kind: 'DEBTOR', customerId: null },
            ],
            ...scoped,
          },
          select: {
            id: true,
            companyId: true,
            divisionId: true,
            branchId: true,
            kind: true,
            counterparty: true,
            amount: true,
            settledAmount: true,
            currency: true,
            recordDate: true,
            reference: true,
          },
          orderBy: { recordDate: 'desc' },
          take: TAKE,
        });
        return rows.map((r) => ({
          source,
          id: r.id,
          companyId: r.companyId!,
          divisionId: r.divisionId,
          branchId: r.branchId,
          kind: (r.kind === 'CREDITOR' ? 'supplier' : 'customer') as PartyKind,
          name: r.counterparty ?? '',
          amount: money(new Prisma.Decimal(r.amount).minus(r.settledAmount)),
          currency: r.currency,
          date: iso(r.recordDate),
          reference: r.reference,
        }));
      }
      case 'record_book_expenses': {
        const rows = await db.recordBookExpense.findMany({
          where: {
            supplierId: null,
            deletedAt: null,
            paidTo: { not: null },
            status: { not: 'VOIDED' },
            ...scoped,
          },
          select: {
            id: true,
            companyId: true,
            divisionId: true,
            branchId: true,
            paidTo: true,
            amount: true,
            currency: true,
            recordDate: true,
            reference: true,
          },
          orderBy: { recordDate: 'desc' },
          take: TAKE,
        });
        return rows.map((r) => ({
          source,
          id: r.id,
          companyId: r.companyId,
          divisionId: r.divisionId,
          branchId: r.branchId,
          kind: 'supplier' as const,
          name: r.paidTo ?? '',
          amount: money(r.amount),
          currency: r.currency,
          date: iso(r.recordDate),
          reference: r.reference,
        }));
      }
      case 'debts': {
        const rows = await db.debt.findMany({
          where: { supplierId: null, deletedAt: null, ...companyScoped },
          select: {
            id: true,
            companyId: true,
            creditorName: true,
            amount: true,
            amountPaid: true,
            currency: true,
            dueDate: true,
            invoiceNumber: true,
          },
          orderBy: { createdAt: 'desc' },
          take: TAKE,
        });
        return rows.map((r) => ({
          source,
          id: r.id,
          companyId: r.companyId,
          divisionId: null,
          branchId: null,
          kind: 'supplier' as const,
          name: r.creditorName,
          amount: money(new Prisma.Decimal(r.amount).minus(r.amountPaid)),
          currency: r.currency,
          date: iso(r.dueDate),
          reference: r.invoiceNumber,
        }));
      }
      case 'contracts': {
        const rows = await db.contract.findMany({
          where: {
            deletedAt: null,
            companyId: { not: null },
            OR: [
              { contractType: 'SUPPLIER', supplierId: null },
              { contractType: 'CUSTOMER', customerId: null },
            ],
            ...companyScoped,
          },
          select: {
            id: true,
            companyId: true,
            contractType: true,
            counterpartyName: true,
            value: true,
            currency: true,
            startDate: true,
            contractNumber: true,
          },
          orderBy: { startDate: 'desc' },
          take: TAKE,
        });
        return rows.map((r) => ({
          source,
          id: r.id,
          companyId: r.companyId!,
          divisionId: null,
          branchId: null,
          kind: (r.contractType === 'SUPPLIER' ? 'supplier' : 'customer') as PartyKind,
          name: r.counterpartyName,
          amount: money(r.value),
          currency: r.currency,
          date: iso(r.startDate),
          reference: r.contractNumber,
        }));
      }
      case 'loans': {
        const rows = await db.loan.findMany({
          where: {
            supplierId: null,
            deletedAt: null,
            obligationType: 'SUPPLIER_CREDIT',
            companyId: { not: null },
            ...companyScoped,
          },
          select: {
            id: true,
            companyId: true,
            lenderName: true,
            outstandingBalance: true,
            currency: true,
            disbursementDate: true,
            loanReference: true,
          },
          orderBy: { disbursementDate: 'desc' },
          take: TAKE,
        });
        return rows.map((r) => ({
          source,
          id: r.id,
          companyId: r.companyId!,
          divisionId: null,
          branchId: null,
          kind: 'supplier' as const,
          name: r.lenderName,
          amount: money(r.outstandingBalance),
          currency: r.currency,
          date: iso(r.disbursementDate),
          reference: r.loanReference,
        }));
      }
      case 'receivables': {
        const rows = await db.receivable.findMany({
          where: {
            customerId: null,
            deletedAt: null,
            status: { in: [...OPEN] as never },
            ...scoped,
          },
          select: {
            id: true,
            companyId: true,
            divisionId: true,
            branchId: true,
            customerName: true,
            outstandingAmount: true,
            currency: true,
            issueDate: true,
            receivableNumber: true,
          },
          orderBy: { issueDate: 'desc' },
          take: TAKE,
        });
        return rows.map((r) => ({
          source,
          id: r.id,
          companyId: r.companyId,
          divisionId: r.divisionId,
          branchId: r.branchId,
          kind: 'customer' as const,
          name: r.customerName,
          amount: money(r.outstandingAmount),
          currency: r.currency,
          date: iso(r.issueDate),
          reference: r.receivableNumber,
        }));
      }
      case 'payables': {
        const rows = await db.payable.findMany({
          where: {
            supplierId: null,
            deletedAt: null,
            status: { in: [...OPEN] as never },
            ...scoped,
          },
          select: {
            id: true,
            companyId: true,
            divisionId: true,
            branchId: true,
            supplierName: true,
            outstandingAmount: true,
            currency: true,
            issueDate: true,
            payableNumber: true,
          },
          orderBy: { issueDate: 'desc' },
          take: TAKE,
        });
        return rows.map((r) => ({
          source,
          id: r.id,
          companyId: r.companyId,
          divisionId: r.divisionId,
          branchId: r.branchId,
          kind: 'supplier' as const,
          name: r.supplierName,
          amount: money(r.outstandingAmount),
          currency: r.currency,
          date: iso(r.issueDate),
          reference: r.payableNumber,
        }));
      }
    }
  }

  // ── linking ───────────────────────────────────────────────────────────────────

  async link(
    user: AuthUser,
    source: PartyLinkSource,
    rowId: string,
    partyId: string,
    requestId?: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const result = await this.linkInTransaction(tx, user, source, rowId, partyId);
      await this.audit.logStrictInTransaction(tx, {
        action: 'PARTY_LINKED',
        entityType: SOURCE_ENTITY[source],
        entityId: rowId,
        companyId: result.companyId,
        userId: user.id,
        oldValue: { name: result.name },
        newValue: {
          kind: result.kind,
          partyId,
          partyName: result.partyName,
          requestId: requestId ?? null,
        },
      });
      return result;
    });
  }

  async linkMany(
    user: AuthUser,
    source: PartyLinkSource,
    rowIds: string[],
    partyId: string,
    requestId?: string | null,
  ) {
    const unique = [...new Set(rowIds)].slice(0, 500);
    if (!unique.length) throw new BadRequestException('Choose at least one row to link.');
    return this.prisma.$transaction(
      async (tx) => {
        const results = [];
        for (const rowId of unique) {
          const result = await this.linkInTransaction(tx, user, source, rowId, partyId);
          await this.audit.logStrictInTransaction(tx, {
            action: 'PARTY_LINKED',
            entityType: SOURCE_ENTITY[source],
            entityId: rowId,
            companyId: result.companyId,
            userId: user.id,
            oldValue: { name: result.name },
            newValue: {
              kind: result.kind,
              partyId,
              partyName: result.partyName,
              requestId: requestId ?? null,
              batch: unique.length,
            },
          });
          results.push(result);
        }
        return { linked: results.filter((r) => !r.alreadyLinked).length, results };
      },
      { timeout: 60000 },
    );
  }

  private requirePermissions(user: AuthUser, source: PartyLinkSource, kind: PartyKind) {
    const required = ['party_links.manage', `${kind}s.update`, SOURCE_PERMISSION[source]];
    if (!required.every((p) => user.permissions.includes(p)))
      throw new ForbiddenException(
        `Linking a ${SOURCE_LABELS[source].toLowerCase()} needs ${required.join(', ')}.`,
      );
  }

  private async lock(tx: Tx, source: PartyLinkSource, id: string) {
    const table = SOURCE_TABLES[source];
    await tx.$executeRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, id);
  }

  /** Loads the row's identity fields and current link for any source. */
  private async current(tx: Tx, source: PartyLinkSource, id: string) {
    const pick = (row: Record<string, unknown> | null) => row;
    switch (source) {
      case 'cash_desk_movements': {
        const r = await tx.cashDeskMovement.findUnique({
          where: { id },
          select: {
            id: true,
            kind: true,
            payee: true,
            description: true,
            partyType: true,
            supplierId: true,
            customerId: true,
            entries: {
              select: {
                account: { select: { companyId: true, divisionId: true, branchId: true } },
              },
              take: 1,
            },
          },
        });
        if (!r || !r.entries[0]) return null;
        if (!['EXPENSE', 'SUPPLIER_PAYMENT'].includes(r.kind))
          throw new BadRequestException(
            'Only expense and supplier payment movements can be matched to a supplier.',
          );
        return pick({
          companyId: r.entries[0].account.companyId,
          divisionId: r.entries[0].account.divisionId,
          branchId: r.entries[0].account.branchId,
          kind: 'supplier',
          name: r.payee ?? r.description,
          linked:
            r.partyType === 'SUPPLIER' ? r.supplierId : r.partyType === 'NONE' ? null : 'other',
        });
      }
      case 'expenses': {
        const r = await tx.expense.findFirst({
          where: { id, deletedAt: null },
          select: {
            companyId: true,
            divisionId: true,
            branchId: true,
            vendorName: true,
            supplierId: true,
          },
        });
        return (
          r && pick({ ...r, kind: 'supplier', name: r.vendorName ?? '', linked: r.supplierId })
        );
      }
      case 'record_entries': {
        const r = await tx.recordEntry.findFirst({
          where: { id, voidedAt: null },
          select: {
            companyId: true,
            divisionId: true,
            branchId: true,
            kind: true,
            counterparty: true,
            supplierId: true,
            customerId: true,
          },
        });
        if (!r) return null;
        if (!r.companyId)
          throw new BadRequestException(
            'A personal NoteBook record has no company to match a party in.',
          );
        if (!['DEBTOR', 'CREDITOR'].includes(r.kind))
          throw new BadRequestException('Only debtor and creditor records can be matched here.');
        const kind: PartyKind = r.kind === 'CREDITOR' ? 'supplier' : 'customer';
        return pick({
          companyId: r.companyId,
          divisionId: r.divisionId,
          branchId: r.branchId,
          kind,
          name: r.counterparty ?? '',
          linked: kind === 'supplier' ? r.supplierId : r.customerId,
        });
      }
      case 'record_book_expenses': {
        const r = await tx.recordBookExpense.findFirst({
          where: { id, deletedAt: null },
          select: {
            companyId: true,
            divisionId: true,
            branchId: true,
            paidTo: true,
            supplierId: true,
          },
        });
        return r && pick({ ...r, kind: 'supplier', name: r.paidTo ?? '', linked: r.supplierId });
      }
      case 'debts': {
        const r = await tx.debt.findFirst({
          where: { id, deletedAt: null },
          select: { companyId: true, creditorName: true, supplierId: true },
        });
        return (
          r &&
          pick({
            ...r,
            divisionId: null,
            branchId: null,
            kind: 'supplier',
            name: r.creditorName,
            linked: r.supplierId,
          })
        );
      }
      case 'contracts': {
        const r = await tx.contract.findFirst({
          where: { id, deletedAt: null },
          select: {
            companyId: true,
            contractType: true,
            counterpartyName: true,
            supplierId: true,
            customerId: true,
          },
        });
        if (!r) return null;
        if (!r.companyId)
          throw new BadRequestException(
            'A group-level contract has no company to match a party in.',
          );
        if (r.contractType !== 'SUPPLIER' && r.contractType !== 'CUSTOMER')
          throw new BadRequestException(
            'Only supplier and customer contracts can be matched to a party.',
          );
        const kind: PartyKind = r.contractType === 'SUPPLIER' ? 'supplier' : 'customer';
        return pick({
          companyId: r.companyId,
          divisionId: null,
          branchId: null,
          kind,
          name: r.counterpartyName,
          linked: kind === 'supplier' ? r.supplierId : r.customerId,
        });
      }
      case 'loans': {
        const r = await tx.loan.findFirst({
          where: { id, deletedAt: null },
          select: { companyId: true, lenderName: true, supplierId: true, obligationType: true },
        });
        if (!r) return null;
        if (!r.companyId)
          throw new BadRequestException('A group-level loan has no company to match a party in.');
        if (r.obligationType !== 'SUPPLIER_CREDIT')
          throw new BadRequestException('Only supplier-credit loans can be matched to a supplier.');
        return pick({
          companyId: r.companyId,
          divisionId: null,
          branchId: null,
          kind: 'supplier',
          name: r.lenderName,
          linked: r.supplierId,
        });
      }
      case 'receivables': {
        const r = await tx.receivable.findFirst({
          where: { id, deletedAt: null },
          select: {
            companyId: true,
            divisionId: true,
            branchId: true,
            customerName: true,
            customerId: true,
          },
        });
        return r && pick({ ...r, kind: 'customer', name: r.customerName, linked: r.customerId });
      }
      case 'payables': {
        const r = await tx.payable.findFirst({
          where: { id, deletedAt: null },
          select: {
            companyId: true,
            divisionId: true,
            branchId: true,
            supplierName: true,
            supplierId: true,
          },
        });
        return r && pick({ ...r, kind: 'supplier', name: r.supplierName, linked: r.supplierId });
      }
    }
  }

  private async apply(
    tx: Tx,
    source: PartyLinkSource,
    id: string,
    kind: PartyKind,
    partyId: string,
    companyId: string,
    user: AuthUser,
    partyName: string,
  ) {
    switch (source) {
      case 'cash_desk_movements':
        await tx.cashDeskMovement.update({
          where: { id },
          data: { supplierId: partyId, partyType: 'SUPPLIER' },
        });
        return;
      case 'expenses':
        await tx.expense.update({ where: { id }, data: { supplierId: partyId } });
        // The accrual payable raised from this expense follows it.
        await tx.payable.updateMany({
          where: { companyId, sourceType: 'Expense', sourceId: id, supplierId: null },
          data: { supplierId: partyId },
        });
        await refreshCachedPartyBalance(tx, 'supplier', companyId, partyId);
        return;
      case 'record_entries':
        await tx.recordEntry.update({
          where: { id },
          data: kind === 'supplier' ? { supplierId: partyId } : { customerId: partyId },
        });
        // Records' own activity log; nothing else in Records changes and no ERP table is written.
        await tx.recordEvent.create({
          data: {
            recordId: id,
            actorId: user.id,
            actorName: user.fullName || user.email,
            action: 'PARTY_LINKED',
            detail: `Linked to shared ${kind} ${partyName}`,
          },
        });
        return;
      case 'record_book_expenses':
        await tx.recordBookExpense.update({ where: { id }, data: { supplierId: partyId } });
        return;
      case 'debts':
        await tx.debt.update({ where: { id }, data: { supplierId: partyId } });
        return;
      case 'contracts':
        await tx.contract.update({
          where: { id },
          data: kind === 'supplier' ? { supplierId: partyId } : { customerId: partyId },
        });
        return;
      case 'loans':
        await tx.loan.update({ where: { id }, data: { supplierId: partyId } });
        return;
      case 'receivables':
        await tx.receivable.update({ where: { id }, data: { customerId: partyId } });
        await refreshCachedPartyBalance(tx, 'customer', companyId, partyId);
        return;
      case 'payables':
        await tx.payable.update({ where: { id }, data: { supplierId: partyId } });
        await refreshCachedPartyBalance(tx, 'supplier', companyId, partyId);
        return;
    }
  }

  private async linkInTransaction(
    tx: Tx,
    user: AuthUser,
    source: PartyLinkSource,
    rowId: string,
    partyId: string,
  ) {
    if (!(PARTY_LINK_SOURCES as readonly string[]).includes(source))
      throw new BadRequestException('Unknown matching source.');
    await this.lock(tx, source, rowId);
    const row = (await this.current(tx, source, rowId)) as {
      companyId: string;
      divisionId: string | null;
      branchId: string | null;
      kind: PartyKind;
      name: string;
      linked: string | null;
    } | null;
    if (!row) throw new NotFoundException(`${SOURCE_LABELS[source]} not found.`);
    this.requirePermissions(user, source, row.kind);
    await this.companies.assertCanAccessCompany(user, row.companyId, AccessLevel.WRITE);
    if (row.divisionId || row.branchId)
      await this.org.assertCanAccessScope(user, row.divisionId, row.branchId, AccessLevel.WRITE);

    const master =
      row.kind === 'supplier'
        ? await tx.supplier.findFirst({
            where: { id: partyId, companyId: row.companyId, deletedAt: null, status: 'ACTIVE' },
            select: { id: true, name: true },
          })
        : await tx.customer.findFirst({
            where: { id: partyId, companyId: row.companyId, deletedAt: null, status: 'ACTIVE' },
            select: { id: true, name: true },
          });
    if (!master)
      throw new BadRequestException(
        `Choose an active ${row.kind} in the same company (${SOURCE_LABELS[source]}: ${row.name}).`,
      );

    if (row.linked === partyId)
      return {
        source,
        rowId,
        companyId: row.companyId,
        kind: row.kind,
        name: row.name,
        partyId,
        partyName: master.name,
        alreadyLinked: true,
      };
    if (row.linked)
      throw new ConflictException(
        `${SOURCE_LABELS[source]} "${row.name}" is already linked to a different ${row.kind}.`,
      );

    await this.apply(tx, source, rowId, row.kind, partyId, row.companyId, user, master.name);
    return {
      source,
      rowId,
      companyId: row.companyId,
      kind: row.kind,
      name: row.name,
      partyId,
      partyName: master.name,
      alreadyLinked: false,
    };
  }
}
