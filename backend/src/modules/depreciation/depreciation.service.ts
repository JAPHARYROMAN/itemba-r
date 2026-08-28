import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';

/**
 * Depreciation engine.
 *
 * Posting model: each DepreciationEntry, when posted, creates a balanced
 * JournalEntry with two lines:
 *   DR  Depreciation Expense        (DEPRECIATION_EXPENSE)
 *   CR  Accumulated Depreciation    (ACCUMULATED_DEPRECIATION, contra-asset)
 *
 * Schedule generation (straight-line / reducing-balance) is provided so the
 * caller can populate the period entries up-front rather than hand-entering.
 *
 * Defaults documented inline — easy to override per-asset via the schedule:
 *   - Straight-line:   `(cost - salvage) / usefulLifeMonths`, posted monthly.
 *   - Reducing-balance: `bookValue × monthlyRate`, posted monthly until book
 *                       value reaches salvage value.
 */
@Injectable()
export class DepreciationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly accountResolver: AccountResolverService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly postingEngine: PostingEngineService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: any, user?: any) {
    const { companyId, assetId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (assetId) where.fixedAssetId = assetId;
    const [items, total] = await Promise.all([
      this.prisma.depreciationSchedule.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.depreciationSchedule.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.depreciationSchedule.findFirst({
      where: { id, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Depreciation schedule not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async create(dto: any, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const item = await this.prisma.depreciationSchedule.create({
      data: { ...dto, companyId: dto.companyId, createdById: user.id },
    });
    await this.auditLogs.log({
      action: 'CREATE',
      entityType: 'DepreciationSchedule',
      entityId: item.id,
      userId: user.id,
      companyId: item.companyId,
    });
    return item;
  }

  async getEntries(scheduleId: string, user: AuthUser) {
    await this.findOne(scheduleId, user);
    return this.prisma.depreciationEntry.findMany({
      where: { depreciationScheduleId: scheduleId },
      orderBy: { depreciationDate: 'asc' },
    });
  }

  async addEntry(scheduleId: string, dto: any, user: AuthUser) {
    await this.findOne(scheduleId, user, AccessLevel.WRITE);
    const entry = await this.prisma.depreciationEntry.create({
      data: { ...dto, depreciationScheduleId: scheduleId, status: 'DRAFT' },
    });
    await this.auditLogs.log({
      action: 'CREATE',
      entityType: 'DepreciationEntry',
      entityId: entry.id,
      userId: user.id,
    });
    return entry;
  }

  /**
   * Generate DRAFT depreciation entries for the schedule for `months` months
   * starting at the schedule's startDate (or the most recent entry's next
   * period). Idempotent — skips months that already have an entry.
   */
  async generateEntries(
    scheduleId: string,
    months: number,
    user: AuthUser,
  ): Promise<{ created: number; entryIds: string[] }> {
    if (months <= 0 || months > 600) {
      throw new BadRequestException('months must be between 1 and 600');
    }
    const authorizedSchedule = await this.findOne(scheduleId, user, AccessLevel.WRITE);
    const generated = await this.prisma.$transaction(async (tx) => {
      // Serialize generation for one schedule before reading its existing
      // entries. Without this lock, two requests can both observe the same
      // final month and create duplicate DRAFT periods.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "depreciation_schedules"
        WHERE "id" = ${scheduleId} AND "deletedAt" IS NULL
        FOR UPDATE`;
      if (locked.length === 0) {
        throw new NotFoundException('Depreciation schedule not found');
      }

      const schedule = await tx.depreciationSchedule.findFirst({
        where: { id: scheduleId, deletedAt: null },
      });
      if (!schedule || schedule.companyId !== authorizedSchedule.companyId) {
        throw new NotFoundException('Depreciation schedule not found');
      }
      const existing = await tx.depreciationEntry.findMany({
        where: { depreciationScheduleId: scheduleId, deletedAt: null },
        orderBy: { depreciationDate: 'asc' },
      });

      const totalDepreciable = Number(schedule.totalDepreciableAmount);
      const salvage = Number(schedule.salvageValue);
      // POSTED entries are already reflected in the schedule. DRAFT entries
      // are not, so include them before calculating any additional periods.
      let accumulated =
        Number(schedule.accumulatedDepreciation) +
        existing
          .filter((entry) => entry.status === 'DRAFT')
          .reduce((sum, entry) => sum + Number(entry.amount), 0);
      let nextDate =
        existing.length > 0
          ? this.addMonths(existing[existing.length - 1].depreciationDate, 1)
          : new Date(schedule.startDate);

      const periodAmount =
        schedule.depreciationMethod === 'STRAIGHT_LINE'
          ? this.straightLinePeriodAmount(totalDepreciable, schedule.usefulLifeMonths)
          : null; // reducing-balance is computed per-period below

      const reducingMonthlyRate =
        schedule.depreciationMethod === 'REDUCING_BALANCE'
          ? this.deriveReducingMonthlyRate(schedule.depreciationRate, schedule.usefulLifeMonths)
          : null;

      const entryIds: string[] = [];
      for (let i = 0; i < months; i++) {
        const remaining = totalDepreciable - accumulated;
        if (remaining <= 0) break;

        let amount: number;
        if (schedule.depreciationMethod === 'STRAIGHT_LINE') {
          amount = Math.min(periodAmount!, remaining);
        } else if (schedule.depreciationMethod === 'REDUCING_BALANCE') {
          // Book value before this period = totalDepreciable + salvage - accumulated.
          const bookValue = totalDepreciable + salvage - accumulated;
          amount = Math.max(0, Math.min(bookValue * reducingMonthlyRate!, bookValue - salvage));
        } else {
          // MANUAL / OTHER — no auto-generation.
          break;
        }

        if (amount <= 0) break;

        accumulated += amount;
        const entry = await tx.depreciationEntry.create({
          data: {
            depreciationScheduleId: schedule.id,
            companyId: schedule.companyId,
            fixedAssetId: schedule.fixedAssetId,
            depreciationDate: nextDate,
            amount,
            accumulatedDepreciationAfter: accumulated,
            status: 'DRAFT',
          },
        });
        entryIds.push(entry.id);
        nextDate = this.addMonths(nextDate, 1);
      }
      const generated = { created: entryIds.length, entryIds };
      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'GENERATE',
        entityType: 'DepreciationSchedule',
        entityId: authorizedSchedule.id,
        userId: user.id,
        companyId: authorizedSchedule.companyId,
        metadata: { generated: generated.created, months },
      });
      return generated;
    });
    return generated;
  }

  /**
   * Post a DRAFT depreciation entry: enforces the period lock, generates the
   * balanced journal entry (DR expense / CR accumulated depreciation), and
   * advances the schedule's accumulatedDepreciation.
   */
  async postEntry(id: string, user: AuthUser) {
    const entry = await this.prisma.depreciationEntry.findFirst({
      where: { id, deletedAt: null },
      include: {
        depreciationSchedule: {
          select: { id: true, companyId: true, fixedAssetId: true, salvageValue: true },
        },
        fixedAsset: { select: { name: true, assetCode: true, divisionId: true, branchId: true } },
      },
    });
    if (!entry) throw new NotFoundException('Depreciation entry not found');
    await this.companyScope.assertCanAccessCompany(
      user,
      entry.depreciationSchedule.companyId,
      AccessLevel.WRITE,
    );
    if (entry.status !== 'DRAFT') throw new BadRequestException('Only DRAFT entries can be posted');

    const amount = Number(entry.amount);
    const description = `Depreciation: ${entry.fixedAsset.assetCode ?? entry.fixedAsset.name}`;

    const updated = await this.prisma.$transaction(async (tx) => {
      // Re-assert the DRAFT status under the transaction as a conditional
      // claim to prevent a TOCTOU double-post (concurrent posts of the same
      // entry). Only one transaction can flip DRAFT -> POSTED; the loser sees
      // count === 0 and aborts before posting the JE / incrementing the schedule.
      const claimed = await tx.depreciationEntry.updateMany({
        where: { id, status: 'DRAFT', deletedAt: null },
        data: { status: 'POSTED' },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('Only DRAFT entries can be posted');
      }

      const expenseAccount = await this.accountResolver.resolve(
        entry.depreciationSchedule.companyId,
        'DEPRECIATION_EXPENSE',
        tx,
      );
      const accumulatedAccount = await this.accountResolver.resolve(
        entry.depreciationSchedule.companyId,
        'ACCUMULATED_DEPRECIATION',
        tx,
      );

      const journalNumber = await this.codes.next({
        entityType: 'DepreciationJournal',
        companyId: entry.depreciationSchedule.companyId,
        tx,
      });
      const je = await this.postingEngine.postLines(
        {
          journalNumber,
          companyId: entry.depreciationSchedule.companyId,
          divisionId: entry.fixedAsset.divisionId,
          branchId: entry.fixedAsset.branchId,
          transactionDate: entry.depreciationDate,
          description,
          referenceType: 'DepreciationEntry',
          referenceId: entry.id,
          moduleName: 'depreciation',
          userId: user.id,
          lines: [
            {
              accountId: expenseAccount.id,
              description,
              debit: amount,
              credit: 0,
            },
            {
              accountId: accumulatedAccount.id,
              description,
              debit: 0,
              credit: amount,
            },
          ],
        },
        tx,
      );

      // Advance schedule's accumulatedDepreciation.
      await tx.depreciationSchedule.update({
        where: { id: entry.depreciationScheduleId },
        data: {
          accumulatedDepreciation: { increment: new Prisma.Decimal(amount) },
        },
      });

      // Keep the fixed-asset subledger in lockstep with the GL: the JE credits
      // the ACCUMULATED_DEPRECIATION contra-account, so net book value falls by
      // `amount` in the ledger. Mirror that on FixedAsset.currentBookValue,
      // floored at the schedule's salvage value so book value never dips below
      // residual. Lock the asset row FOR UPDATE first so the read-modify-write
      // is atomic under concurrent posts (mirrors loans.recordRepayment).
      const assetRows = await tx.$queryRaw<Array<{ currentBookValue: Prisma.Decimal }>>`
        SELECT "currentBookValue" FROM "fixed_assets"
        WHERE "id" = ${entry.depreciationSchedule.fixedAssetId}
        FOR UPDATE`;
      if (assetRows.length === 0) {
        throw new NotFoundException('Fixed asset not found');
      }
      const priorBookValue = new Prisma.Decimal(assetRows[0].currentBookValue);
      const salvageFloor = new Prisma.Decimal(entry.depreciationSchedule.salvageValue);
      let newBookValue = priorBookValue.minus(new Prisma.Decimal(amount));
      if (newBookValue.lt(salvageFloor)) newBookValue = salvageFloor;
      await tx.fixedAsset.update({
        where: { id: entry.depreciationSchedule.fixedAssetId },
        data: { currentBookValue: newBookValue },
      });

      return tx.depreciationEntry.update({
        where: { id },
        data: {
          status: 'POSTED',
          postedAt: new Date(),
          postedById: user.id,
          journalEntryId: je.id,
        },
      });
    });

    await this.auditLogs.log({
      action: 'POST',
      entityType: 'DepreciationEntry',
      entityId: id,
      userId: user.id,
      companyId: entry.depreciationSchedule.companyId,
      metadata: { amount, journalEntryId: updated.journalEntryId },
    });
    return updated;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private straightLinePeriodAmount(
    totalDepreciable: number,
    usefulLifeMonths: number | null,
  ): number {
    if (!usefulLifeMonths || usefulLifeMonths <= 0) {
      throw new BadRequestException(
        'usefulLifeMonths is required on the schedule for straight-line depreciation',
      );
    }
    return Math.round((totalDepreciable / usefulLifeMonths) * 100) / 100;
  }

  /**
   * For reducing-balance, the schedule may store either an explicit annual
   * depreciationRate (e.g. 0.25 = 25%/year) OR a usefulLifeMonths from which
   * we derive a rate. Convert to a per-month rate.
   */
  private deriveReducingMonthlyRate(
    annualRate: Prisma.Decimal | null,
    usefulLifeMonths: number | null,
  ): number {
    if (annualRate) {
      return Number(annualRate) / 12;
    }
    if (usefulLifeMonths && usefulLifeMonths > 0) {
      // Convert a useful life into an equivalent annual rate via the
      // double-declining-balance approximation (2 / years).
      const years = usefulLifeMonths / 12;
      return 2 / years / 12;
    }
    throw new BadRequestException(
      'Either depreciationRate or usefulLifeMonths is required for reducing-balance depreciation',
    );
  }

  private addMonths(date: Date, n: number): Date {
    const d = new Date(date);
    const sourceDay = d.getDate();
    const sourceWasMonthEnd =
      sourceDay === new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const targetMonthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(sourceWasMonthEnd ? targetMonthEnd : Math.min(sourceDay, targetMonthEnd));
    return d;
  }
}
