import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessLevel,
  AuditSeverity,
  CashAccountType,
  ExternalPaymentContext,
  ExternalPaymentMethod,
  ExternalPaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateExternalPaymentDto } from './dto/create-external-payment.dto';
import { QueryExternalPaymentDto } from './dto/query-external-payment.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  applyCompanyScopeWhere,
  CompanyScopeService,
  resolveCashAccountForScope,
} from '../../common/services';
import {
  AccountResolverService,
  AccountRole,
} from '../../common/services/account-resolver.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';

/**
 * Receivable statuses that still carry an outstanding balance and therefore can
 * be relieved by a confirmed external payment. PAID is settled; WRITTEN_OFF /
 * CANCELLED are closed and must NOT be relieved (nor resurrected on reverse).
 */
const OPEN_RECEIVABLE_STATUSES = ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] as const;

/**
 * paymentContextType values whose paymentContextId points (directly or via a
 * SalesOrder) at a customer Receivable we should relieve on confirm.
 */
const RECEIVABLE_CONTEXTS: ExternalPaymentContext[] = [
  ExternalPaymentContext.RECEIVABLE,
  ExternalPaymentContext.SALES_ORDER,
];

/** Locked snapshot of a receivable row read FOR UPDATE inside the transaction. */
interface LockedReceivable {
  id: string;
  companyId: string;
  divisionId: string | null;
  branchId: string | null;
  customerId: string | null;
  customerName: string | null;
  outstandingAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  status: string;
  currency: string | null;
  sourceType: string | null;
  sourceId: string | null;
}

@Injectable()
export class ExternalPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly accountResolver: AccountResolverService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  private buildSelect(includeSensitive: boolean) {
    const base: any = {
      id: true,
      paymentNumber: true,
      companyId: true,
      providerId: true,
      connectionId: true,
      paymentContextType: true,
      paymentContextId: true,
      externalReference: true,
      payerName: true,
      payerPhone: true,
      amount: true,
      currency: true,
      paymentMethod: true,
      status: true,
      initiatedById: true,
      confirmedById: true,
      initiatedAt: true,
      confirmedAt: true,
      failureReason: true,
      createdAt: true,
      updatedAt: true,
    };
    if (includeSensitive) base.rawProviderResponse = true;
    return base;
  }

  async findAll(query: QueryExternalPaymentDto, includeSensitive: boolean, user?: any) {
    const { page = 1, limit = 20, companyId, providerId, status, paymentContextType } = query;
    const pageNumber = Number(page) || 1;
    const limitNumber = Number(limit) || 20;
    const skip = (pageNumber - 1) * limitNumber;
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (providerId) where.providerId = providerId;
    if (status) where.status = status;
    if (paymentContextType) where.paymentContextType = paymentContextType;

    const [data, total] = await Promise.all([
      this.prisma.externalPayment.findMany({
        where,
        select: this.buildSelect(includeSensitive),
        orderBy: { initiatedAt: 'desc' },
        skip,
        take: limitNumber,
      }),
      this.prisma.externalPayment.count({ where }),
    ]);
    return {
      data,
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber),
    };
  }

  async findOne(id: string, includeSensitive: boolean, user: AuthUser) {
    const record = await this.prisma.externalPayment.findFirst({
      where: { id, deletedAt: null },
      select: this.buildSelect(includeSensitive),
    });
    if (!record) throw new NotFoundException('External payment not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId);
    return record;
  }

  async findOneForCompany(id: string, includeSensitive: boolean, companyId: string) {
    const record = await this.prisma.externalPayment.findFirst({
      where: { id, deletedAt: null, companyId },
      select: this.buildSelect(includeSensitive),
    });
    if (!record) throw new NotFoundException('External payment not found');
    return record;
  }

  async create(dto: CreateExternalPaymentDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    return this.createTrusted(dto, user.id);
  }

  async createForCompany(dto: CreateExternalPaymentDto, actorId: string, companyId: string) {
    return this.createTrusted({ ...dto, companyId }, null, { integrationActorId: actorId });
  }

  private async createTrusted(
    dto: CreateExternalPaymentDto,
    userId: string | null,
    metadata?: Record<string, unknown>,
  ) {
    // ITMB-AUDIT-31: the idempotency guard must survive concurrent retries carrying the
    // same key. A bare findFirst-then-create races: two simultaneous requests both miss
    // the replay lookup and both create(), so the second hits the
    // @@unique([companyId, idempotencyKey]) index and 500s instead of replaying. The single
    // create is itself atomic, and the unique index is the source of truth; on the
    // unique-violation (P2002) we re-run the replay lookup and return the winning row
    // instead of rethrowing — mirroring the sales-order createAndConfirm pattern.
    if (dto.idempotencyKey) {
      const replay = await this.replayByIdempotencyKey(dto.companyId, dto.idempotencyKey);
      if (replay) return replay;
    }

    let record: Awaited<ReturnType<typeof this.insertPayment>>;
    try {
      record = await this.insertPayment(dto, userId);
    } catch (error) {
      if (
        dto.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replay = await this.replayByIdempotencyKey(dto.companyId, dto.idempotencyKey);
        if (replay) return replay;
      }
      throw error;
    }

    await this.auditLogs.log({
      action: 'EXTERNAL_PAYMENT_CREATED',
      entityType: 'ExternalPayment',
      entityId: record.id,
      userId: userId ?? undefined,
      companyId: record.companyId,
      newValue: record as any,
      metadata,
      severity: AuditSeverity.MEDIUM,
    });

    return record;
  }

  private async replayByIdempotencyKey(companyId: string, idempotencyKey: string) {
    return this.prisma.externalPayment.findFirst({
      where: {
        companyId,
        idempotencyKey,
        deletedAt: null,
      },
      select: this.buildSelect(false),
    });
  }

  private async insertPayment(dto: CreateExternalPaymentDto, userId: string | null) {
    const paymentNumber = `PAY-${Date.now().toString(36).toUpperCase()}`;
    return this.prisma.externalPayment.create({
      data: {
        paymentNumber,
        companyId: dto.companyId,
        providerId: dto.providerId,
        connectionId: dto.connectionId,
        paymentContextType: dto.paymentContextType,
        paymentContextId: dto.paymentContextId,
        externalReference: dto.externalReference,
        payerName: dto.payerName,
        payerPhone: dto.payerPhone,
        amount: dto.amount,
        currency: dto.currency ?? 'TZS',
        paymentMethod: dto.paymentMethod,
        status: ExternalPaymentStatus.INITIATED,
        initiatedById: userId ?? null,
        idempotencyKey: dto.idempotencyKey,
      },
      select: this.buildSelect(false),
    });
  }

  async confirm(id: string, user: AuthUser) {
    const record = await this.prisma.externalPayment.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('External payment not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, AccessLevel.WRITE);
    return this.confirmTrusted(record, user.id);
  }

  async confirmForCompany(id: string, actorId: string, companyId: string) {
    const record = await this.prisma.externalPayment.findFirst({
      where: { id, deletedAt: null, companyId },
    });
    if (!record) throw new NotFoundException('External payment not found');
    return this.confirmTrusted(record, null, { integrationActorId: actorId });
  }

  private async confirmTrusted(
    record: Awaited<ReturnType<PrismaService['externalPayment']['findFirst']>>,
    userId: string | null,
    metadata?: Record<string, unknown>,
  ) {
    if (!record) throw new NotFoundException('External payment not found');
    if (record.status === ExternalPaymentStatus.SUCCESS) {
      // Idempotent: already confirmed (and already posted). Do NOT re-post.
      return this.prisma.externalPayment.findUnique({
        where: { id: record.id },
        select: this.buildSelect(false),
      });
    }
    if (
      record.status !== ExternalPaymentStatus.INITIATED &&
      record.status !== ExternalPaymentStatus.PENDING
    ) {
      throw new BadRequestException('Payment cannot be confirmed in its current status');
    }

    // Everything — the atomic status claim, the balanced GL posting, the AR
    // relief, and the CashAccount balance bump — runs in ONE transaction so a
    // confirmed external payment either lands fully in finance or not at all.
    const { updated, posted, financePosted } = await this.prisma.$transaction(async (tx) => {
      // ITMB-078: close the check-then-act race with a conditional atomic update
      // guarded on the current status so concurrent confirms cannot both win.
      // The winner (count === 1) is the ONLY caller that posts the GL below —
      // this is also the idempotency guard against double-posting on re-confirm.
      const { count } = await tx.externalPayment.updateMany({
        where: {
          id: record.id,
          status: { in: [ExternalPaymentStatus.INITIATED, ExternalPaymentStatus.PENDING] },
        },
        data: {
          status: ExternalPaymentStatus.SUCCESS,
          confirmedById: userId ?? null,
          confirmedAt: new Date(),
        },
      });
      if (count === 0) {
        // Another request already transitioned the row; return its state and do
        // NOT post again (the winner already posted).
        const current = await tx.externalPayment.findUnique({ where: { id: record.id } });
        if (current?.status === ExternalPaymentStatus.SUCCESS) {
          const view = await tx.externalPayment.findUnique({
            where: { id: record.id },
            select: this.buildSelect(false),
          });
          return { updated: view, posted: false, financePosted: false };
        }
        throw new BadRequestException('Payment cannot be confirmed in its current status');
      }

      // We won the claim — post finance in the SAME transaction. financePosted
      // is false only when the company has no resolvable chart of accounts: the
      // confirm still lands (the provider already captured the money) but the
      // audit entry below flags the unposted receipt so it is never invisible.
      const financePosted = await this.postConfirmation(tx, record, userId);

      const view = await tx.externalPayment.findUnique({
        where: { id: record.id },
        select: this.buildSelect(false),
      });
      return { updated: view, posted: true, financePosted };
    });

    if (posted) {
      await this.auditLogs.log({
        action: 'EXTERNAL_PAYMENT_CONFIRMED',
        entityType: 'ExternalPayment',
        entityId: record.id,
        userId: userId ?? undefined,
        companyId: record.companyId,
        metadata: {
          ...((metadata as Record<string, unknown>) ?? {}),
          financePosted,
          ...(financePosted ? {} : { unpostedReason: 'chart-of-accounts-not-configured' }),
        },
        severity: financePosted ? AuditSeverity.MEDIUM : AuditSeverity.HIGH,
      });
    }

    return updated;
  }

  async reverse(id: string, user: AuthUser) {
    const record = await this.prisma.externalPayment.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('External payment not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, AccessLevel.WRITE);
    return this.reverseTrusted(record, user.id);
  }

  async reverseForCompany(id: string, actorId: string, companyId: string) {
    const record = await this.prisma.externalPayment.findFirst({
      where: { id, deletedAt: null, companyId },
    });
    if (!record) throw new NotFoundException('External payment not found');
    return this.reverseTrusted(record, null, { integrationActorId: actorId });
  }

  private async reverseTrusted(
    record: Awaited<ReturnType<PrismaService['externalPayment']['findFirst']>>,
    userId: string | null,
    metadata?: Record<string, unknown>,
  ) {
    if (!record) throw new NotFoundException('External payment not found');
    if (record.status === ExternalPaymentStatus.REVERSED) {
      return this.prisma.externalPayment.findUnique({
        where: { id: record.id },
        select: this.buildSelect(false),
      });
    }
    if (record.status !== ExternalPaymentStatus.SUCCESS) {
      throw new BadRequestException('Only successful payments can be reversed');
    }

    // Mirror the confirm posting in reverse — status claim, AR restore, mirror
    // JE, and CashAccount unwind — all in ONE transaction.
    const { updated, reversed } = await this.prisma.$transaction(async (tx) => {
      // ITMB-078: close the check-then-act race with a conditional atomic update
      // guarded on the SUCCESS status so concurrent reversals cannot both win.
      const { count } = await tx.externalPayment.updateMany({
        where: {
          id: record.id,
          status: ExternalPaymentStatus.SUCCESS,
        },
        data: { status: ExternalPaymentStatus.REVERSED },
      });
      if (count === 0) {
        // Another request already transitioned the row; return its state and do
        // NOT unwind again (the winner already unwound).
        const current = await tx.externalPayment.findUnique({ where: { id: record.id } });
        if (current?.status === ExternalPaymentStatus.REVERSED) {
          const view = await tx.externalPayment.findUnique({
            where: { id: record.id },
            select: this.buildSelect(false),
          });
          return { updated: view, reversed: false };
        }
        throw new BadRequestException('Only successful payments can be reversed');
      }

      // We won the claim — unwind finance in the SAME transaction.
      await this.reverseConfirmation(tx, record, userId);

      const view = await tx.externalPayment.findUnique({
        where: { id: record.id },
        select: this.buildSelect(false),
      });
      return { updated: view, reversed: true };
    });

    if (reversed) {
      await this.auditLogs.log({
        action: 'EXTERNAL_PAYMENT_REVERSED',
        entityType: 'ExternalPayment',
        entityId: record.id,
        userId: userId ?? undefined,
        companyId: record.companyId,
        metadata,
        severity: AuditSeverity.HIGH,
      });
    }

    return updated;
  }

  // ── finance posting ──────────────────────────────────────────────────────────

  /**
   * Post the confirmation of an external payment to finance, inside the caller's
   * transaction. Emits a balanced JE and keeps the matching subledgers in step:
   *
   *   DR Cash|Bank            amount              (payment method → BANK/CASH role)
   *   CR AR control           min(amount, outstanding)   [linked receivable]
   *   CR Customer advance     remainder                  [overpayment / standalone]
   *
   * When the payment references a Receivable (context RECEIVABLE, or SALES_ORDER
   * whose SalesOrder carries a receivableId) that receivable's outstanding is
   * relieved, the source SalesOrder + customer balance are synced, and the
   * receiving CashAccount.currentBalance is incremented (and the account id
   * stamped on the payment row for the reversal to unwind) — all atomically.
   * When there is no linked receivable — or the receivable is closed, or is
   * denominated in a different currency than the receipt — the whole amount is
   * a customer-advance receipt (CR advance / AR credit), so the money is never
   * dropped from the GL and a receivable is never relieved 1:1 across currencies.
   */
  private async postConfirmation(
    tx: Prisma.TransactionClient,
    record: NonNullable<Awaited<ReturnType<PrismaService['externalPayment']['findFirst']>>>,
    userId: string | null,
  ): Promise<boolean> {
    const amount = new Prisma.Decimal(record.amount).toDecimalPlaces(2);
    if (amount.lte(0)) {
      throw new BadRequestException('External payment amount must be greater than zero');
    }

    // JournalEntry.createdById is a required FK. The integration path posts with
    // userId=null, so resolve a real posting actor (interactive user →
    // confirmer/initiator → any active company user) or fail closed.
    const actorId = await this.resolvePostingActorId(tx, record, userId);

    // Resolve a receiving cash/bank account. External payments carry no
    // cashAccountId and no branch of their own, so the linked receivable's
    // division/branch (peeked under the same row lock relief takes below) is
    // the branch context: the drawer/float that physically collected the
    // money. We pick a company cash account whose type matches the payment
    // method (BANK for transfers/cards, else cash-on-hand), preferring that
    // branch's account and never one scoped to a DIFFERENT branch. If one
    // exists we bump its denormalised currentBalance and drive the GL cash
    // role from its type; if none exists we still post the GL cash leg by
    // method.
    const linkedScope = await this.peekLinkedReceivableScope(tx, record);
    const cashAccount = await this.resolveReceivingCashAccount(
      tx,
      record.companyId,
      record.paymentMethod,
      record.currency,
      linkedScope,
    );
    const cashRole: AccountRole = cashAccount
      ? this.cashAccountRole(cashAccount.accountType)
      : this.methodCashRole(record.paymentMethod);

    // Resolve the required ledger accounts BEFORE touching any row. A company
    // that has not configured its chart of accounts (no cash/AR-control entry)
    // must still be able to confirm — the provider has already captured the
    // money, so failing the confirm would only strand provider truth in a retry
    // loop. In that case we skip the posting entirely (the caller records
    // financePosted=false in the audit trail so the money is never silently
    // invisible) and the reverse path treats the payment as a legacy no-JE
    // confirm. Any other posting failure still fails the whole confirm.
    let cashAcct: { id: string };
    let arAcct: { id: string };
    try {
      [cashAcct, arAcct] = await Promise.all([
        this.accountResolver.resolve(record.companyId, cashRole, tx),
        this.accountResolver.resolve(record.companyId, 'AR_CONTROL', tx),
      ]);
    } catch (err) {
      if (
        err instanceof BadRequestException &&
        String(err.message).startsWith('Cannot resolve chart-of-accounts entry')
      ) {
        return false;
      }
      throw err;
    }

    // Locate + relieve the linked receivable (if any).
    const relief = await this.relieveLinkedReceivable(tx, record, amount);

    const divisionId = relief?.divisionId ?? cashAccount?.divisionId ?? null;
    const branchId = relief?.branchId ?? cashAccount?.branchId ?? null;
    const customerLabel =
      relief?.customerName ?? record.payerName ?? record.paymentContextId ?? 'external payer';

    const appliedToAr = relief?.applied ?? new Prisma.Decimal(0);
    const advanceAmount = amount.minus(appliedToAr).toDecimalPlaces(2);

    const lines: Array<{
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      description: string;
    }> = [
      {
        accountId: cashAcct.id,
        debit: amount,
        credit: new Prisma.Decimal(0),
        description: `External payment ${record.paymentNumber} received (${record.paymentMethod ?? 'external'})`,
      },
    ];

    if (appliedToAr.gt(0)) {
      lines.push({
        accountId: arAcct.id,
        debit: new Prisma.Decimal(0),
        credit: appliedToAr,
        description: `Settle receivable: ${customerLabel}`,
      });
    }

    if (advanceAmount.gt(0)) {
      // Overpayment beyond the linked receivable, OR a standalone / advance
      // receipt with no receivable at all: park the remainder on a
      // customer-advance liability (matching customer-payments overpayment
      // handling); fall back to AR control when no advance account is configured.
      const advanceAccountId = await this.resolveCustomerAdvanceAccountId(tx, record.companyId);
      if (advanceAccountId && advanceAccountId === cashAcct.id) {
        throw new ConflictException(
          `Customer-advance account resolves to the same account as the cash/bank ` +
            `receipt account (${cashAcct.id}); refusing to post a self-cancelling ` +
            `advance line. Fix the chart of accounts mapping.`,
        );
      }
      if (advanceAccountId && advanceAccountId !== arAcct.id) {
        lines.push({
          accountId: advanceAccountId,
          debit: new Prisma.Decimal(0),
          credit: advanceAmount,
          description: `Customer advance / credit on account: ${customerLabel}`,
        });
      } else {
        lines.push({
          accountId: arAcct.id,
          debit: new Prisma.Decimal(0),
          credit: advanceAmount,
          description:
            `Customer advance held in AR (no customer-advance account configured): ` +
            `${customerLabel}`,
        });
      }
    }

    await this.postingEngine.postLines(
      {
        companyId: record.companyId,
        divisionId,
        branchId,
        transactionDate: record.confirmedAt ?? new Date(),
        description: `External payment ${record.paymentNumber}`,
        referenceType: 'ExternalPayment',
        referenceId: record.id,
        moduleName: 'external-payments',
        userId: actorId,
        lines,
      },
      tx,
    );

    // Keep the denormalised CashAccount.currentBalance (a subledger cache read by
    // finance dashboards) consistent with the DR Cash/Bank leg we just posted —
    // incremented by the FULL receipt amount, in the SAME transaction. Stamp the
    // account we incremented on the payment row (same transaction) so reversal
    // unwinds exactly this account, immune to roster changes between confirm and
    // reverse.
    if (cashAccount) {
      await tx.externalPayment.update({
        where: { id: record.id },
        data: { receivingCashAccountId: cashAccount.id },
      });
      await tx.cashAccount.updateMany({
        where: { id: cashAccount.id, companyId: record.companyId, deletedAt: null },
        data: { currentBalance: { increment: amount } },
      });
    }
    return true;
  }

  /**
   * Unwind a confirmed external payment's finance postings inside the caller's
   * transaction: restore the linked receivable's outstanding (by exactly the
   * amount this payment applied on confirm), resync the source SalesOrder +
   * customer balance, post the mirror-reversing JE (swap Dr/Cr on every original
   * line), and decrement the CashAccount.currentBalance that confirm incremented.
   * A payment with no confirmation JE (confirmed before this posting path
   * existed) is reversed as a pure status flip — nothing to unwind.
   */
  private async reverseConfirmation(
    tx: Prisma.TransactionClient,
    record: NonNullable<Awaited<ReturnType<PrismaService['externalPayment']['findFirst']>>>,
    userId: string | null,
  ): Promise<void> {
    const amount = new Prisma.Decimal(record.amount).toDecimalPlaces(2);

    // JournalEntry.createdById on the mirror JE is a required FK — resolve a real
    // posting actor (integration path has userId=null) before posting anything.
    const actorId = await this.resolvePostingActorId(tx, record, userId);

    // Find the original confirmation JE by reference (no journalEntryId column on
    // ExternalPayment; the JE is tagged referenceType/referenceId at post time).
    const original = await tx.journalEntry.findFirst({
      where: {
        companyId: record.companyId,
        referenceType: 'ExternalPayment',
        referenceId: record.id,
        status: { not: 'REVERSED' },
        deletedAt: null,
      },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!original || original.lines.length === 0) {
      // No confirmation JE exists (or it was already reversed). The JE is the
      // marker that confirm posted subledger relief — postConfirmation posts the
      // relief and the JE in the SAME transaction — so a payment confirmed
      // before this posting path existed (legacy: pure status flip, no JE, no
      // receivable relief, no cash bump) is reversed as a pure status flip too.
      // Touch NOTHING here: restoring a receivable this payment never relieved
      // would erase other payments' legitimate relief with no GL counterpart.
      return;
    }

    // Restore only what THIS payment actually applied to the receivable on
    // confirm, derived from the original JE's AR-control "Settle receivable"
    // credit line(s). The description guard excludes the "Customer advance held
    // in AR" fallback line, which also credits AR control but never relieved
    // the receivable. Zero applied (receivable already PAID at confirm — whole
    // receipt parked as an advance) makes the restore a no-op, so we never
    // reopen a receivable this payment never relieved, and never over-restore
    // relief that belongs to other payments.
    const arAcct = await this.accountResolver.resolve(record.companyId, 'AR_CONTROL', tx);
    const appliedToAr = original.lines
      .filter(
        (line) =>
          line.accountId === arAcct.id && (line.description ?? '').startsWith('Settle receivable'),
      )
      .reduce((sum, line) => sum.plus(new Prisma.Decimal(line.credit ?? 0)), new Prisma.Decimal(0))
      .toDecimalPlaces(2);

    const restored = appliedToAr.gt(0)
      ? await this.restoreLinkedReceivable(tx, record, appliedToAr)
      : null;

    // Claim the original JE as REVERSED so a concurrent reverse posts at most one
    // mirror. Losing the claim (count !== 1) means someone else already unwound.
    const claim = await tx.journalEntry.updateMany({
      where: { id: original.id, status: { not: 'REVERSED' }, deletedAt: null },
      data: { status: 'REVERSED', reversedAt: new Date(), reversedById: actorId },
    });
    if (claim.count !== 1) {
      throw new ConflictException(
        'External payment reversal could not claim its journal entry; reversal aborted',
      );
    }

    const reversedLines = original.lines.map((line) => ({
      accountId: line.accountId,
      debit: new Prisma.Decimal(line.credit ?? 0).toDecimalPlaces(2),
      credit: new Prisma.Decimal(line.debit ?? 0).toDecimalPlaces(2),
      description: `Reversal: ${line.description ?? ''}`.trim(),
      divisionId: line.divisionId ?? undefined,
      branchId: line.branchId ?? undefined,
    }));

    await this.postingEngine.postLines(
      {
        companyId: original.companyId,
        divisionId: original.divisionId,
        branchId: original.branchId,
        transactionDate: new Date(),
        description: `Reversal of external payment ${record.paymentNumber}`,
        referenceType: 'ExternalPayment',
        referenceId: record.id,
        moduleName: 'external-payments',
        userId: actorId,
        lines: reversedLines,
      },
      tx,
    );

    // Unwind the CashAccount.currentBalance increment, mirroring the CR Cash/Bank
    // side of the reversal JE. Confirm stamps the account it actually incremented
    // (receivingCashAccountId) in the same transaction as the increment, so we
    // decrement exactly that row — deliberately NOT filtered on isActive, so an
    // account deactivated since confirm is still unwound rather than pushing the
    // decrement onto a different account's cache.
    if (record.receivingCashAccountId) {
      await tx.cashAccount.updateMany({
        where: { id: record.receivingCashAccountId, companyId: record.companyId },
        data: { currentBalance: { decrement: amount } },
      });
    } else {
      // Legacy row confirmed before receivingCashAccountId existed: best-effort
      // fallback to the same method/currency/branch resolution confirm uses —
      // including the linked receivable's branch context, so the re-resolution
      // stays consistent with the confirm path. (Rows confirmed after the
      // column exists always carry the stamp when a cache was bumped, so a
      // null stamp on a new row means confirm bumped nothing — but we cannot
      // distinguish that from a legacy row, so we re-resolve.)
      const linkedScope = await this.peekLinkedReceivableScope(tx, record);
      const cashAccount = await this.resolveReceivingCashAccount(
        tx,
        record.companyId,
        record.paymentMethod,
        record.currency,
        linkedScope,
      );
      if (cashAccount) {
        await tx.cashAccount.updateMany({
          where: { id: cashAccount.id, companyId: record.companyId, deletedAt: null },
          data: { currentBalance: { decrement: amount } },
        });
      }
    }

    // syncCustomerBalance is a defensive resync in case restoreLinkedReceivable
    // touched a receivable whose customer balance needs recomputing.
    if (restored?.customerId) {
      await this.syncCustomerBalance(tx, record.companyId, restored.customerId);
    }
  }

  // ── receivable relief helpers ─────────────────────────────────────────────────

  /**
   * Resolve, lock, and relieve the Receivable linked to this external payment.
   * Returns the applied amount (min of payment and outstanding) plus scope so the
   * caller can post AR + sync. Returns null when the payment is standalone (no
   * receivable context, or a context that does not resolve to a receivable).
   */
  private async relieveLinkedReceivable(
    tx: Prisma.TransactionClient,
    record: NonNullable<Awaited<ReturnType<PrismaService['externalPayment']['findFirst']>>>,
    amount: Prisma.Decimal,
  ): Promise<{
    applied: Prisma.Decimal;
    divisionId: string | null;
    branchId: string | null;
    customerId: string | null;
    customerName: string | null;
  } | null> {
    const receivableId = await this.resolveReceivableId(tx, record);
    if (!receivableId) return null;

    const locked = await this.lockReceivable(tx, receivableId);
    if (!locked) throw new NotFoundException(`Receivable ${receivableId} not found`);
    if (locked.companyId !== record.companyId) {
      throw new BadRequestException(
        `Receivable ${receivableId} does not belong to company ${record.companyId}`,
      );
    }
    if (!(OPEN_RECEIVABLE_STATUSES as readonly string[]).includes(locked.status)) {
      // Closed/settled receivable — treat the whole receipt as an advance rather
      // than forcing a partial relief onto a PAID/WRITTEN_OFF/CANCELLED row.
      return null;
    }

    // Currency guard: never relieve a receivable denominated in a different
    // currency than the receipt — amounts are stored as bare numbers, so a 1:1
    // numeric relief would be off by the full exchange rate (USD 100 would
    // "settle" TZS 100 of a TZS receivable). Unlike customer-payments (which is
    // user-initiated and can refuse the receipt outright), an external payment
    // has already been captured by the provider — the money is real and must
    // land in the GL — so we route the ENTIRE amount to customer advance
    // (return null → caller posts the full receipt as an advance) for manual
    // application at a proper exchange rate, leaving the receivable untouched.
    const paymentCurrency = record.currency ?? 'TZS';
    if (locked.currency && locked.currency !== paymentCurrency) {
      return null;
    }

    const outstanding = new Prisma.Decimal(locked.outstandingAmount).toDecimalPlaces(2);
    const applied = Prisma.Decimal.min(amount, outstanding).toDecimalPlaces(2);
    if (applied.lte(0)) return null;

    const nextOutstanding = outstanding.minus(applied).toDecimalPlaces(2);
    const nextPaid = new Prisma.Decimal(locked.paidAmount).plus(applied).toDecimalPlaces(2);
    const nextStatus = nextOutstanding.isZero() ? 'PAID' : 'PARTIALLY_PAID';

    const updated = await tx.receivable.update({
      where: { id: receivableId },
      data: {
        outstandingAmount: nextOutstanding,
        paidAmount: nextPaid,
        status: nextStatus,
      },
    });
    await this.syncSalesOrderPaymentFromReceivable(tx, updated);
    await this.syncCustomerBalance(tx, record.companyId, updated.customerId);

    return {
      applied,
      divisionId: locked.divisionId,
      branchId: locked.branchId,
      customerId: locked.customerId,
      customerName: locked.customerName,
    };
  }

  /**
   * Restore the linked receivable's outstanding on reversal — the exact inverse
   * of {@link relieveLinkedReceivable}. `cap` is the amount THIS payment
   * actually applied on confirm (derived by the caller from the original JE's
   * AR-control "Settle receivable" credit line), further bounded by the current
   * paid amount, and skipping closed receivables (WRITTEN_OFF / CANCELLED must
   * not be resurrected).
   */
  private async restoreLinkedReceivable(
    tx: Prisma.TransactionClient,
    record: NonNullable<Awaited<ReturnType<PrismaService['externalPayment']['findFirst']>>>,
    cap: Prisma.Decimal,
  ): Promise<{ customerId: string | null } | null> {
    const receivableId = await this.resolveReceivableId(tx, record);
    if (!receivableId) return null;

    const locked = await this.lockReceivable(tx, receivableId);
    if (!locked || locked.companyId !== record.companyId) return null;
    if (locked.status === 'WRITTEN_OFF' || locked.status === 'CANCELLED') return null;

    // Restore only what was actually applied on confirm: min(cap, paidAmount).
    // The cap is this payment's own AR relief (from the original JE), and the
    // paid amount further bounds the restore so we never push outstanding above
    // the original receivable amount.
    const restoreAmount = Prisma.Decimal.min(
      cap,
      new Prisma.Decimal(locked.paidAmount),
    ).toDecimalPlaces(2);
    if (restoreAmount.lte(0)) return { customerId: locked.customerId };

    const restoredOutstanding = new Prisma.Decimal(locked.outstandingAmount)
      .plus(restoreAmount)
      .toDecimalPlaces(2);
    const restoredPaid = Prisma.Decimal.max(
      new Prisma.Decimal(locked.paidAmount).minus(restoreAmount),
      new Prisma.Decimal(0),
    ).toDecimalPlaces(2);
    const restoredStatus = restoredPaid.isZero() ? 'OPEN' : 'PARTIALLY_PAID';

    const updated = await tx.receivable.update({
      where: { id: receivableId },
      data: {
        outstandingAmount: restoredOutstanding,
        paidAmount: restoredPaid,
        status: restoredStatus,
      },
    });
    await this.syncSalesOrderPaymentFromReceivable(tx, updated);
    await this.syncCustomerBalance(tx, record.companyId, updated.customerId);

    return { customerId: updated.customerId };
  }

  /**
   * Map an external payment's context to a target Receivable id:
   *   RECEIVABLE   → paymentContextId IS the receivable id
   *   SALES_ORDER  → paymentContextId is a SalesOrder id → its receivableId
   * All other contexts (and missing ids) resolve to null (standalone receipt).
   */
  private async resolveReceivableId(
    tx: Prisma.TransactionClient,
    record: NonNullable<Awaited<ReturnType<PrismaService['externalPayment']['findFirst']>>>,
  ): Promise<string | null> {
    if (!record.paymentContextId) return null;
    if (!RECEIVABLE_CONTEXTS.includes(record.paymentContextType)) return null;

    if (record.paymentContextType === ExternalPaymentContext.RECEIVABLE) {
      return record.paymentContextId;
    }

    // SALES_ORDER — resolve the order's backing receivable.
    const order = await tx.salesOrder.findFirst({
      where: { id: record.paymentContextId, companyId: record.companyId, deletedAt: null },
      select: { receivableId: true },
    });
    return order?.receivableId ?? null;
  }

  /** Read + row-lock a receivable inside the transaction (mirrors customer-payments). */
  private async lockReceivable(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<LockedReceivable | undefined> {
    const [locked] = await tx.$queryRaw<LockedReceivable[]>`
      SELECT "id", "companyId", "divisionId", "branchId", "customerId", "customerName",
             "outstandingAmount", "paidAmount", "status", "currency", "sourceType", "sourceId"
      FROM "receivables"
      WHERE "id" = ${id} AND "deletedAt" IS NULL
      FOR UPDATE`;
    return locked;
  }

  /**
   * Resolve a real User id to stamp on the JournalEntry (createdById is a
   * required, restrict-on-delete FK). The interactive caller supplies one; the
   * integration path does not (userId=null), so fall back to the payment's
   * confirmer, then its initiator, then any active user in the posting company.
   * Fails closed when no user exists — a JE must be attributable to a person.
   */
  private async resolvePostingActorId(
    tx: Prisma.TransactionClient,
    record: NonNullable<Awaited<ReturnType<PrismaService['externalPayment']['findFirst']>>>,
    userId: string | null,
  ): Promise<string> {
    const candidates = [userId, record.confirmedById, record.initiatedById].filter(
      (id): id is string => !!id,
    );
    for (const id of candidates) {
      const user = await tx.user.findFirst({
        where: { id, deletedAt: null },
        select: { id: true },
      });
      if (user) return user.id;
    }

    const fallback = await tx.user.findFirst({
      where: { companyId: record.companyId, deletedAt: null, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (fallback) return fallback.id;

    throw new BadRequestException(
      `Cannot post external payment ${record.paymentNumber}: no active user found to attribute ` +
        `the journal entry to on company ${record.companyId}.`,
    );
  }

  // ── cash-account resolution ────────────────────────────────────────────────────

  /**
   * Pick a company cash/bank account to receive this external payment. Because we
   * increment the account's denormalised `currentBalance`, we only ever bind an
   * account whose CURRENCY matches the receipt currency (mixing currencies on one
   * balance cache would corrupt it — mirrors the customer-payments currency
   * guard). Prefers a payment-method type match (BANK for BANK_TRANSFER/CARD,
   * MOBILE_MONEY for MOBILE_MONEY, else CASH_ON_HAND) within that currency, then
   * any active account in that currency. Returns null when none matches — the GL
   * cash leg still posts (by role) but no balance cache is bumped.
   *
   * `scope` is the linked receivable's division/branch (see
   * {@link peekLinkedReceivableScope}). When present, resolution is
   * branch-aware via the shared helper: within each type tier the exact-branch
   * account wins, then an unscoped (NULL-branch) company account — an account
   * scoped to a DIFFERENT branch is never chosen, because its currentBalance
   * feeds that branch's Funga Siku close. A standalone payment (no receivable
   * context) keeps the historical company-wide oldest-first behaviour.
   */
  private async resolveReceivingCashAccount(
    tx: Prisma.TransactionClient,
    companyId: string,
    method: ExternalPaymentMethod | null | undefined,
    currency: string | null | undefined,
    scope?: { divisionId: string | null; branchId: string | null } | null,
  ) {
    return resolveCashAccountForScope(tx, {
      companyId,
      currency: currency ?? 'TZS',
      preferredTypes: [this.methodCashAccountType(method)],
      divisionId: scope?.divisionId ?? null,
      branchId: scope?.branchId ?? null,
    });
  }

  /**
   * Peek the division/branch scope of the receivable this payment is linked to
   * (via RECEIVABLE / SALES_ORDER context) so cash-account resolution can
   * prefer the branch that actually collected the money. Takes the same row
   * lock relieve/restore take later in this transaction, so the scope cannot
   * shift between the peek and the relief. Null when the payment is standalone
   * or the context does not resolve to a same-company receivable — resolution
   * then falls back to the company-wide behaviour.
   */
  private async peekLinkedReceivableScope(
    tx: Prisma.TransactionClient,
    record: NonNullable<Awaited<ReturnType<PrismaService['externalPayment']['findFirst']>>>,
  ): Promise<{ divisionId: string | null; branchId: string | null } | null> {
    const receivableId = await this.resolveReceivableId(tx, record);
    if (!receivableId) return null;
    const locked = await this.lockReceivable(tx, receivableId);
    if (!locked || locked.companyId !== record.companyId) return null;
    return { divisionId: locked.divisionId ?? null, branchId: locked.branchId ?? null };
  }

  /** Preferred CashAccount type for a payment method. */
  private methodCashAccountType(method: ExternalPaymentMethod | null | undefined): CashAccountType {
    switch (method) {
      case ExternalPaymentMethod.BANK_TRANSFER:
      case ExternalPaymentMethod.CARD:
        return CashAccountType.BANK;
      case ExternalPaymentMethod.MOBILE_MONEY:
      case ExternalPaymentMethod.USSD:
      case ExternalPaymentMethod.QR:
        return CashAccountType.MOBILE_MONEY;
      default:
        return CashAccountType.CASH_ON_HAND;
    }
  }

  /** GL cash role from a resolved CashAccount type (BANK vs on-hand). */
  private cashAccountRole(accountType?: CashAccountType | null): AccountRole {
    return accountType === CashAccountType.BANK ? 'BANK' : 'CASH_ON_HAND';
  }

  /** GL cash role from the payment method when no CashAccount row is resolved. */
  private methodCashRole(method: ExternalPaymentMethod | null | undefined): AccountRole {
    return method === ExternalPaymentMethod.BANK_TRANSFER || method === ExternalPaymentMethod.CARD
      ? 'BANK'
      : 'CASH_ON_HAND';
  }

  /**
   * Resolve a customer-advance / unearned-revenue liability account (the typed
   * AccountRole union has none). Returns null when none is configured — caller
   * parks the remainder in AR control. Mirrors customer-payments.
   */
  private async resolveCustomerAdvanceAccountId(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<string | null> {
    const subTypeKeys = [
      'customer_advances',
      'customer_advance',
      'customer_deposits',
      'customer_deposit',
      'advances_from_customers',
      'unearned_revenue',
      'deferred_revenue',
      'prepayments_received',
    ];
    const codes = ['2150', '2160', '2250', '2600', '2610'];

    const account = await tx.chartOfAccount.findFirst({
      where: {
        companyId,
        deletedAt: null,
        isActive: true,
        OR: [
          { accountSubType: { in: subTypeKeys, mode: 'insensitive' } },
          { accountCode: { in: codes } },
        ],
      },
      select: { id: true },
    });
    return account?.id ?? null;
  }

  // ── subledger sync (mirrors customer-payments / receivables) ────────────────────

  /**
   * Recompute a customer's outstanding balance from their still-open
   * receivables (mirrors receivables.service.syncCustomerBalance).
   */
  private async syncCustomerBalance(
    tx: Prisma.TransactionClient,
    companyId: string,
    customerId?: string | null,
  ): Promise<void> {
    if (!customerId) return;
    const summary = await tx.receivable.aggregate({
      where: {
        companyId,
        customerId,
        deletedAt: null,
        status: { in: OPEN_RECEIVABLE_STATUSES as unknown as string[] } as any,
      },
      _sum: { outstandingAmount: true },
    });
    await tx.customer.updateMany({
      where: { id: customerId, companyId, deletedAt: null },
      data: { currentBalance: summary._sum.outstandingAmount ?? 0 },
    });
  }

  /**
   * Keep a source SalesOrder's paid/outstanding/paymentStatus in sync with its
   * backing receivable (mirrors receivables.service.syncSalesOrderPaymentFromReceivable).
   */
  private async syncSalesOrderPaymentFromReceivable(
    tx: Prisma.TransactionClient,
    receivable: {
      id: string;
      sourceType: string | null;
      sourceId: string | null;
      paidAmount: Prisma.Decimal | number | string;
      outstandingAmount: Prisma.Decimal | number | string;
    },
  ): Promise<void> {
    if (receivable.sourceType !== 'SalesOrder' || !receivable.sourceId) return;

    const paidAmount = new Prisma.Decimal(receivable.paidAmount ?? 0).toDecimalPlaces(2);
    const outstandingAmount = new Prisma.Decimal(receivable.outstandingAmount ?? 0).toDecimalPlaces(
      2,
    );
    const paymentStatus = outstandingAmount.isZero()
      ? 'PAID'
      : paidAmount.gt(0)
        ? 'PARTIALLY_PAID'
        : 'UNPAID';

    await tx.salesOrder.updateMany({
      where: { id: receivable.sourceId, deletedAt: null },
      data: {
        receivableId: receivable.id,
        paidAmount,
        outstandingAmount,
        paymentStatus: paymentStatus as any,
      },
    });
  }
}
