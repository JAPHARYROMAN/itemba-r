import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AccountingControlService, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import { QueryJournalEntryDto } from './dto/query-journal-entry.dto';
import { ReverseJournalEntryDto } from './dto/reverse-journal-entry.dto';
import { AccessLevel, AuditSeverity, Prisma } from '@prisma/client';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';

@Injectable()
export class JournalEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly accountingControl: AccountingControlService,
    private readonly companyScope: CompanyScopeService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  private validateLines(lines: CreateJournalEntryDto['lines']) {
    if (!lines || lines.length < 2) {
      throw new BadRequestException('Journal entry must have at least 2 lines');
    }
    let debitCents = 0;
    let creditCents = 0;
    for (const line of lines) {
      const d = this.toCents(line.debit, 'debit');
      const c = this.toCents(line.credit, 'credit');
      if (d > 0 && c > 0) {
        throw new BadRequestException('Each line must have only debit or credit, not both');
      }
      if (d === 0 && c === 0) {
        throw new BadRequestException('Each line must have a non-zero debit or credit');
      }
      debitCents += d;
      creditCents += c;
    }
    if (debitCents !== creditCents) {
      throw new BadRequestException(
        `Debits (${this.fromCents(debitCents)}) must equal credits (${this.fromCents(creditCents)})`,
      );
    }
    return { totalDebit: this.fromCents(debitCents), totalCredit: this.fromCents(creditCents) };
  }

  private async validateLineAccounts(
    companyId: string,
    lines: CreateJournalEntryDto['lines'],
    tx: Pick<PrismaService, 'chartOfAccount'> | Prisma.TransactionClient = this.prisma,
  ) {
    const accountIds = Array.from(new Set(lines.map((line) => line.accountId)));
    const count = await tx.chartOfAccount.count({
      where: {
        id: { in: accountIds },
        companyId,
        deletedAt: null,
        isActive: true,
      },
    });
    if (count !== accountIds.length) {
      throw new BadRequestException(
        'All journal line accounts must be active accounts for the journal company',
      );
    }
  }

  private async assertStoredLinesPostable(
    companyId: string,
    lines: Array<{
      accountId: string;
      debit: Prisma.Decimal | number;
      credit: Prisma.Decimal | number;
    }>,
    tx: Prisma.TransactionClient,
  ) {
    this.assertStoredLinesBalanced(lines);
    const accountIds = Array.from(new Set(lines.map((line) => line.accountId)));
    const count = await tx.chartOfAccount.count({
      where: { id: { in: accountIds }, companyId, deletedAt: null, isActive: true },
    });
    if (count !== accountIds.length) {
      throw new BadRequestException(
        'All journal line accounts must still be active accounts for the journal company',
      );
    }
  }

  private assertStoredLinesBalanced(
    lines: Array<{ debit: Prisma.Decimal | number; credit: Prisma.Decimal | number }>,
  ) {
    if (!lines || lines.length < 2) {
      throw new BadRequestException('Journal entry must have at least 2 lines before posting');
    }
    let debitCents = 0;
    let creditCents = 0;
    for (const line of lines) {
      const debit = this.toCents(line.debit, 'debit');
      const credit = this.toCents(line.credit, 'credit');
      if (debit > 0 && credit > 0) {
        throw new BadRequestException(
          'Each stored journal line must have only debit or credit, not both',
        );
      }
      if (debit === 0 && credit === 0) {
        throw new BadRequestException(
          'Each stored journal line must have a non-zero debit or credit',
        );
      }
      debitCents += debit;
      creditCents += credit;
    }
    if (debitCents !== creditCents) {
      throw new BadRequestException(
        `Stored journal entry is unbalanced: debits=${this.fromCents(debitCents)}, credits=${this.fromCents(creditCents)}`,
      );
    }
  }

  private toCents(value: Prisma.Decimal | number | undefined | null, side: 'debit' | 'credit') {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new BadRequestException(`Journal line ${side} must be a non-negative number`);
    }
    const cents = Math.round(numeric * 100);
    if (Math.abs(numeric * 100 - cents) > 1e-6) {
      throw new BadRequestException(`Journal line ${side} cannot exceed 2 decimal places`);
    }
    return cents;
  }

  private fromCents(cents: number) {
    return cents / 100;
  }

  async findAll(query: QueryJournalEntryDto, user: AuthUser) {
    const { page = 1, limit = 20, companyId, status, accountingPeriodId, dateFrom, dateTo } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (status) where.status = status;
    if (accountingPeriodId) where.accountingPeriodId = accountingPeriodId;
    if (dateFrom || dateTo) {
      where.transactionDate = {};
      if (dateFrom) where.transactionDate.gte = dateRangeStart(dateFrom);
      if (dateTo) where.transactionDate.lte = dateRangeEnd(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: { company: { select: { id: true, name: true, code: true } } },
        orderBy: { transactionDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.journalEntry.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        lines: {
          include: {
            account: {
              select: { id: true, accountCode: true, accountName: true, accountType: true },
            },
          },
        },
        createdBy: { select: { id: true, fullName: true } },
        postedBy: { select: { id: true, fullName: true } },
      },
    });
    if (!record) throw new NotFoundException('Journal entry not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  async create(dto: CreateJournalEntryDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const { totalDebit, totalCredit } = this.validateLines(dto.lines);
    const transactionDate = new Date(dto.transactionDate);
    const period = await this.accountingControl.assertPostingAllowed({
      companyId: dto.companyId,
      accountingPeriodId: dto.accountingPeriodId,
      transactionDate,
      moduleName: 'journal_entries',
    });
    await this.validateLineAccounts(dto.companyId, dto.lines);

    const entry = await this.prisma.$transaction(async (tx) => {
      const journalNumber = await this.codes.next({
        entityType: 'JournalEntry',
        companyId: dto.companyId,
        tx,
      });
      const journalEntry = await tx.journalEntry.create({
        data: {
          journalNumber,
          companyId: dto.companyId,
          divisionId: dto.divisionId,
          branchId: dto.branchId,
          accountingPeriodId: period.id,
          transactionDate,
          description: dto.description,
          referenceType: dto.referenceType,
          referenceId: dto.referenceId,
          totalDebit,
          totalCredit,
          status: 'DRAFT',
          createdById: user.id,
        },
      });

      await tx.journalEntryLine.createMany({
        data: dto.lines.map((line) => ({
          journalEntryId: journalEntry.id,
          accountId: line.accountId,
          description: line.description,
          debit: line.debit ?? 0,
          credit: line.credit ?? 0,
          companyId: dto.companyId,
          divisionId: line.divisionId ?? dto.divisionId,
          branchId: line.branchId ?? dto.branchId,
        })),
      });

      return tx.journalEntry.findUniqueOrThrow({
        where: { id: journalEntry.id },
        include: { lines: true },
      });
    });

    await this.auditLogs.log({
      action: 'JOURNAL_ENTRY_CREATE',
      entityType: 'JournalEntry',
      entityId: entry.id,
      userId: user.id,
      companyId: entry.companyId,
      newValue: { journalNumber: entry.journalNumber, totalDebit, totalCredit } as any,
    });

    return entry;
  }

  async update(id: string, dto: UpdateJournalEntryDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT journal entries can be updated');
    }
    if (dto.companyId && dto.companyId !== existing.companyId) {
      throw new BadRequestException('Journal entry company cannot be changed');
    }

    const lines = dto.lines;
    let totalDebit = existing.totalDebit;
    let totalCredit = existing.totalCredit;
    if (lines) {
      const totals = this.validateLines(lines);
      totalDebit = totals.totalDebit as any;
      totalCredit = totals.totalCredit as any;
    }
    const transactionDate = dto.transactionDate
      ? new Date(dto.transactionDate)
      : existing.transactionDate;
    const accountingPeriodId =
      dto.accountingPeriodId !== undefined
        ? dto.accountingPeriodId
        : dto.transactionDate
          ? undefined
          : existing.accountingPeriodId;

    const period = await this.accountingControl.assertPostingAllowed({
      companyId: existing.companyId,
      accountingPeriodId,
      transactionDate,
      moduleName: 'journal_entries',
    });
    if (lines) await this.validateLineAccounts(existing.companyId, lines);

    const entry = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.journalEntry.update({
        where: { id },
        data: {
          ...(dto.transactionDate && { transactionDate: new Date(dto.transactionDate) }),
          ...(dto.description && { description: dto.description }),
          ...(dto.referenceType !== undefined && { referenceType: dto.referenceType }),
          ...(dto.referenceId !== undefined && { referenceId: dto.referenceId }),
          accountingPeriodId: period.id,
          ...(lines && { totalDebit, totalCredit }),
        },
      });

      if (lines) {
        await tx.journalEntryLine.deleteMany({ where: { journalEntryId: id } });
        await tx.journalEntryLine.createMany({
          data: lines.map((line) => ({
            journalEntryId: id,
            accountId: line.accountId,
            description: line.description,
            debit: line.debit ?? 0,
            credit: line.credit ?? 0,
            companyId: updated.companyId,
            divisionId: line.divisionId ?? updated.divisionId,
            branchId: line.branchId ?? updated.branchId,
          })),
        });
      }

      return tx.journalEntry.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    });

    await this.auditLogs.log({
      action: 'JOURNAL_ENTRY_UPDATE',
      entityType: 'JournalEntry',
      entityId: id,
      userId: user.id,
      companyId: entry.companyId,
      oldValue: { status: existing.status, journalNumber: existing.journalNumber } as any,
      newValue: { journalNumber: entry.journalNumber } as any,
    });

    return entry;
  }

  async post(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT journal entries can be posted');
    }
    if (existing.createdById === user.id) {
      throw new BadRequestException(
        'Journal entries must be posted by a different user than the creator',
      );
    }
    const period = await this.accountingControl.assertPostingAllowed({
      companyId: existing.companyId,
      accountingPeriodId: existing.accountingPeriodId,
      transactionDate: existing.transactionDate,
      moduleName: 'journal_entries',
    });

    const record = await this.prisma.$transaction(async (tx) => {
      const current = await tx.journalEntry.findFirst({
        where: { id, deletedAt: null },
        include: { lines: true },
      });
      if (!current) throw new NotFoundException('Journal entry not found');
      if (current.status !== 'DRAFT') {
        throw new BadRequestException('Only DRAFT journal entries can be posted');
      }
      await this.assertStoredLinesPostable(current.companyId, current.lines, tx);

      const totals = this.validateLines(
        current.lines.map((line) => ({
          accountId: line.accountId,
          debit: Number(line.debit),
          credit: Number(line.credit),
        })),
      );

      const updated = await tx.journalEntry.updateMany({
        where: { id, status: 'DRAFT', deletedAt: null },
        data: {
          status: 'POSTED',
          accountingPeriodId: period.id,
          totalDebit: totals.totalDebit,
          totalCredit: totals.totalCredit,
          postedById: user.id,
          postedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new BadRequestException(
          'Journal entry could not be posted because its status changed',
        );
      }
      return tx.journalEntry.findUniqueOrThrow({ where: { id } });
    });

    await this.auditLogs.log({
      action: 'JOURNAL_ENTRY_POST',
      entityType: 'JournalEntry',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: { status: 'DRAFT' } as any,
      newValue: { status: 'POSTED' } as any,
      severity: AuditSeverity.HIGH,
    });

    return record;
  }

  async reverse(id: string, dto: ReverseJournalEntryDto, user: AuthUser) {
    const original = await this.findOne(id, user, AccessLevel.WRITE);
    if (original.status !== 'POSTED') {
      throw new BadRequestException('Only POSTED journal entries can be reversed');
    }
    if (original.reversalOfId) {
      throw new BadRequestException('Reversal journal entries cannot be reversed directly');
    }
    const reversalDate = dto.transactionDate ? new Date(dto.transactionDate) : new Date();
    const period = await this.accountingControl.assertPostingAllowed({
      companyId: original.companyId,
      accountingPeriodId: dto.accountingPeriodId,
      transactionDate: reversalDate,
      moduleName: 'journal_entries',
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const journalNumber = await this.codes.next({
        entityType: 'JournalEntry',
        companyId: original.companyId,
        tx,
      });
      this.assertStoredLinesBalanced(original.lines);
      const reversalEntry = await tx.journalEntry.create({
        data: {
          journalNumber,
          companyId: original.companyId,
          divisionId: original.divisionId,
          branchId: original.branchId,
          accountingPeriodId: period.id,
          transactionDate: reversalDate,
          description: `Reversal of ${original.journalNumber}: ${dto.reversalReason}`,
          referenceType: original.referenceType,
          referenceId: original.referenceId,
          totalDebit: original.totalDebit,
          totalCredit: original.totalCredit,
          status: 'POSTED',
          createdById: user.id,
          postedById: user.id,
          postedAt: new Date(),
          reversalOfId: original.id,
        },
      });

      await tx.journalEntryLine.createMany({
        data: original.lines.map((line) => ({
          journalEntryId: reversalEntry.id,
          accountId: line.accountId,
          description: line.description,
          debit: Number(line.credit),
          credit: Number(line.debit),
          companyId: line.companyId,
          divisionId: line.divisionId,
          branchId: line.branchId,
        })),
      });

      await tx.journalEntry.update({
        where: { id: original.id },
        data: {
          status: 'REVERSED',
          reversedById: user.id,
          reversedAt: new Date(),
          reversalReason: dto.reversalReason,
        },
      });

      return reversalEntry;
    });

    await this.auditLogs.log({
      action: 'JOURNAL_ENTRY_REVERSE',
      entityType: 'JournalEntry',
      entityId: id,
      userId: user.id,
      companyId: original.companyId,
      oldValue: { status: 'POSTED', journalNumber: original.journalNumber } as any,
      newValue: { status: 'REVERSED', reversalEntryId: result.id } as any,
      severity: AuditSeverity.HIGH,
    });

    return result;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT journal entries can be deleted');
    }
    await this.accountingControl.assertPostingAllowed({
      companyId: existing.companyId,
      accountingPeriodId: existing.accountingPeriodId,
      transactionDate: existing.transactionDate,
      moduleName: 'journal_entries',
    });

    await this.prisma.journalEntry.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'JOURNAL_ENTRY_DELETE',
      entityType: 'JournalEntry',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      oldValue: { journalNumber: existing.journalNumber, status: existing.status } as any,
    });

    return { success: true };
  }
}
