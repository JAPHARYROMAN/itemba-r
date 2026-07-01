import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, CashAccountType, CurrencyCode, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import {
  AccountResolverService,
  AccountRole,
} from '../../common/services/account-resolver.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { pagination } from '../../common/utils/pagination';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import { CreateRefundDto } from './dto/create-refund.dto';
import { QueryRefundDto } from './dto/query-refund.dto';
import { PayRefundDto } from './dto/pay-refund.dto';
import { VoidRefundDto } from './dto/void-refund.dto';
import { RefundStatus } from './dto/refund-status.enum';
import { creditNoteDb } from '../credit-notes/credit-note.types';
import { CreditNoteStatus } from '../credit-notes/credit-note-status.enum';

/**
 * The `Refund` and `CreditNote` models are owned by the schema package and are
 * added to `schema.prisma` in the same wave. To keep this module typechecking
 * and unit-testable independently of Prisma-client regeneration ordering, the
 * delegates are accessed through these narrow, hand-written row/delegate views
 * rather than the generated `PrismaClient['refund']` types. The field names
 * below match the conventions used by peer financial models (Receivable, etc.)
 * and the relation fields already declared on Company / Customer / CashAccount /
 * JournalEntry in schema.prisma. Once the generated types land these views are
 * structurally compatible and can be deleted in favour of the real ones.
 */
export interface RefundRow {
  id: string;
  refundNumber: string;
  companyId: string;
  divisionId: string | null;
  branchId: string | null;
  customerId: string | null;
  customerName: string | null;
  creditNoteId: string | null;
  receivableId: string | null;
  cashAccountId: string;
  amount: Prisma.Decimal;
  currency: CurrencyCode;
  refundDate: Date;
  status: string;
  reason: string | null;
  notes: string | null;
  journalEntryId: string | null;
  reversalJournalEntryId: string | null;
  createdById: string | null;
  postedById: string | null;
  postedAt: Date | null;
  voidedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type Db = PrismaService | Prisma.TransactionClient;

interface RefundDelegate {
  findFirst(args: unknown): Promise<RefundRow | null>;
  findMany(args: unknown): Promise<RefundRow[]>;
  count(args: unknown): Promise<number>;
  create(args: unknown): Promise<RefundRow>;
  update(args: unknown): Promise<RefundRow>;
  updateMany(args: unknown): Promise<{ count: number }>;
  aggregate(args: unknown): Promise<{ _sum: { amount: Prisma.Decimal | null } }>;
}

@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly accountResolver: AccountResolverService,
    private readonly postingEngine: PostingEngineService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  // ── delegate accessors (see RefundRow note above) ─────────────────────────
  private refunds(db: Db): RefundDelegate {
    return (db as unknown as { refund: RefundDelegate }).refund;
  }

  private creditNotes(db: Db) {
    // Reuse the credit-notes package's authoritative delegate view + row shape
    // (includes appliedAmount) rather than re-declaring field assumptions here.
    return creditNoteDb(db).creditNote;
  }

  // ── queries ───────────────────────────────────────────────────────────────

  async findAll(query: QueryRefundDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      customerId,
      creditNoteId,
      receivableId,
      status,
      dateFrom,
      dateTo,
    } = query;
    const paging = pagination({ page, limit });

    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Record<string, unknown> = { deletedAt: null };
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else if (accessibleIds !== null) {
      where.companyId = { in: accessibleIds };
    }
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (customerId) where.customerId = customerId;
    if (creditNoteId) where.creditNoteId = creditNoteId;
    if (receivableId) where.receivableId = receivableId;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      const range: Record<string, Date> = {};
      if (dateFrom) range.gte = dateRangeStart(dateFrom);
      if (dateTo) range.lte = dateRangeEnd(dateTo);
      where.refundDate = range;
    }

    const [data, total] = await Promise.all([
      this.refunds(this.prisma).findMany({
        where,
        orderBy: { refundDate: 'desc' },
        skip: paging.skip,
        take: paging.limit,
      }),
      this.refunds(this.prisma).count({ where }),
    ]);

    return {
      data,
      total,
      page: paging.page,
      limit: paging.limit,
      totalPages: Math.ceil(total / paging.limit),
    };
  }

  async findOne(id: string, user?: AuthUser): Promise<RefundRow> {
    const record = await this.refunds(this.prisma).findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('Refund not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId);
    }
    return record;
  }

  // ── create (DRAFT) ──────────────────────────────────────────────────────────

  async create(dto: CreateRefundDto, user: AuthUser): Promise<RefundRow> {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const userId = user.id;

    // FAIL-CLOSED (GL guard): the credit-note-backed path is the only accounting-
    // sound refund flow today. A receivable-only refund (no credit note) has no
    // company scoping, no refundable-credit verification, no subledger relief and
    // no double-refund guard, and would post a wrong-direction Dr AR / Cr Cash on a
    // normal debit-balance receivable. Until an overpayment/credit model exists we
    // REQUIRE an ISSUED credit note. `receivableId` remains an optional extra link.
    if (!dto.creditNoteId) {
      throw new BadRequestException(
        'A refund must reference an ISSUED credit note; standalone receivable/overpayment refunds are not yet supported.',
      );
    }
    // Narrow once so the guard type holds inside the transaction closure.
    const creditNoteId = dto.creditNoteId;

    const amount = new Prisma.Decimal(dto.amount).toDecimalPlaces(2);
    if (amount.lte(0)) throw new BadRequestException('Refund amount must be greater than zero');

    // If a customer is supplied, it must belong to the same company (mirror
    // credit-notes.service.create's customer-company check).
    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, deletedAt: null },
        select: { companyId: true },
      });
      if (!customer || customer.companyId !== dto.companyId) {
        throw new BadRequestException('Customer does not belong to this company');
      }
    }

    // Validate the cash/bank account belongs to the company (also gives us the
    // account type used to resolve the GL account at pay() time).
    const cashAccount = await this.resolveCashAccount(this.prisma, dto.companyId, dto.cashAccountId);

    const record = await this.prisma.$transaction(async (tx) => {
      // Credit-note-backed refund: validate + guard double-refund atomically.
      await this.assertCreditNoteRefundable(tx, {
        companyId: dto.companyId,
        creditNoteId,
        customerId: dto.customerId ?? null,
        additionalAmount: amount,
      });

      const created = await this.refunds(tx).create({
        data: {
          refundNumber: await this.codes.next({
            entityType: 'Refund',
            companyId: dto.companyId,
            tx,
          }),
          companyId: dto.companyId,
          divisionId: dto.divisionId ?? cashAccount.divisionId ?? null,
          branchId: dto.branchId ?? cashAccount.branchId ?? null,
          customerId: dto.customerId ?? null,
          creditNoteId: dto.creditNoteId ?? null,
          receivableId: dto.receivableId ?? null,
          cashAccountId: dto.cashAccountId,
          amount,
          currency: dto.currency ?? CurrencyCode.TZS,
          refundDate: new Date(dto.refundDate),
          status: RefundStatus.DRAFT,
          reason: dto.reason ?? null,
          notes: dto.notes ?? null,
          createdById: userId,
        },
      });
      return created;
    });

    await this.auditLogs.log({
      action: 'REFUND_CREATE',
      entityType: 'Refund',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as unknown as Record<string, unknown>,
    });

    return record;
  }

  // ── pay / post (DRAFT -> PAID) ────────────────────────────────────────────

  async pay(id: string, dto: PayRefundDto, user: AuthUser): Promise<RefundRow> {
    const userId = user.id;

    const { before, record, journal } = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: flip DRAFT -> PAID guarded on the current status so two
      // concurrent pays race here and exactly one wins. The loser sees count 0.
      const claim = await this.refunds(tx).updateMany({
        where: { id, status: RefundStatus.DRAFT, deletedAt: null },
        data: { status: RefundStatus.PAID },
      });

      // Reload for the definitive state and to distinguish the failure reason.
      const current = await this.refunds(tx).findFirst({ where: { id, deletedAt: null } });
      if (!current) throw new NotFoundException('Refund not found');
      await this.companyScope.assertCanAccessCompany(user, current.companyId, AccessLevel.WRITE);

      if (claim.count !== 1) {
        // We lost the claim (or it was never DRAFT). Report the real status.
        throw new ConflictException(
          `Refund cannot be paid from status ${current.status}; only DRAFT refunds can be paid`,
        );
      }

      const amount = new Prisma.Decimal(current.amount).toDecimalPlaces(2);
      if (amount.lte(0)) throw new BadRequestException('Refund amount must be greater than zero');

      // Re-validate credit-note eligibility inside the tx (double-refund guard is
      // enforced at create; here we confirm the note is still ISSUED at pay time).
      if (current.creditNoteId) {
        await this.assertCreditNoteStillIssued(tx, current.companyId, current.creditNoteId);
      }

      const cashAccount = await this.resolveCashAccount(
        tx,
        current.companyId,
        current.cashAccountId,
      );
      const cashRole = this.cashAccountRole(cashAccount.accountType);
      // Clearing side: credit the customer sits in AR (the credit note credited
      // AR when issued); paying the refund in cash debits AR to release it.
      const [cashAcct, arAcct] = await Promise.all([
        this.accountResolver.resolve(current.companyId, cashRole, tx),
        this.accountResolver.resolve(current.companyId, 'AR_CONTROL', tx),
      ]);

      const postingDate = dto.paymentDate ? new Date(dto.paymentDate) : current.refundDate;
      const journalEntry = await this.postingEngine.postLines(
        {
          companyId: current.companyId,
          divisionId: current.divisionId,
          branchId: current.branchId,
          transactionDate: postingDate,
          description: `Customer refund ${current.refundNumber}`,
          referenceType: 'Refund',
          referenceId: current.id,
          moduleName: 'refunds',
          userId,
          // DR AR (release customer credit) / CR Cash|Bank (money out).
          lines: [
            {
              accountId: arAcct.id,
              description: `Release customer credit: ${current.customerName ?? current.customerId ?? 'customer'}`,
              debit: amount,
              credit: 0,
            },
            {
              accountId: cashAcct.id,
              description: `Refund paid from ${cashAccount.accountName}`,
              debit: 0,
              credit: amount,
            },
          ],
        },
        tx,
      );

      const updated = await this.refunds(tx).update({
        where: { id: current.id },
        data: {
          status: RefundStatus.PAID,
          journalEntryId: journalEntry.id,
          postedById: userId,
          postedAt: new Date(),
          ...(dto.notes ? { notes: dto.notes } : {}),
        },
      });

      return { before: current, record: updated, journal: journalEntry };
    });

    await this.auditLogs.log({
      action: 'REFUND_PAY',
      entityType: 'Refund',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: before.status } as Record<string, unknown>,
      newValue: {
        status: RefundStatus.PAID,
        journalEntryId: journal.id,
        journalNumber: journal.journalNumber,
      } as Record<string, unknown>,
    });

    return record;
  }

  // ── void (PAID -> VOID) ───────────────────────────────────────────────────

  async void(id: string, dto: VoidRefundDto, user: AuthUser): Promise<RefundRow> {
    const userId = user.id;

    const { before, record, reversal } = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: flip PAID -> VOID guarded on the current status.
      const claim = await this.refunds(tx).updateMany({
        where: { id, status: RefundStatus.PAID, deletedAt: null },
        data: { status: RefundStatus.VOID },
      });

      const current = await this.refunds(tx).findFirst({ where: { id, deletedAt: null } });
      if (!current) throw new NotFoundException('Refund not found');
      await this.companyScope.assertCanAccessCompany(user, current.companyId, AccessLevel.MANAGE);

      if (claim.count !== 1) {
        throw new ConflictException(
          `Refund cannot be voided from status ${current.status}; only PAID refunds can be voided`,
        );
      }

      const reversalJe = await this.reverseRefundJournal(tx, current, userId);

      const updated = await this.refunds(tx).update({
        where: { id: current.id },
        data: {
          status: RefundStatus.VOID,
          reversalJournalEntryId: reversalJe?.id ?? null,
          voidedAt: new Date(),
          reason: dto.reason,
        },
      });

      return { before: current, record: updated, reversal: reversalJe };
    });

    await this.auditLogs.log({
      action: 'REFUND_VOID',
      entityType: 'Refund',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: before.status } as Record<string, unknown>,
      newValue: {
        status: RefundStatus.VOID,
        reason: dto.reason,
        reversalJournalEntryId: reversal?.id ?? null,
      } as Record<string, unknown>,
    });

    return record;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /** Cash/bank account belongs to the company and is active. */
  private async resolveCashAccount(db: Db, companyId: string, cashAccountId: string) {
    const cashAccount = await (db as PrismaService).cashAccount.findFirst({
      where: { id: cashAccountId, deletedAt: null, isActive: true },
      select: {
        id: true,
        companyId: true,
        divisionId: true,
        branchId: true,
        accountType: true,
        accountName: true,
      },
    });
    if (!cashAccount || cashAccount.companyId !== companyId) {
      throw new BadRequestException('Cash account does not belong to this company');
    }
    return cashAccount;
  }

  private cashAccountRole(accountType?: CashAccountType | null): AccountRole {
    return accountType === CashAccountType.BANK ? 'BANK' : 'CASH_ON_HAND';
  }

  /**
   * Validate the credit note belongs to the company and is ISSUED, and that the
   * new refund keeps total-refunded <= credit-note total. Run inside the create
   * transaction so the guard sees a consistent snapshot of prior refunds.
   */
  private async assertCreditNoteRefundable(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      creditNoteId: string;
      customerId?: string | null;
      additionalAmount: Prisma.Decimal;
    },
  ) {
    // Serialize concurrent refunds against the SAME credit note: a
    // transaction-scoped advisory lock makes the "sum prior refunds -> check
    // ceiling -> insert" sequence atomic without depending on the credit-note
    // table name (schema-package owned). Two concurrent creates for one note now
    // queue, so the second sees the first's DRAFT row and cannot over-refund. The
    // lock auto-releases at commit/rollback. Keyed in a dedicated classid space
    // ('refunds:credit-note') to avoid colliding with other advisory locks.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('refunds:credit-note'), hashtext(${input.creditNoteId}))`;

    const note = await this.creditNotes(tx).findFirst({
      where: { id: input.creditNoteId, deletedAt: null },
    });
    if (!note || note.companyId !== input.companyId) {
      throw new BadRequestException('Credit note does not belong to this company');
    }
    if (note.status !== CreditNoteStatus.ISSUED) {
      throw new BadRequestException(
        `Credit note must be ISSUED to be refunded (current status: ${note.status})`,
      );
    }
    // If the caller named a customer, it must match the credit note's customer so
    // a refund cannot be booked against another party's credit.
    if (input.customerId && note.customerId && note.customerId !== input.customerId) {
      throw new BadRequestException(
        'Credit note does not belong to the specified customer',
      );
    }

    // Sum existing non-void refunds against this note (DRAFT + PAID both hold
    // a claim on the credit's value).
    const agg = await this.refunds(tx).aggregate({
      where: {
        creditNoteId: input.creditNoteId,
        deletedAt: null,
        status: { in: [RefundStatus.DRAFT, RefundStatus.PAID] },
      },
      _sum: { amount: true },
    });
    const alreadyRefunded = new Prisma.Decimal(agg._sum.amount ?? 0).toDecimalPlaces(2);
    // Only the un-applied remainder of the note is refundable in cash: the
    // applied portion already reduced the customer's receivable at issue time.
    const noteTotal = new Prisma.Decimal(note.totalAmount).toDecimalPlaces(2);
    const applied = new Prisma.Decimal(note.appliedAmount ?? 0).toDecimalPlaces(2);
    const refundable = noteTotal.minus(applied).toDecimalPlaces(2);
    const projected = alreadyRefunded.plus(input.additionalAmount).toDecimalPlaces(2);

    if (projected.gt(refundable)) {
      throw new BadRequestException(
        `Refund would exceed available credit note value. Refundable (total ${noteTotal.toString()} ` +
          `less applied ${applied.toString()}): ${refundable.toString()}, already refunded: ` +
          `${alreadyRefunded.toString()}, this refund: ${input.additionalAmount.toString()}`,
      );
    }
  }

  private async assertCreditNoteStillIssued(
    tx: Prisma.TransactionClient,
    companyId: string,
    creditNoteId: string,
  ) {
    const note = await this.creditNotes(tx).findFirst({
      where: { id: creditNoteId, deletedAt: null },
    });
    if (!note || note.companyId !== companyId) {
      throw new BadRequestException('Credit note does not belong to this company');
    }
    if (note.status !== CreditNoteStatus.ISSUED) {
      throw new BadRequestException(
        `Credit note is no longer ISSUED (current status: ${note.status}); cannot pay refund`,
      );
    }
  }

  /**
   * Post a balanced reversing journal entry that exactly unwinds the refund's
   * posting: it swaps debit/credit on every original line, so the AR release and
   * cash outflow are both offset. Claims the original JE as REVERSED first so a
   * concurrent void posts the reversal at most once. Returns null (no-op) when
   * the refund has no traceable posted journal (e.g. never paid).
   */
  private async reverseRefundJournal(
    tx: Prisma.TransactionClient,
    refund: RefundRow,
    userId: string,
  ): Promise<{ id: string; journalNumber: string } | null> {
    const original = refund.journalEntryId
      ? await tx.journalEntry.findFirst({
          where: { id: refund.journalEntryId, companyId: refund.companyId, deletedAt: null },
          include: { lines: true },
        })
      : await tx.journalEntry.findFirst({
          where: {
            companyId: refund.companyId,
            referenceType: 'Refund',
            referenceId: refund.id,
            deletedAt: null,
          },
          include: { lines: true },
          orderBy: { createdAt: 'desc' },
        });

    if (!original || original.lines.length === 0) return null;

    const claim = await tx.journalEntry.updateMany({
      where: { id: original.id, status: { not: 'REVERSED' }, deletedAt: null },
      data: { status: 'REVERSED', reversedAt: new Date(), reversedById: userId },
    });
    if (claim.count !== 1) return null;

    const reversedLines = original.lines.map((line) => ({
      accountId: line.accountId,
      debit: new Prisma.Decimal(line.credit ?? 0).toDecimalPlaces(2),
      credit: new Prisma.Decimal(line.debit ?? 0).toDecimalPlaces(2),
      description: `Reversal: ${line.description ?? ''}`.trim(),
      divisionId: line.divisionId ?? undefined,
      branchId: line.branchId ?? undefined,
    }));

    return this.postingEngine.postLines(
      {
        companyId: original.companyId,
        divisionId: original.divisionId,
        branchId: original.branchId,
        transactionDate: new Date(),
        description: `Reversal of refund ${refund.refundNumber}`,
        referenceType: 'Refund',
        referenceId: refund.id,
        moduleName: 'refunds',
        userId,
        lines: reversedLines,
      },
      tx,
    );
  }
}
