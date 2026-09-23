import { mappedCashAccount } from '../../common/services/mapped-cash-account';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  AccessLevel,
  BankReconciliation,
  BankReconciliationMatch,
  BankStatementLine,
  Prisma,
} from '@prisma/client';
import { ImportStatementDto } from './dto/import-statement.dto';
import { normalizeStatementRow, statementEvidence, statementKey } from './statement-integrity';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere, assertCanAccessCompanyFromUser } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { auditRecord } from '../../common/utils/audit-record';
import { pagination } from '../../common/utils/pagination';
import { paginatedResponse } from '../../common/utils/paginated-response';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import {
  AddBankStatementLineDto,
  CreateBankReconciliationDto,
  QueryBankReconciliationDto,
  UpsertBankReconciliationDto,
} from './dto/bank-reconciliation.dto';

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
  private lockHeld = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly accountResolver: AccountResolverService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  /** All changes share the parent row lock, so imports/matching cannot race approval. */
  private async locked<T>(
    id: string,
    user: AuthUser,
    action: (service: BankReconciliationsService) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM bank_reconciliations WHERE id = ${id} FOR UPDATE`;
        const existing = await tx.bankReconciliation.findFirst({ where: { id, deletedAt: null } });
        if (!existing) throw new NotFoundException('Bank reconciliation not found');
        assertCanAccessCompanyFromUser(user, existing.companyId, AccessLevel.WRITE);
        // PostgreSQL returns void from advisory locks; Prisma cannot decode void.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`reconcile:${existing.companyId}`}))::text`;
        // Existing adjustment code can reuse this transaction without opening a nested one.
        const client = new Proxy(tx, {
          get(target, key) {
            if (key === '$transaction')
              return (callback: (db: Prisma.TransactionClient) => Promise<unknown>) => callback(tx);
            return Reflect.get(target, key);
          },
        }) as PrismaService;
        const service = new BankReconciliationsService(
          client,
          this.auditLogs,
          this.accountResolver,
          this.postingEngine,
        );
        service.lockHeld = true;
        return action(service);
      },
      { timeout: 30000 },
    );
  }

  async importStatement(
    id: string,
    dto: ImportStatementDto,
    user: AuthUser,
  ): Promise<{ imported: number; skipped: number }> {
    if (!this.lockHeld)
      return this.locked(id, user, (service) => service.importStatement(id, dto, user));
    const record = await this.findOne(id, user);
    if (record.status !== 'DRAFT')
      throw new BadRequestException('Only draft statements can be imported.');
    const rows = dto.rows.map((row) =>
      normalizeStatementRow(row, record.statementStartDate, record.statementEndDate),
    );
    const keys = new Set(record.statementLines.map(statementKey));
    const fresh = rows.filter((row) => {
      const key = statementKey(row);
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
    await this.prisma.bankStatementLine.createMany({
      data: fresh.map((row) => ({ ...row, bankReconciliationId: id })),
    });
    await this.recomputeBalances(id);
    await this.auditLogs.logStrictInTransaction(this.prisma, {
      action: 'IMPORT',
      entityType: 'BankReconciliation',
      entityId: id,
      companyId: record.companyId,
      userId: user.id,
      metadata: { imported: fresh.length, skipped: rows.length - fresh.length },
    });
    return { imported: fresh.length, skipped: rows.length - fresh.length };
  }

  async evidence(id: string, user: AuthUser) {
    const record = await this.findOne(id, user);
    const evidence = statementEvidence(record);
    const profile = await this.prisma.companyProfile.findUnique({
      where: { companyId: record.companyId },
      select: { currency: true },
    });
    if (!profile || profile.currency !== record.currency)
      evidence.issues.push(
        'Reconciliation currency must match the company accounting currency; foreign-currency reconciliation needs a separate FX workflow.',
      );
    const cash = await this.prisma.cashAccount.findFirst({
      where: {
        id: record.cashAccountId,
        companyId: record.companyId,
        deletedAt: null,
        isActive: true,
      },
    });
    if (!cash || cash.currency !== record.currency)
      evidence.issues.push(
        'The cash account is inactive, inaccessible or has a different currency.',
      );
    if (!cash) return { ...evidence, ready: false };
    let account;
    try {
      account = (
        await mappedCashAccount(
          this.prisma,
          record.companyId,
          record.cashAccountId,
          record.currency,
        )
      ).ledger;
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      evidence.issues.push(error.message);
      return { ...evidence, ready: false };
    }
    const journalLines = await this.prisma.journalEntryLine.findMany({
      where: {
        companyId: record.companyId,
        accountId: account.id,
        OR: [
          { id: { in: record.matches.map((m) => m.matchedEntityId) } },
          {
            journalEntry: {
              transactionDate: { gte: record.statementStartDate, lte: record.statementEndDate },
              status: { in: ['POSTED', 'REVERSED'] },
              deletedAt: null,
            },
          },
        ],
      },
      include: { journalEntry: true },
    });
    const otherMatches = await this.prisma.bankReconciliationMatch.count({
      where: {
        bankReconciliationId: { not: id },
        matchedEntityType: 'JournalEntryLine',
        matchedEntityId: { in: record.matches.map((m) => m.matchedEntityId) },
        bankReconciliation: { deletedAt: null },
      },
    });
    if (otherMatches)
      evidence.issues.push('A journal line is also matched in another reconciliation.');
    const used = new Set<string>();
    for (const line of record.statementLines) {
      const matches = record.matches.filter((m) => m.bankStatementLineId === line.id);
      if (matches.length !== 1) {
        evidence.issues.push('Each statement line must have exactly one journal match.');
        continue;
      }
      const match = matches[0],
        journal = journalLines.find((j) => j.id === match.matchedEntityId);
      if (used.has(match.matchedEntityId))
        evidence.issues.push('A journal line has been used more than once.');
      used.add(match.matchedEntityId);
      const signed = line.creditAmount.minus(line.debitAmount);
      if (
        match.matchedEntityType !== 'JournalEntryLine' ||
        !journal ||
        !['POSTED', 'REVERSED'].includes(journal.journalEntry.status) ||
        journal.journalEntry.deletedAt ||
        journal.journalEntry.companyId !== record.companyId ||
        !journal.debit.minus(journal.credit).eq(signed) ||
        !match.amount.eq(signed.abs())
      )
        evidence.issues.push(
          'A match has the wrong account, direction, amount, company or journal status.',
        );
    }
    if (
      journalLines.some(
        (j) => ['POSTED', 'REVERSED'].includes(j.journalEntry.status) && !used.has(j.id),
      )
    )
      evidence.issues.push(
        'The cash/bank control account has unmatched book entries in this period.',
      );
    evidence.issues = [...new Set(evidence.issues)];
    return {
      ...evidence,
      ready: evidence.issues.length === 0,
      note: 'Checks use this cash account�s dedicated ledger account. Opening balances are supplied by the preparer; original postings and their dated reversals are both included.',
    };
  }

  async findAll(query: QueryBankReconciliationDto, user?: AuthUser) {
    const { companyId, bankAccountId, status, page = 1, limit = 20 } = query;
    const paging = pagination({ page, limit });
    const where: Prisma.BankReconciliationWhereInput = { deletedAt: null };
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
    return paginatedResponse({ data: items, total, page: paging.page, limit: paging.limit });
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

  async create(dto: CreateBankReconciliationDto, user: AuthUser) {
    assertCanAccessCompanyFromUser(user, dto.companyId, AccessLevel.WRITE);
    const start = new Date(dto.statementStartDate),
      end = new Date(dto.statementEndDate);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end)
      throw new BadRequestException('Enter a valid statement period.');
    const cash = await this.prisma.cashAccount.findFirst({
      where: { id: dto.cashAccountId, companyId: dto.companyId, deletedAt: null, isActive: true },
    });
    if (!cash || (dto.currency && cash.currency !== dto.currency))
      throw new BadRequestException('Choose an active cash account in this company and currency.');
    const item = await this.prisma.bankReconciliation.create({
      data: {
        ...dto,
        statementStartDate: start,
        statementEndDate: end,
        currency: cash.currency,
        status: 'DRAFT',
        preparedById: user.id,
      },
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

  async update(
    id: string,
    dto: UpsertBankReconciliationDto,
    user: AuthUser,
  ): Promise<BankReconciliation> {
    if (!this.lockHeld) return this.locked(id, user, (service) => service.update(id, dto, user));
    const existing = await this.findOne(id, user);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT reconciliations can be updated');
    }
    if (dto.companyId && dto.companyId !== existing.companyId) {
      throw new BadRequestException('A reconciliation cannot be moved to another company.');
    }
    if (
      existing.statementLines.length &&
      (dto.cashAccountId || dto.statementStartDate || dto.statementEndDate || dto.currency)
    )
      throw new BadRequestException(
        'Account, currency and dates cannot change after statement lines are added.',
      );
    const start = dto.statementStartDate
      ? new Date(dto.statementStartDate)
      : existing.statementStartDate;
    const end = dto.statementEndDate ? new Date(dto.statementEndDate) : existing.statementEndDate;
    if (start > end) throw new BadRequestException('Enter a valid statement period.');
    const cash = await this.prisma.cashAccount.findFirst({
      where: {
        id: dto.cashAccountId ?? existing.cashAccountId,
        companyId: existing.companyId,
        deletedAt: null,
        isActive: true,
      },
    });
    if (!cash || cash.currency !== (dto.currency ?? existing.currency))
      throw new BadRequestException('Choose an active cash account in this company and currency.');
    const updated = await this.prisma.bankReconciliation.update({
      where: { id },
      data: { ...dto, statementStartDate: start, statementEndDate: end },
    });
    await this.auditLogs.log({
      action: 'UPDATE',
      entityType: 'BankReconciliation',
      entityId: id,
      userId: user.id,
      oldValue: auditRecord(existing),
      newValue: auditRecord(updated),
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

  async addLine(
    reconciliationId: string,
    dto: AddBankStatementLineDto,
    user: AuthUser,
  ): Promise<BankStatementLine> {
    if (!this.lockHeld)
      return this.locked(reconciliationId, user, (service) =>
        service.addLine(reconciliationId, dto, user),
      );
    const reconciliation = await this.findOne(reconciliationId, user);
    if (reconciliation.status !== 'DRAFT') {
      throw new BadRequestException('Statement lines can only be added to DRAFT reconciliations');
    }
    const normalized = normalizeStatementRow(
      {
        ...dto,
        transactionDate: dto.transactionDate.slice(0, 10),
        debitAmount: String(dto.debitAmount ?? 0),
        creditAmount: String(dto.creditAmount ?? 0),
      },
      reconciliation.statementStartDate,
      reconciliation.statementEndDate,
    );
    const line = await this.prisma.bankStatementLine.create({
      data: { ...dto, ...normalized, bankReconciliationId: reconciliationId },
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
  ): Promise<{
    summary: { totalLines: number; autoMatched: number; ambiguous: number; stillUnmatched: number };
    perLine: Array<Record<string, unknown>>;
  }> {
    if (!this.lockHeld)
      return this.locked(reconciliationId, user, (service) =>
        service.runMatching(reconciliationId, user, options),
      );
    const reconciliation = await this.findOne(reconciliationId, user);
    if (reconciliation.status !== 'DRAFT') {
      throw new BadRequestException('Matching can only run on DRAFT reconciliations');
    }

    const dateWindowDays = options.dateWindowDays ?? 3;
    const tolerance = (options.amountToleranceCents ?? 1) / 100;
    if (
      !Number.isInteger(dateWindowDays) ||
      dateWindowDays < 0 ||
      dateWindowDays > 31 ||
      tolerance < 0 ||
      tolerance > 1
    )
      throw new BadRequestException(
        'Matching requires a 0–31 day window and a tolerance between 0 and 100 cents.',
      );
    const alreadyUsed = new Set(
      (
        await this.prisma.bankReconciliationMatch.findMany({
          where: {
            matchedEntityType: 'JournalEntryLine',
            bankReconciliation: { companyId: reconciliation.companyId, deletedAt: null },
          },
          select: { matchedEntityId: true },
        })
      ).map((m) => m.matchedEntityId),
    );

    const unmatched = reconciliation.statementLines.filter((l) => !l.matched);

    const { ledger: cashChart } = await mappedCashAccount(
      this.prisma,
      reconciliation.companyId,
      reconciliation.cashAccountId,
      reconciliation.currency,
    );
    const cashChartAccountId = cashChart.id;

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

      // Candidate journal-entry lines on the same GL cash/bank account in window.
      const candidates = await this.prisma.journalEntryLine.findMany({
        where: {
          accountId: cashChartAccountId,
          companyId: reconciliation.companyId,
          journalEntry: {
            status: { in: ['POSTED', 'REVERSED'] },
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
        return (
          !alreadyUsed.has(c.id) &&
          candidateAmount.isPositive() === lineAmount.isPositive() &&
          candidateAmount.abs().minus(absAmount).abs().lte(tolerance)
        );
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
        alreadyUsed.add(m.id);
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
  ): Promise<BankReconciliationMatch> {
    if (!this.lockHeld)
      return this.locked(reconciliationId, user, (service) =>
        service.manualMatch(reconciliationId, statementLineId, journalEntryLineId, user),
      );
    const reconciliation = await this.findOne(reconciliationId, user);
    if (reconciliation.status !== 'DRAFT') {
      throw new BadRequestException('Statement lines can only be matched on DRAFT reconciliations');
    }
    const line = reconciliation.statementLines.find((l) => l.id === statementLineId);
    if (!line) throw new NotFoundException('Statement line not on this reconciliation');

    const jeLine = await this.prisma.journalEntryLine.findUniqueOrThrow({
      where: { id: journalEntryLineId },
      include: { journalEntry: true },
    });
    if (jeLine.companyId !== reconciliation.companyId) {
      throw new BadRequestException('Journal entry line belongs to another company');
    }
    const cash = await this.prisma.cashAccount.findFirst({
      where: {
        id: reconciliation.cashAccountId,
        companyId: reconciliation.companyId,
        deletedAt: null,
      },
    });
    if (!cash) throw new BadRequestException('Cash account is unavailable.');
    const { ledger: account } = await mappedCashAccount(
      this.prisma,
      reconciliation.companyId,
      reconciliation.cashAccountId,
      reconciliation.currency,
    );
    const used = await this.prisma.bankReconciliationMatch.count({
      where: {
        matchedEntityType: 'JournalEntryLine',
        matchedEntityId: journalEntryLineId,
        bankReconciliation: { deletedAt: null },
      },
    });
    if (
      line.matched ||
      used ||
      jeLine.accountId !== account.id ||
      !['POSTED', 'REVERSED'].includes(jeLine.journalEntry.status) ||
      jeLine.journalEntry.deletedAt ||
      !jeLine.debit.minus(jeLine.credit).eq(line.creditAmount.minus(line.debitAmount))
    )
      throw new BadRequestException(
        'Choose an unused posted journal line on the cash/bank account with the exact amount and direction.',
      );

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
    await this.auditLogs.log({
      action: 'MATCH',
      entityType: 'BankStatementLine',
      entityId: statementLineId,
      userId: user.id,
      companyId: reconciliation.companyId,
      metadata: {
        reconciliationId,
        journalEntryLineId,
        matchId: created.id,
        matchType: 'MANUAL',
      },
    });
    return created;
  }

  async unmatch(reconciliationId: string, statementLineId: string, user: AuthUser): Promise<void> {
    if (!this.lockHeld)
      return this.locked(reconciliationId, user, (service) =>
        service.unmatch(reconciliationId, statementLineId, user),
      );
    const reconciliation = await this.findOne(reconciliationId, user);
    if (reconciliation.status !== 'DRAFT') {
      throw new BadRequestException(
        'Statement lines can only be unmatched on DRAFT reconciliations',
      );
    }
    const line = reconciliation.statementLines.find(
      (candidate) => candidate.id === statementLineId,
    );
    if (!line) {
      // Authorisation is rooted in the reconciliation. Never let an otherwise
      // authorised reconciliation id become a confused-deputy path to a line
      // owned by another reconciliation (and potentially another company).
      throw new NotFoundException('Statement line not on this reconciliation');
    }
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
      companyId: reconciliation.companyId,
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
  ): Promise<{ journalEntryId: string; journalNumber: string; matchId?: string }> {
    if (!this.lockHeld)
      return this.locked(reconciliationId, user, (service) =>
        service.postAdjustment(reconciliationId, dto, user),
      );
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
    if (dto.statementLineId) {
      const line = reconciliation.statementLines.find((l) => l.id === dto.statementLineId);
      const signed = new Prisma.Decimal(dto.amount).mul(dto.direction === 'INCREASE_CASH' ? 1 : -1);
      if (!line || line.matched || !line.creditAmount.minus(line.debitAmount).eq(signed))
        throw new BadRequestException(
          'The adjustment must match an unmatched statement line with the exact amount and direction.',
        );
    }

    const cashAccount = await this.prisma.cashAccount.findFirst({
      where: {
        id: reconciliation.cashAccountId,
        companyId: reconciliation.companyId,
        deletedAt: null,
      },
      select: { accountType: true, divisionId: true, branchId: true },
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const { ledger: cashChart } = await mappedCashAccount(
        tx,
        reconciliation.companyId,
        reconciliation.cashAccountId,
        reconciliation.currency,
      );
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
      if (offsetChart.id === cashChart.id)
        throw new BadRequestException('The offset account must differ from the cash/bank account.');

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

  async approve(id: string, user: AuthUser): Promise<BankReconciliation> {
    if (!this.lockHeld) return this.locked(id, user, (service) => service.approve(id, user));
    const existing = await this.findOne(id, user);
    if (existing.status !== 'DRAFT')
      throw new BadRequestException('Only DRAFT reconciliations can be approved');
    const evidence = await this.evidence(id, user);
    if (!evidence.ready) throw new BadRequestException(evidence.issues.join(' '));
    if (existing.preparedById === user.id) {
      throw new BadRequestException(
        'Maker-checker: the preparer cannot approve their own reconciliation',
      );
    }
    const updated = await this.prisma.bankReconciliation.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedById: user.id,
        reconciledBalance: evidence.bookClose,
        differenceAmount: 0,
      },
    });
    await this.auditLogs.logStrictInTransaction(this.prisma, {
      action: 'APPROVE',
      entityType: 'BankReconciliation',
      entityId: id,
      userId: user.id,
    });
    return updated;
  }

  async close(id: string, user: AuthUser): Promise<BankReconciliation> {
    if (!this.lockHeld) return this.locked(id, user, (service) => service.close(id, user));
    const existing = await this.findOne(id, user);
    if (existing.status !== 'APPROVED')
      throw new BadRequestException('Only APPROVED reconciliations can be closed');
    const evidence = await this.evidence(id, user);
    if (!evidence.ready) throw new BadRequestException(evidence.issues.join(' '));
    const updated = await this.prisma.bankReconciliation.update({
      where: { id },
      data: { status: 'CLOSED', closedAt: new Date(), closedById: user.id },
    });
    await this.auditLogs.logStrictInTransaction(this.prisma, {
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
      include: { statementLines: { include: { matches: true } } },
    });

    // reconciled = bookOpeningBalance + NET matched movement. `match.amount` is
    // stored as a positive magnitude with no direction, so we must sign each
    // matched amount by the direction of the statement line it settles: a bank
    // CREDIT (creditAmount > 0) increases cash on the books, a bank DEBIT
    // (debitAmount > 0) decreases it. Summing every match as positive (the old
    // behaviour) double-counts outflows and inflates the reconciled balance by
    // 2x the outbound movements, corrupting differenceAmount and blocking a
    // genuinely reconciled account from being approved.
    const matchedTotal = reconciliation.statementLines.reduce((sum, line) => {
      const lineMatched = line.matches.reduce(
        (acc, match) => acc.plus(match.amount),
        new Prisma.Decimal(0),
      );
      const outbound = new Prisma.Decimal(line.debitAmount).gt(0);
      return outbound ? sum.minus(lineMatched) : sum.plus(lineMatched);
    }, new Prisma.Decimal(0));

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
