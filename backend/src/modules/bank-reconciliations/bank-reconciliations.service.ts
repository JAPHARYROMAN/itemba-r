import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere, assertCanAccessCompanyFromUser } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { pagination } from '../../common/utils/pagination';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';

/**
 * JournalEntry.referenceType values that should win disambiguation when
 * multiple candidates tie on amount + date. These are operationally tracked
 * postings (a real-world cash movement), so a bank-statement line of the same
 * shape is almost always one of them and not, e.g., a manual JE adjustment.
 */
const PRIORITY_REFERENCE_TYPES = new Set<string>([
  'PayrollRunPayment',
  'PayrollRun',
  'SalaryAdvance',
]);

/**
 * Bank reconciliation with statement-line ↔ ledger-entry matching.
 *
 * Matching policy (configurable later):
 *   - For each unmatched statement line, find candidate journal-entry lines
 *     posted to the reconciliation's cashAccount within `dateWindowDays` of
 *     the statement date.
 *   - A candidate matches if the absolute amount equals the statement line's
 *     amount within `amountToleranceCents` cents.
 *   - When exactly one candidate matches, the reconciliation auto-creates a
 *     `BankReconciliationMatch` of type `AUTO_EXACT`.
 *   - When multiple candidates match, all are returned as suggestions and the
 *     statement line stays unmatched until a human picks one.
 *
 * Manual matches and unmatch are still available via {@link manualMatch} /
 * {@link unmatch}. Reconciled balance and difference are recomputed after
 * every change and stored on the reconciliation.
 */
@Injectable()
export class BankReconciliationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly accountResolver: AccountResolverService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  async findAll(query: any, user?: AuthUser) {
    const { companyId, bankAccountId, status, page = 1, limit = 20 } = query;
    const paging = pagination({ page, limit });
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (bankAccountId) where.bankAccountId = bankAccountId;
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      this.prisma.bankReconciliation.findMany({
        where,
        skip: paging.skip,
        take: paging.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.bankReconciliation.count({ where }),
    ]);
    return { items, total, page: paging.page, limit: paging.limit };
  }

  async findOne(id: string, user: AuthUser) {
    const item = await this.prisma.bankReconciliation.findFirst({
      where: { id, deletedAt: null },
      include: { statementLines: true, matches: true },
    });
    if (!item) throw new NotFoundException('Bank reconciliation not found');
    assertCanAccessCompanyFromUser(user, item.companyId);
    return item;
  }

  async create(dto: any, user: AuthUser) {
    assertCanAccessCompanyFromUser(user, dto.companyId);
    const item = await this.prisma.bankReconciliation.create({
      data: { ...dto, status: 'DRAFT', preparedById: user.id },
    });
    await this.auditLogs.log({
      action: 'CREATE',
      entityType: 'BankReconciliation',
      entityId: item.id,
      userId: user.id,
      companyId: item.companyId,
    });
    return item;
  }

  async update(id: string, dto: any, user: AuthUser) {
    const existing = await this.findOne(id, user);
    if (dto.companyId && dto.companyId !== existing.companyId) {
      assertCanAccessCompanyFromUser(user, dto.companyId);
    }
    const updated = await this.prisma.bankReconciliation.update({ where: { id }, data: dto });
    await this.auditLogs.log({
      action: 'UPDATE',
      entityType: 'BankReconciliation',
      entityId: id,
      userId: user.id,
      oldValue: existing as any,
      newValue: updated as any,
    });
    return updated;
  }

  async getLines(reconciliationId: string, user: AuthUser) {
    await this.findOne(reconciliationId, user);
    return this.prisma.bankStatementLine.findMany({
      where: { bankReconciliationId: reconciliationId },
      orderBy: { transactionDate: 'asc' },
    });
  }

  async addLine(reconciliationId: string, dto: any, user: AuthUser) {
    await this.findOne(reconciliationId, user);
    const line = await this.prisma.bankStatementLine.create({
      data: { ...dto, bankReconciliationId: reconciliationId },
    });
    await this.auditLogs.log({
      action: 'CREATE',
      entityType: 'BankStatementLine',
      entityId: line.id,
      userId: user.id,
    });
    return line;
  }

  // ─── Matching ────────────────────────────────────────────────────────────

  /**
   * Run the matching engine over all unmatched statement lines.
   *
   * Returns a per-line breakdown of {matched: true, ...} for confident matches
   * and {suggestions: [...]} when ambiguous. Persists exact matches as
   * BankReconciliationMatch rows and flips `BankStatementLine.matched`.
   */
  async runMatching(
    reconciliationId: string,
    user: AuthUser,
    options: { dateWindowDays?: number; amountToleranceCents?: number } = {},
  ) {
    const reconciliation = await this.findOne(reconciliationId, user);
    if (reconciliation.status !== 'DRAFT') {
      throw new BadRequestException('Matching can only run on DRAFT reconciliations');
    }

    const dateWindowDays = options.dateWindowDays ?? 3;
    const tolerance = (options.amountToleranceCents ?? 1) / 100;

    const unmatched = reconciliation.statementLines.filter((l) => !l.matched);
    const cashAccountId = reconciliation.cashAccountId;

    let autoMatched = 0;
    let ambiguous = 0;
    const perLine: Array<
      | { lineId: string; matched: true; matchId: string; entityType: string; entityId: string }
      | {
          lineId: string;
          matched: false;
          reason: 'NO_CANDIDATES' | 'AMBIGUOUS';
          suggestions: Array<{
            entityType: string;
            entityId: string;
            amount: number;
            date: Date;
            description: string;
          }>;
        }
    > = [];

    for (const line of unmatched) {
      const lineAmount = new Prisma.Decimal(line.creditAmount).gt(0)
        ? new Prisma.Decimal(line.creditAmount)
        : new Prisma.Decimal(line.debitAmount).negated();
      const absAmount = lineAmount.abs();
      const start = this.addDays(line.transactionDate, -dateWindowDays);
      const end = this.addDays(line.transactionDate, dateWindowDays);

      // Candidate journal-entry lines on the same cash account in window.
      const candidates = await this.prisma.journalEntryLine.findMany({
        where: {
          accountId: cashAccountId,
          companyId: reconciliation.companyId,
          journalEntry: {
            status: 'POSTED',
            transactionDate: { gte: start, lte: end },
            deletedAt: null,
          },
        },
        include: {
          journalEntry: {
            select: {
              id: true,
              transactionDate: true,
              description: true,
              referenceType: true,
              referenceId: true,
            },
          },
        },
      });

      // For inbound bank credits we expect a debit on the cash account
      // (cash increased on the books). For bank debits, we expect a credit.
      const matches = candidates.filter((c) => {
        const candidateAmount = new Prisma.Decimal(c.debit).gt(0)
          ? new Prisma.Decimal(c.debit)
          : new Prisma.Decimal(c.credit).negated();
        return candidateAmount.abs().minus(absAmount).abs().lte(tolerance);
      });

      // Disambiguation: when multiple candidates tie on amount and date, prefer
      // ones whose JE has a known operational referenceType (payroll payment,
      // salary advance, etc.). If exactly one priority candidate exists, it
      // wins as AUTO_EXACT; otherwise the line stays ambiguous.
      const isPriority = (c: (typeof matches)[number]) =>
        PRIORITY_REFERENCE_TYPES.has(c.journalEntry.referenceType ?? '');
      const priorityMatches = matches.filter(isPriority);
      const winningMatch =
        matches.length === 1
          ? matches[0]
          : priorityMatches.length === 1
            ? priorityMatches[0]
            : null;

      if (winningMatch) {
        const m = winningMatch;
        const matchAmount = new Prisma.Decimal(m.debit).gt(0)
          ? new Prisma.Decimal(m.debit)
          : new Prisma.Decimal(m.credit);
        const created = await this.prisma.bankReconciliationMatch.create({
          data: {
            bankReconciliationId: reconciliationId,
            bankStatementLineId: line.id,
            matchedEntityType: 'JournalEntryLine',
            matchedEntityId: m.id,
            matchType: 'AUTO_EXACT',
            amount: matchAmount,
            matchedById: user.id,
          },
        });
        await this.prisma.bankStatementLine.update({
          where: { id: line.id },
          data: {
            matched: true,
            matchedTransactionType: 'JournalEntryLine',
            matchedTransactionId: m.id,
          },
        });
        autoMatched++;
        perLine.push({
          lineId: line.id,
          matched: true,
          matchId: created.id,
          entityType: 'JournalEntryLine',
          entityId: m.id,
        });
      } else if (matches.length > 1) {
        ambiguous++;
        perLine.push({
          lineId: line.id,
          matched: false,
          reason: 'AMBIGUOUS',
          suggestions: matches.map((m) => ({
            entityType: 'JournalEntryLine',
            entityId: m.id,
            amount: (new Prisma.Decimal(m.debit).gt(0)
              ? new Prisma.Decimal(m.debit)
              : new Prisma.Decimal(m.credit)
            ).toNumber(),
            date: m.journalEntry.transactionDate,
            description: m.description ?? m.journalEntry.description,
          })),
        });
      } else {
        perLine.push({
          lineId: line.id,
          matched: false,
          reason: 'NO_CANDIDATES',
          suggestions: [],
        });
      }
    }

    await this.recomputeBalances(reconciliationId);

    await this.auditLogs.log({
      action: 'MATCH',
      entityType: 'BankReconciliation',
      entityId: reconciliationId,
      userId: user.id,
      companyId: reconciliation.companyId,
      metadata: { autoMatched, ambiguous, dateWindowDays, tolerance },
    });

    return {
      summary: {
        totalLines: reconciliation.statementLines.length,
        autoMatched,
        ambiguous,
        stillUnmatched: unmatched.length - autoMatched,
      },
      perLine,
    };
  }

  /** Manually match a statement line to a journal entry line. */
  async manualMatch(
    reconciliationId: string,
    statementLineId: string,
    journalEntryLineId: string,
    user: AuthUser,
  ) {
    const reconciliation = await this.findOne(reconciliationId, user);
    const line = reconciliation.statementLines.find((l) => l.id === statementLineId);
    if (!line) throw new NotFoundException('Statement line not on this reconciliation');

    const jeLine = await this.prisma.journalEntryLine.findUniqueOrThrow({
      where: { id: journalEntryLineId },
    });
    if (jeLine.companyId !== reconciliation.companyId) {
      throw new BadRequestException('Journal entry line belongs to another company');
    }

    const matchAmount = new Prisma.Decimal(jeLine.debit).gt(0)
      ? new Prisma.Decimal(jeLine.debit)
      : new Prisma.Decimal(jeLine.credit);
    const created = await this.prisma.bankReconciliationMatch.create({
      data: {
        bankReconciliationId: reconciliationId,
        bankStatementLineId: statementLineId,
        matchedEntityType: 'JournalEntryLine',
        matchedEntityId: journalEntryLineId,
        matchType: 'MANUAL',
        amount: matchAmount,
        matchedById: user.id,
      },
    });
    await this.prisma.bankStatementLine.update({
      where: { id: statementLineId },
      data: {
        matched: true,
        matchedTransactionType: 'JournalEntryLine',
        matchedTransactionId: journalEntryLineId,
      },
    });
    await this.recomputeBalances(reconciliationId);
    return created;
  }

  async unmatch(reconciliationId: string, statementLineId: string, user: AuthUser) {
    await this.findOne(reconciliationId, user);
    await this.prisma.bankReconciliationMatch.deleteMany({
      where: { bankReconciliationId: reconciliationId, bankStatementLineId: statementLineId },
    });
    await this.prisma.bankStatementLine.update({
      where: { id: statementLineId },
      data: { matched: false, matchedTransactionType: null, matchedTransactionId: null },
    });
    await this.recomputeBalances(reconciliationId);
    await this.auditLogs.log({
      action: 'UNMATCH',
      entityType: 'BankStatementLine',
      entityId: statementLineId,
      userId: user.id,
    });
  }

  async postAdjustment(
    reconciliationId: string,
    dto: {
      statementLineId?: string;
      amount: number;
      direction: 'INCREASE_CASH' | 'DECREASE_CASH';
      offsetAccountId?: string;
      description?: string;
      transactionDate?: string;
    },
    user: AuthUser,
  ) {
    const reconciliation = await this.findOne(reconciliationId, user);
    if (reconciliation.status !== 'DRAFT') {
      throw new BadRequestException('Adjustments can only be posted on DRAFT reconciliations');
    }

    const amount = Number(dto.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Adjustment amount must be greater than zero');
    }
    if (!['INCREASE_CASH', 'DECREASE_CASH'].includes(dto.direction)) {
      throw new BadRequestException('Adjustment direction is invalid');
    }

    const cashAccount = await this.prisma.cashAccount.findFirst({
      where: {
        id: reconciliation.cashAccountId,
        companyId: reconciliation.companyId,
        deletedAt: null,
      },
      select: { accountType: true, divisionId: true, branchId: true },
    });
    const cashRole = cashAccount?.accountType === 'BANK' ? 'BANK' : 'CASH_ON_HAND';

    const result = await this.prisma.$transaction(async (tx) => {
      const cashChart = await this.accountResolver.resolve(reconciliation.companyId, cashRole, tx);
      const offsetChart = dto.offsetAccountId
        ? await tx.chartOfAccount.findFirst({
            where: {
              id: dto.offsetAccountId,
              companyId: reconciliation.companyId,
              deletedAt: null,
              isActive: true,
            },
          })
        : await this.accountResolver.resolve(reconciliation.companyId, 'GENERAL_EXPENSE', tx);
      if (!offsetChart) throw new BadRequestException('Offset account not found');

      const description =
        dto.description || `Bank reconciliation adjustment ${reconciliation.reconciliationNumber}`;
      const je = await this.postingEngine.postLines(
        {
          journalNumber: `JE-BR-${reconciliation.reconciliationNumber}-${Date.now().toString(36).toUpperCase()}`,
          companyId: reconciliation.companyId,
          divisionId: cashAccount?.divisionId,
          branchId: cashAccount?.branchId,
          transactionDate: dto.transactionDate ? new Date(dto.transactionDate) : new Date(),
          description,
          referenceType: 'BankReconciliationAdjustment',
          referenceId: reconciliation.id,
          moduleName: 'bank-reconciliations',
          userId: user.id,
          lines:
            dto.direction === 'INCREASE_CASH'
              ? [
                  { accountId: cashChart.id, description, debit: amount, credit: 0 },
                  { accountId: offsetChart.id, description, debit: 0, credit: amount },
                ]
              : [
                  { accountId: offsetChart.id, description, debit: amount, credit: 0 },
                  { accountId: cashChart.id, description, debit: 0, credit: amount },
                ],
        },
        tx,
      );

      let matchId: string | undefined;
      if (dto.statementLineId) {
        const line = reconciliation.statementLines.find((l) => l.id === dto.statementLineId);
        if (!line) throw new NotFoundException('Statement line not on this reconciliation');
        const cashLine = await tx.journalEntryLine.findFirst({
          where: { journalEntryId: je.id, accountId: cashChart.id },
          select: { id: true },
        });
        if (cashLine) {
          const match = await tx.bankReconciliationMatch.create({
            data: {
              bankReconciliationId: reconciliation.id,
              bankStatementLineId: dto.statementLineId,
              matchedEntityType: 'JournalEntryLine',
              matchedEntityId: cashLine.id,
              matchType: 'MANUAL',
              amount,
              matchedById: user.id,
            },
          });
          matchId = match.id;
          await tx.bankStatementLine.update({
            where: { id: dto.statementLineId },
            data: {
              matched: true,
              matchedTransactionType: 'JournalEntryLine',
              matchedTransactionId: cashLine.id,
            },
          });
        }
      }

      return { journalEntryId: je.id, journalNumber: je.journalNumber, matchId };
    });

    await this.recomputeBalances(reconciliationId);
    await this.auditLogs.log({
      action: 'POST_ADJUSTMENT',
      entityType: 'BankReconciliation',
      entityId: reconciliationId,
      userId: user.id,
      companyId: reconciliation.companyId,
      metadata: { amount, direction: dto.direction, journalEntryId: result.journalEntryId },
    });
    return result;
  }

  async approve(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    if (existing.status !== 'DRAFT')
      throw new BadRequestException('Only DRAFT reconciliations can be approved');
    if (new Prisma.Decimal(existing.differenceAmount).abs().gt(0.01)) {
      throw new BadRequestException(
        `Reconciliation cannot be approved while it has an unexplained difference of ${existing.differenceAmount}`,
      );
    }
    if (existing.preparedById === user.id) {
      throw new BadRequestException(
        'Maker-checker: the preparer cannot approve their own reconciliation',
      );
    }
    const updated = await this.prisma.bankReconciliation.update({
      where: { id },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedById: user.id },
    });
    await this.auditLogs.log({
      action: 'APPROVE',
      entityType: 'BankReconciliation',
      entityId: id,
      userId: user.id,
    });
    return updated;
  }

  async close(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    if (existing.status !== 'APPROVED')
      throw new BadRequestException('Only APPROVED reconciliations can be closed');
    const updated = await this.prisma.bankReconciliation.update({
      where: { id },
      data: { status: 'CLOSED', closedAt: new Date(), closedById: user.id },
    });
    await this.auditLogs.log({
      action: 'CLOSE',
      entityType: 'BankReconciliation',
      entityId: id,
      userId: user.id,
    });
    return updated;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async recomputeBalances(reconciliationId: string) {
    const reconciliation = await this.prisma.bankReconciliation.findUniqueOrThrow({
      where: { id: reconciliationId },
      include: { statementLines: true, matches: true },
    });
    const matchedTotal = reconciliation.matches.reduce(
      (sum, match) => sum.plus(match.amount),
      new Prisma.Decimal(0),
    );
    const reconciled = new Prisma.Decimal(reconciliation.bookOpeningBalance).plus(matchedTotal);
    const difference = new Prisma.Decimal(reconciliation.statementClosingBalance).minus(reconciled);
    await this.prisma.bankReconciliation.update({
      where: { id: reconciliationId },
      data: {
        reconciledBalance: reconciled,
        differenceAmount: difference,
      },
    });
  }

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }
}
