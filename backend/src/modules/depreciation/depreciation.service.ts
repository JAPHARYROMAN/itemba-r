import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AccountingControlService } from '../../common/services/accounting-control.service';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { applyCompanyScopeWhere } from '../../common/services';

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
    private readonly accountingControl: AccountingControlService,
    private readonly accountResolver: AccountResolverService,
    private readonly codes: EntityCodeGeneratorService,
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

  async findOne(id: string) {
    const item = await this.prisma.depreciationSchedule.findFirst({
      where: { id, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Depreciation schedule not found');
    return item;
  }

  async create(dto: any, user: any) {
    const item = await this.prisma.depreciationSchedule.create({
      data: { ...dto, createdById: user.id },
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

  async getEntries(scheduleId: string) {
    return this.prisma.depreciationEntry.findMany({
      where: { depreciationScheduleId: scheduleId },
      orderBy: { depreciationDate: 'asc' },
    });
  }

  async addEntry(scheduleId: string, dto: any, user: any) {
    await this.findOne(scheduleId);
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
    user: any,
  ): Promise<{ created: number }> {
    if (months <= 0 || months > 600) {
      throw new BadRequestException('months must be between 1 and 600');
    }
    const schedule = await this.findOne(scheduleId);
    const existing = await this.prisma.depreciationEntry.findMany({
      where: { depreciationScheduleId: scheduleId, deletedAt: null },
      orderBy: { depreciationDate: 'asc' },
    });

    const totalDepreciable = Number(schedule.totalDepreciableAmount);
    const salvage = Number(schedule.salvageValue);
    let accumulated = Number(schedule.accumulatedDepreciation);
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

    let created = 0;
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < months; i++) {
        const remaining = totalDepreciable - (accumulated - Number(schedule.accumulatedDepreciation));
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
        await tx.depreciationEntry.create({
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
        created++;
        nextDate = this.addMonths(nextDate, 1);
      }
    });

    await this.auditLogs.log({
      action: 'GENERATE',
      entityType: 'DepreciationSchedule',
      entityId: schedule.id,
      userId: user.id,
      companyId: schedule.companyId,
      metadata: { generated: created, months },
    });
    return { created };
  }

  /**
   * Post a DRAFT depreciation entry: enforces the period lock, generates the
   * balanced journal entry (DR expense / CR accumulated depreciation), and
   * advances the schedule's accumulatedDepreciation.
   */
  async postEntry(id: string, user: any) {
    const entry = await this.prisma.depreciationEntry.findFirst({
      where: { id },
      include: {
        depreciationSchedule: { select: { id: true, companyId: true, fixedAssetId: true } },
        fixedAsset: { select: { name: true, assetCode: true } },
      },
    });
    if (!entry) throw new NotFoundException('Depreciation entry not found');
    if (entry.status !== 'DRAFT') throw new BadRequestException('Only DRAFT entries can be posted');

    await this.accountingControl.assertPostingAllowed({
      companyId: entry.depreciationSchedule.companyId,
      transactionDate: entry.depreciationDate,
      moduleName: 'depreciation',
    });

    const amount = Number(entry.amount);
    const description = `Depreciation: ${entry.fixedAsset.assetCode ?? entry.fixedAsset.name}`;

    const updated = await this.prisma.$transaction(async (tx) => {
      // Resolve accounts via the semantic resolver (no hardcoded codes).
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

      const journalNumber = await this.codes.next({ entityType: 'DepreciationJournal', companyId: entry.depreciationSchedule.companyId, tx });
      const je = await tx.journalEntry.create({
        data: {
          journalNumber,
          companyId: entry.depreciationSchedule.companyId,
          transactionDate: entry.depreciationDate,
          description,
          totalDebit: amount,
          totalCredit: amount,
          status: 'POSTED',
          createdById: user.id,
          postedById: user.id,
          postedAt: new Date(),
          referenceType: 'DepreciationEntry',
          referenceId: entry.id,
        },
      });

      await tx.journalEntryLine.createMany({
        data: [
          {
            journalEntryId: je.id,
            accountId: expenseAccount.id,
            companyId: entry.depreciationSchedule.companyId,
            description,
            debit: amount,
            credit: 0,
          },
          {
            journalEntryId: je.id,
            accountId: accumulatedAccount.id,
            companyId: entry.depreciationSchedule.companyId,
            description,
            debit: 0,
            credit: amount,
          },
        ],
      });

      // Advance schedule's accumulatedDepreciation.
      await tx.depreciationSchedule.update({
        where: { id: entry.depreciationScheduleId },
        data: {
          accumulatedDepreciation: { increment: new Prisma.Decimal(amount) },
        },
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

  private straightLinePeriodAmount(totalDepreciable: number, usefulLifeMonths: number | null): number {
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
      return (2 / years) / 12;
    }
    throw new BadRequestException(
      'Either depreciationRate or usefulLifeMonths is required for reducing-balance depreciation',
    );
  }

  private addMonths(date: Date, n: number): Date {
    const d = new Date(date);
    d.setMonth(d.getMonth() + n);
    return d;
  }
}
