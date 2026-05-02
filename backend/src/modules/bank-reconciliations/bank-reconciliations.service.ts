import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

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
  ) {}

  async findAll(query: any) {
    const { companyId, bankAccountId, status, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (bankAccountId) where.bankAccountId = bankAccountId;
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      this.prisma.bankReconciliation.findMany({
        where, skip, take: Number(limit), orderBy: { createdAt: 'desc' },
      }),
      this.prisma.bankReconciliation.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const item = await this.prisma.bankReconciliation.findFirst({
      where: { id, deletedAt: null },
      include: { statementLines: true, matches: true },
    });
    if (!item) throw new NotFoundException('Bank reconciliation not found');
    return item;
  }

  async create(dto: any, user: any) {
    const item = await this.prisma.bankReconciliation.create({
      data: { ...dto, status: 'DRAFT', preparedById: user.id },
    });
    await this.auditLogs.log({
      action: 'CREATE', entityType: 'BankReconciliation', entityId: item.id,
      userId: user.id, companyId: item.companyId,
    });
    return item;
  }

  async update(id: string, dto: any, user: any) {
    const existing = await this.findOne(id);
    const updated = await this.prisma.bankReconciliation.update({ where: { id }, data: dto });
    await this.auditLogs.log({
      action: 'UPDATE', entityType: 'BankReconciliation', entityId: id,
      userId: user.id, oldValue: existing as any, newValue: updated as any,
    });
    return updated;
  }

  async getLines(reconciliationId: string) {
    return this.prisma.bankStatementLine.findMany({
      where: { bankReconciliationId: reconciliationId },
      orderBy: { transactionDate: 'asc' },
    });
  }

  async addLine(reconciliationId: string, dto: any, user: any) {
    await this.findOne(reconciliationId);
    const line = await this.prisma.bankStatementLine.create({
      data: { ...dto, bankReconciliationId: reconciliationId },
    });
    await this.auditLogs.log({
      action: 'CREATE', entityType: 'BankStatementLine', entityId: line.id, userId: user.id,
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
    user: any,
    options: { dateWindowDays?: number; amountToleranceCents?: number } = {},
  ) {
    const reconciliation = await this.findOne(reconciliationId);
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
      | { lineId: string; matched: false; reason: 'NO_CANDIDATES' | 'AMBIGUOUS'; suggestions: Array<{ entityType: string; entityId: string; amount: number; date: Date; description: string }> }
    > = [];

    for (const line of unmatched) {
      const lineAmount = Number(line.creditAmount) > 0 ? Number(line.creditAmount) : -Number(line.debitAmount);
      const absAmount = Math.abs(lineAmount);
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
        const candidateAmount = Number(c.debit) > 0 ? Number(c.debit) : -Number(c.credit);
        return Math.abs(Math.abs(candidateAmount) - absAmount) <= tolerance;
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
        const matchAmount = Number(m.debit) > 0 ? Number(m.debit) : Number(m.credit);
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
            amount: Number(m.debit) > 0 ? Number(m.debit) : Number(m.credit),
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
    user: any,
  ) {
    const reconciliation = await this.findOne(reconciliationId);
    const line = reconciliation.statementLines.find((l) => l.id === statementLineId);
    if (!line) throw new NotFoundException('Statement line not on this reconciliation');

    const jeLine = await this.prisma.journalEntryLine.findUniqueOrThrow({
      where: { id: journalEntryLineId },
    });

    const matchAmount = Number(jeLine.debit) > 0 ? Number(jeLine.debit) : Number(jeLine.credit);
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

  async unmatch(reconciliationId: string, statementLineId: string, user: any) {
    await this.findOne(reconciliationId);
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

  async approve(id: string, user: any) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Only DRAFT reconciliations can be approved');
    if (Math.abs(Number(existing.differenceAmount)) > 0.01) {
      throw new BadRequestException(
        `Reconciliation cannot be approved while it has an unexplained difference of ${existing.differenceAmount}`,
      );
    }
    if (existing.preparedById === user.id) {
      throw new BadRequestException('Maker-checker: the preparer cannot approve their own reconciliation');
    }
    const updated = await this.prisma.bankReconciliation.update({
      where: { id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: user.id },
    });
    await this.auditLogs.log({ action: 'APPROVE', entityType: 'BankReconciliation', entityId: id, userId: user.id });
    return updated;
  }

  async close(id: string, user: any) {
    const existing = await this.findOne(id);
    if (existing.status !== 'APPROVED') throw new BadRequestException('Only APPROVED reconciliations can be closed');
    const updated = await this.prisma.bankReconciliation.update({
      where: { id }, data: { status: 'CLOSED', closedAt: new Date(), closedById: user.id },
    });
    await this.auditLogs.log({ action: 'CLOSE', entityType: 'BankReconciliation', entityId: id, userId: user.id });
    return updated;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async recomputeBalances(reconciliationId: string) {
    const reconciliation = await this.prisma.bankReconciliation.findUniqueOrThrow({
      where: { id: reconciliationId },
      include: { statementLines: true, matches: true },
    });
    const matchedTotal = reconciliation.matches.reduce((s, m) => s + Number(m.amount), 0);
    const reconciled = Number(reconciliation.bookOpeningBalance) + matchedTotal;
    const difference = Number(reconciliation.statementClosingBalance) - reconciled;
    await this.prisma.bankReconciliation.update({
      where: { id: reconciliationId },
      data: {
        reconciledBalance: new Prisma.Decimal(reconciled),
        differenceAmount: new Prisma.Decimal(difference),
      },
    });
  }

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }
}
