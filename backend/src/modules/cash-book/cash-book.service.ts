import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CashDeskAccount, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { checkDailyBalances, payloadKey } from '../cash-desk/cash-desk.domain';

export type CashBookKind = 'SUPPLIER_PAYMENT' | 'CUSTOMER_RECEIPT' | 'EXPENSE' | 'REFUND';
export type CashBookPartyType = 'SUPPLIER' | 'CUSTOMER' | 'NONE';
type Tx = Prisma.TransactionClient;

/** One ERP cash effect to mirror into the Cash Desk cash book. */
export interface CashBookMovementInput {
  kind: CashBookKind;
  companyId: string;
  /** ERP cash account the money left or landed in. */
  cashAccountId: string;
  amount: Prisma.Decimal | number | string;
  currency: string;
  businessDate: Date;
  description: string;
  reference?: string | null;
  /** Unique per business event, e.g. `SupplierPayment:<id>`; a repeat returns the original. */
  requestId: string;
  partyType: CashBookPartyType;
  supplierId?: string | null;
  customerId?: string | null;
  payableId?: string | null;
  receivableId?: string | null;
  expenseId?: string | null;
  refundId?: string | null;
  supplierPaymentId?: string | null;
  customerPaymentId?: string | null;
  /** The ERP journal that already explains this movement; Accounting connections never offers it for posting. */
  journalEntryId: string;
  journalReferenceType: string;
}

const INCOMING: ReadonlySet<CashBookKind> = new Set(['CUSTOMER_RECEIPT']);
const dayUtc = (value: Date) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

/**
 * The cash book (party linkage, W4 / decision D3): Cash Desk is the one cash book.
 *
 * Every ERP cash effect (supplier payment, customer collection, expense payment, refund)
 * writes one CashDeskMovement through this service, in the caller's transaction, carrying
 * the party, the settled document and the journal that already explains it. The movement
 * reaches the mapped Cash Desk account through the existing 1:1 link
 * CashDeskAccount.erpCashAccountId; an ERP account without a mapped desk account is refused
 * so cash never lands in a book nobody can see. ERP CashAccount.currentBalance keeps being
 * maintained by the callers as a derived cache.
 *
 * Connected accounts always mirror into Cash Desk. CASH_BOOK_UNIFIED additionally
 * requires a connection for every ERP account; unmapped legacy accounts can still
 * operate while that stricter rollout is off.
 */
@Injectable()
export class CashBookService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly companies: CompanyScopeService,
    private readonly config: ConfigService,
  ) {}

  enabled(): boolean {
    return this.config.get<string>('CASH_BOOK_UNIFIED', 'false') === 'true';
  }

  /** Mirror connected accounts even when the strict global rollout is off. */
  async recordInTransaction(tx: Tx, user: AuthUser, input: CashBookMovementInput) {
    const mapped = await tx.cashDeskAccount.findUnique({
      where: { erpCashAccountId: input.cashAccountId },
    });
    if (!mapped && !this.enabled()) return null;
    const amount = new Prisma.Decimal(input.amount).toDecimalPlaces(2);
    if (amount.lte(0))
      throw new BadRequestException('Cash movement amount must be greater than zero');
    const businessDate = dayUtc(input.businessDate);
    const key = payloadKey({
      kind: input.kind,
      cashAccountId: input.cashAccountId,
      amount: amount.toFixed(2),
      currency: input.currency,
      businessDate: businessDate.toISOString(),
      journalEntryId: input.journalEntryId,
    });
    const existing = await tx.cashDeskMovement.findUnique({
      where: { requestId: input.requestId },
    });
    if (existing) {
      if (existing.payloadKey !== key)
        throw new ConflictException(
          'This cash movement reference was already used for a different event.',
        );
      return existing;
    }

    const account = await this.requireMappedAccount(tx, input, mapped);
    await this.lockAccount(tx, account);
    const signed = INCOMING.has(input.kind) ? amount : amount.negated();
    const movement = await tx.cashDeskMovement.create({
      data: {
        requestId: input.requestId,
        payloadKey: key,
        kind: input.kind,
        amount,
        currency: input.currency,
        businessDate,
        description: input.description.slice(0, 500),
        reference: (input.reference ?? '').slice(0, 160),
        createdBy: user.id,
        actorName: user.fullName || user.email,
        partyType: input.partyType,
        supplierId: input.partyType === 'SUPPLIER' ? (input.supplierId ?? null) : null,
        customerId: input.partyType === 'CUSTOMER' ? (input.customerId ?? null) : null,
        payableId: input.payableId ?? null,
        receivableId: input.receivableId ?? null,
        expenseId: input.expenseId ?? null,
        refundId: input.refundId ?? null,
        supplierPaymentId: input.supplierPaymentId ?? null,
        customerPaymentId: input.customerPaymentId ?? null,
        journalEntryId: input.journalEntryId,
        journalReferenceType: input.journalReferenceType,
      },
    });
    await this.entry(tx, movement.id, businessDate, account, signed);
    await this.audit.logStrictInTransaction(tx, {
      action: `CASH_BOOK_${input.kind}`,
      entityType: 'CashDeskMovement',
      entityId: movement.id,
      companyId: account.companyId,
      userId: user.id,
    });
    return movement;
  }

  /**
   * Reverse a movement this service wrote (its payment was reversed). Creates the mirror
   * REVERSAL movement, marks the original reversed and records the reversal journal when
   * the caller posted one. Idempotent: an already reversed movement returns null.
   */
  async reverseInTransaction(
    tx: Tx,
    user: AuthUser,
    movementId: string,
    reason: string | null,
    reversalJournalEntryId?: string | null,
  ) {
    const original = await tx.cashDeskMovement.findUnique({
      where: { id: movementId },
      include: { entries: { include: { account: true } } },
    });
    if (!original || original.reversedAt || original.kind === 'REVERSAL') return null;
    if (!original.journalEntryId)
      throw new ConflictException(
        'This movement was recorded in Cash Desk; reverse it there so the cash book and its posting stay together.',
      );
    const accounts = original.entries.map((e) => e.account);
    for (const account of accounts) await this.lockAccount(tx, account);
    const claimed = await tx.cashDeskMovement.updateMany({
      where: { id: original.id, reversedAt: null },
      data: {
        reversedAt: new Date(),
        reversalReason: (reason ?? 'Payment reversed').slice(0, 500),
      },
    });
    if (claimed.count !== 1) return null;
    const today = dayUtc(new Date());
    const businessDate = today < original.businessDate ? original.businessDate : today;
    const reversal = await tx.cashDeskMovement.create({
      data: {
        requestId: `reversal:${original.requestId}`,
        payloadKey: payloadKey({ reversalOf: original.id }),
        kind: 'REVERSAL',
        amount: original.amount,
        currency: original.currency,
        businessDate,
        description: `Reversal · ${original.description}`.slice(0, 500),
        reference: original.reference,
        createdBy: user.id,
        actorName: user.fullName || user.email,
        reversalOfId: original.id,
        partyType: original.partyType,
        supplierId: original.supplierId,
        customerId: original.customerId,
        payableId: original.payableId,
        receivableId: original.receivableId,
        expenseId: original.expenseId,
        refundId: original.refundId,
        journalEntryId: reversalJournalEntryId ?? null,
        journalReferenceType: reversalJournalEntryId ? original.journalReferenceType : null,
      },
    });
    for (const e of original.entries)
      await this.entry(tx, reversal.id, businessDate, e.account, e.amount.negated());
    await this.audit.logStrictInTransaction(tx, {
      action: 'CASH_BOOK_REVERSAL',
      entityType: 'CashDeskMovement',
      entityId: reversal.id,
      companyId: accounts[0]?.companyId ?? original.entries[0]?.account.companyId,
      userId: user.id,
      metadata: { reversalOfId: original.id, reason },
    });
    return reversal;
  }

  /** Mapped ERP ↔ Cash Desk account pairs with both balances, for the reconciliation view. */
  async reconciliation(user: AuthUser, companyId?: string) {
    if (!['cash_desk.view', 'cash_accounts.view'].every((p) => user.permissions.includes(p)))
      throw new ForbiddenException('Cash Desk and cash accounts view access are required.');
    const pairs = await this.db.cashDeskAccount.findMany({
      where: {
        AND: [
          await this.companies.companyWhereFor(user, companyId),
          { erpCashAccountId: { not: null } },
        ],
      },
      include: {
        erpCashAccount: {
          select: { id: true, accountName: true, currentBalance: true, currency: true },
        },
      },
      orderBy: [{ name: 'asc' }],
    });
    return {
      enabled: this.enabled(),
      pairs: pairs.map((desk) => {
        const erp = desk.erpCashAccount!;
        const difference = new Prisma.Decimal(erp.currentBalance).minus(desk.balance);
        return {
          cashDeskAccountId: desk.id,
          cashDeskAccountName: desk.name,
          cashAccountId: erp.id,
          cashAccountName: erp.accountName,
          currency: desk.currency,
          cashDeskBalance: desk.balance.toFixed(2),
          erpBalance: new Prisma.Decimal(erp.currentBalance).toFixed(2),
          difference: difference.toFixed(2),
          status: difference.isZero() ? 'In step' : 'Needs review',
        };
      }),
    };
  }

  /** ERP cash accounts with no Cash Desk connection; payments from them are refused while the flag is on. */
  async unmapped(user: AuthUser, companyId?: string) {
    if (!['cash_desk.view', 'cash_accounts.view'].every((p) => user.permissions.includes(p)))
      throw new ForbiddenException('Cash Desk and cash accounts view access are required.');
    const rows = await this.db.cashAccount.findMany({
      where: {
        AND: [
          await this.companies.companyWhereFor(user, companyId),
          { deletedAt: null, isActive: true, deskAccount: null },
        ],
      },
      select: {
        id: true,
        accountName: true,
        accountType: true,
        currency: true,
        companyId: true,
        divisionId: true,
        branchId: true,
      },
      orderBy: [{ accountName: 'asc' }],
    });
    return { enabled: this.enabled(), accounts: rows };
  }

  // ── helpers ───────────────────────────────────────────────────────────────────

  private async requireMappedAccount(
    tx: Tx,
    input: CashBookMovementInput,
    account: CashDeskAccount | null,
  ) {
    if (!account) {
      const erp = await tx.cashAccount.findUnique({
        where: { id: input.cashAccountId },
        select: { accountName: true },
      });
      throw new BadRequestException(
        `Connect cash account ${erp?.accountName ?? input.cashAccountId} to a Cash Desk account (Cash Desk → Accounts) before recording payments from it.`,
      );
    }
    if (account.companyId !== input.companyId)
      throw new BadRequestException(
        'The Cash Desk account connected to this cash account belongs to another company.',
      );
    if (account.currency !== input.currency)
      throw new BadRequestException(
        `The connected Cash Desk account is in ${account.currency}; this payment is in ${input.currency}.`,
      );
    return account;
  }

  private async lockAccount(tx: Tx, account: CashDeskAccount) {
    const locked = await tx.cashDeskAccount.updateMany({
      where: { id: account.id, version: account.version },
      data: { version: { increment: 1 } },
    });
    if (locked.count !== 1)
      throw new ConflictException(
        'The Cash Desk account changed. Refresh its balance before trying again.',
      );
    account.version += 1;
  }

  /** One signed entry plus the account balance, with the same daily non-negative rule as Cash Desk. */
  private async entry(
    tx: Tx,
    movementId: string,
    date: Date,
    account: CashDeskAccount,
    amount: Prisma.Decimal,
  ) {
    if (date < account.openingDate)
      throw new BadRequestException(
        'A movement cannot precede the Cash Desk account opening date.',
      );
    const daily = await tx.cashDeskEntry.groupBy({
      by: ['businessDate'],
      where: { accountId: account.id },
      _sum: { amount: true },
    });
    const balance = checkDailyBalances(
      daily.map((r) => ({ businessDate: r.businessDate, amount: r._sum.amount! })),
      date,
      amount,
    );
    await tx.cashDeskEntry.create({
      data: {
        movementId,
        accountId: account.id,
        businessDate: date,
        amount,
        erpBalanceApplied: true,
      },
    });
    await tx.cashDeskAccount.update({ where: { id: account.id }, data: { balance } });
  }
}
