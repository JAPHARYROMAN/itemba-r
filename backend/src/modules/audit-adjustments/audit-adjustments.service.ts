import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel, AuditAdjustmentStatus, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AccountingControlService, CompanyScopeService } from '../../common/services';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { pagination } from '../../common/utils/pagination';
import { paginatedResponse } from '../../common/utils/paginated-response';
import {
  CreateAuditAdjustmentDto,
  QueryAuditAdjustmentDto,
} from './dto/audit-adjustment.dto';

/**
 * Audit adjustments — manual journal entries booked by auditors after the
 * normal close. Maker-checker is enforced at the workflow level.
 *
 * post(): validates the period lock, validates that adjustment lines balance
 * (sum debits == sum credits), generates a balanced JournalEntry from the
 * lines, and links the JE back to the adjustment.
 *
 * reverse(): generates an OPPOSITE journal entry that flips debit and credit
 * on every line. Both entries (original and reversal) remain in the ledger
 * so the audit trail stays intact.
 */
@Injectable()
export class AuditAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly accountingControl: AccountingControlService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryAuditAdjustmentDto, user: AuthUser) {
    const { companyId, status, page = 1, limit = 20 } = query;
    const paging = pagination({ page, limit });
    const where: Prisma.AuditAdjustmentWhereInput = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      this.prisma.auditAdjustment.findMany({
        where,
        skip: paging.skip,
        take: paging.limit,
        orderBy: { createdAt: 'desc' },
        include: { lines: true },
      }),
      this.prisma.auditAdjustment.count({ where }),
    ]);
    return paginatedResponse({ data: items, total, page: paging.page, limit: paging.limit });
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.auditAdjustment.findFirst({
      where: { id, deletedAt: null },
      include: { lines: true },
    });
    if (!item) throw new NotFoundException('Audit adjustment not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async create(dto: CreateAuditAdjustmentDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const lines = Array.isArray(dto.lines) ? dto.lines : [];

    const adjustmentNumber = dto.adjustmentNumber ?? await this.codes.next({ entityType: 'AuditAdjustment', companyId: dto.companyId });
    const item = await this.prisma.auditAdjustment.create({
      data: {
        adjustmentNumber,
        companyId: dto.companyId,
        fiscalYearId: dto.fiscalYearId,
        accountingPeriodId: dto.accountingPeriodId,
        description: dto.description,
        reason: dto.reason,
        status: AuditAdjustmentStatus.DRAFT,
        createdById: user.id,
        ...(lines.length > 0 && {
          lines: {
            createMany: {
              data: lines.map((l) => ({
                accountId: l.accountId,
                description: l.description,
                debit: Number(l.debit ?? 0),
                credit: Number(l.credit ?? 0),
              })),
            },
          },
        }),
      },
      include: { lines: true },
    });
    await this.auditLogs.log({
      action: 'CREATE',
      entityType: 'AuditAdjustment',
      entityId: item.id,
      userId: user.id,
      companyId: item.companyId,
    });
    return item;
  }

  async submit(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== AuditAdjustmentStatus.DRAFT) throw new BadRequestException('Only DRAFT adjustments can be submitted');
    const updated = await this.prisma.auditAdjustment.update({ where: { id }, data: { status: AuditAdjustmentStatus.SUBMITTED } });
    await this.auditLogs.log({ action: 'SUBMIT', entityType: 'AuditAdjustment', entityId: id, userId: user.id });
    return updated;
  }

  async approve(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== AuditAdjustmentStatus.SUBMITTED) throw new BadRequestException('Only SUBMITTED adjustments can be approved');
    if (existing.createdById === user.id) {
      throw new BadRequestException(
        'Maker-checker: you cannot approve an adjustment you submitted. Another approver must act.',
      );
    }
    const updated = await this.prisma.auditAdjustment.update({
      where: { id },
      data: { status: AuditAdjustmentStatus.APPROVED, approvedAt: new Date(), approvedById: user.id },
    });
    await this.auditLogs.log({ action: 'APPROVE', entityType: 'AuditAdjustment', entityId: id, userId: user.id });
    return updated;
  }

  /**
   * Post: enforces period lock, balances debits=credits, generates the
   * balanced journal entry, and atomically links it back.
   */
  async post(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== AuditAdjustmentStatus.APPROVED) throw new BadRequestException('Only APPROVED adjustments can be posted');
    if (existing.lines.length === 0) {
      throw new BadRequestException(
        'Cannot post an adjustment with no lines. Add adjustment lines before posting.',
      );
    }

    // Balance check: sum(debits) must EXACTLY equal sum(credits).
    // Compare in integer cents to avoid float drift and to reject any
    // imbalance (no tolerance) before an unbalanced entry can post.
    const toCents = (value: Prisma.Decimal | number) => {
      const numeric = Number(value ?? 0);
      if (!Number.isFinite(numeric)) {
        throw new BadRequestException('Adjustment line amounts must be finite numbers');
      }
      const cents = Math.round(numeric * 100);
      if (Math.abs(numeric * 100 - cents) > 1e-6) {
        throw new BadRequestException('Adjustment line amounts cannot exceed 2 decimal places');
      }
      return cents;
    };
    const totalDebit = existing.lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = existing.lines.reduce((s, l) => s + Number(l.credit), 0);
    const totalDebitCents = existing.lines.reduce((s, l) => s + toCents(l.debit), 0);
    const totalCreditCents = existing.lines.reduce((s, l) => s + toCents(l.credit), 0);
    if (totalDebitCents !== totalCreditCents) {
      throw new BadRequestException(
        `Adjustment lines do not balance. Debits=${totalDebit}, Credits=${totalCredit}.`,
      );
    }

    await this.accountingControl.assertPostingAllowed({
      companyId: existing.companyId,
      accountingPeriodId: existing.accountingPeriodId,
      transactionDate: new Date(),
      moduleName: 'audit_adjustments',
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const journalNumber = await this.codes.next({ entityType: 'AuditAdjustmentJournal', companyId: existing.companyId, tx });
      const je = await tx.journalEntry.create({
        data: {
          journalNumber,
          companyId: existing.companyId,
          accountingPeriodId: existing.accountingPeriodId,
          transactionDate: new Date(),
          description: `Audit Adjustment: ${existing.description}`,
          totalDebit,
          totalCredit,
          status: AuditAdjustmentStatus.POSTED,
          createdById: user.id,
          postedById: user.id,
          postedAt: new Date(),
          referenceType: 'AuditAdjustment',
          referenceId: existing.id,
        },
      });
      await tx.journalEntryLine.createMany({
        data: existing.lines.map((l) => ({
          journalEntryId: je.id,
          companyId: existing.companyId,
          accountId: l.accountId,
          description: l.description ?? existing.description,
          debit: l.debit,
          credit: l.credit,
        })),
      });

      return tx.auditAdjustment.update({
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
      entityType: 'AuditAdjustment',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      metadata: { journalEntryId: updated.journalEntryId, totalDebit, totalCredit },
    });
    return updated;
  }

  /**
   * Reverse a POSTED adjustment by booking an offsetting journal entry.
   * The original JE stays — both are visible in the audit trail.
   */
  async reverse(id: string, reason: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== AuditAdjustmentStatus.POSTED) {
      throw new BadRequestException('Only POSTED adjustments can be reversed');
    }
    if (!existing.journalEntryId) {
      throw new BadRequestException('Original journal entry is missing — cannot reverse');
    }
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('A reason is required to reverse an adjustment');
    }

    await this.accountingControl.assertPostingAllowed({
      companyId: existing.companyId,
      accountingPeriodId: existing.accountingPeriodId,
      transactionDate: new Date(),
      moduleName: 'audit_adjustments',
    });

    const totalDebit = existing.lines.reduce((s, l) => s + Number(l.credit), 0);
    const totalCredit = existing.lines.reduce((s, l) => s + Number(l.debit), 0);

    const updated = await this.prisma.$transaction(async (tx) => {
      const journalNumber = await this.codes.next({ entityType: 'AuditAdjustmentReversalJournal', companyId: existing.companyId, tx });
      const reversalJe = await tx.journalEntry.create({
        data: {
          journalNumber,
          companyId: existing.companyId,
          accountingPeriodId: existing.accountingPeriodId,
          transactionDate: new Date(),
          description: `Reversal of audit adjustment ${existing.adjustmentNumber}: ${reason}`,
          totalDebit,
          totalCredit,
          status: 'POSTED',
          createdById: user.id,
          postedById: user.id,
          postedAt: new Date(),
          referenceType: 'AuditAdjustment',
          referenceId: existing.id,
          reversalOfId: existing.journalEntryId ?? undefined,
          reversalReason: reason,
        },
      });
      await tx.journalEntryLine.createMany({
        // Flip debit/credit to produce the offsetting entry.
        data: existing.lines.map((l) => ({
          journalEntryId: reversalJe.id,
          companyId: existing.companyId,
          accountId: l.accountId,
          description: l.description ?? existing.description,
          debit: l.credit,
          credit: l.debit,
        })),
      });

      return tx.auditAdjustment.update({
        where: { id },
        data: {
          status: AuditAdjustmentStatus.REVERSED,
          reversedAt: new Date(),
          reversedById: user.id,
          reversalReason: reason,
          reversalJournalEntryId: reversalJe.id,
        },
      });
    });

    await this.auditLogs.log({
      action: 'REVERSE',
      entityType: 'AuditAdjustment',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      metadata: { reversalJournalEntryId: updated.reversalJournalEntryId, reason },
    });

    return updated;
  }
}
