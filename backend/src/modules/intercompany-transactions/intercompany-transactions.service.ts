import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AccountingControlService } from '../../common/services/accounting-control.service';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CreateIntercompanyTransactionDto } from './dto/create-intercompany-transaction.dto';
import { UpdateIntercompanyTransactionDto } from './dto/update-intercompany-transaction.dto';
import { QueryIntercompanyTransactionDto } from './dto/query-intercompany-transaction.dto';
import { RejectIntercompanyTransactionDto } from './dto/reject-intercompany-transaction.dto';
import { AuditSeverity } from '@prisma/client';

@Injectable()
export class IntercompanyTransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly accountingControl: AccountingControlService,
    private readonly accountResolver: AccountResolverService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  async findAll(query: QueryIntercompanyTransactionDto) {
    const { page = 1, limit = 20, fromCompanyId, toCompanyId, status, type } = query;
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };
    if (fromCompanyId) where.fromCompanyId = fromCompanyId;
    if (toCompanyId) where.toCompanyId = toCompanyId;
    if (status) where.status = status;
    if (type) where.transactionType = type;

    const [data, total] = await Promise.all([
      this.prisma.interCompanyTransaction.findMany({
        where,
        include: {
          fromCompany: { select: { id: true, name: true, code: true } },
          toCompany: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, fullName: true } },
        },
        orderBy: { transactionDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.interCompanyTransaction.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.interCompanyTransaction.findFirst({
      where: { id, deletedAt: null },
      include: {
        fromCompany: { select: { id: true, name: true, code: true } },
        toCompany: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
      },
    });
    if (!record) throw new NotFoundException('Intercompany transaction not found');
    return record;
  }

  async create(dto: CreateIntercompanyTransactionDto, userId: string) {
    if (dto.fromCompanyId === dto.toCompanyId) {
      throw new BadRequestException('fromCompanyId and toCompanyId must be different');
    }

    const transactionNumber = await this.codes.next({ entityType: 'IntercompanyTransaction', companyId: dto.fromCompanyId });
    const record = await this.prisma.interCompanyTransaction.create({
      data: {
        transactionNumber,
        fromCompanyId: dto.fromCompanyId,
        toCompanyId: dto.toCompanyId,
        transactionType: dto.transactionType,
        amount: dto.amount,
        currency: dto.currency,
        transactionDate: new Date(dto.transactionDate),
        description: dto.description,
        status: 'DRAFT',
        createdById: userId,
      },
    });

    await this.auditLogs.log({
      action: 'INTERCOMPANY_CREATE',
      entityType: 'InterCompanyTransaction',
      entityId: record.id,
      userId,
      newValue: record as any,
    });

    return record;
  }

  async update(id: string, dto: UpdateIntercompanyTransactionDto, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT intercompany transactions can be updated');
    }

    if (dto.fromCompanyId && dto.toCompanyId && dto.fromCompanyId === dto.toCompanyId) {
      throw new BadRequestException('fromCompanyId and toCompanyId must be different');
    }

    const record = await this.prisma.interCompanyTransaction.update({
      where: { id },
      data: {
        ...(dto.transactionType && { transactionType: dto.transactionType }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.currency && { currency: dto.currency }),
        ...(dto.transactionDate && { transactionDate: new Date(dto.transactionDate) }),
        ...(dto.description && { description: dto.description }),
      },
    });

    await this.auditLogs.log({
      action: 'INTERCOMPANY_UPDATE',
      entityType: 'InterCompanyTransaction',
      entityId: id,
      userId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }

  async submit(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT transactions can be submitted');
    }

    const record = await this.prisma.interCompanyTransaction.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL' },
    });

    await this.auditLogs.log({
      action: 'INTERCOMPANY_SUBMIT',
      entityType: 'InterCompanyTransaction',
      entityId: id,
      userId,
      oldValue: { status: 'DRAFT' } as any,
      newValue: { status: 'PENDING_APPROVAL' } as any,
    });

    return record;
  }

  async approve(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only PENDING_APPROVAL transactions can be approved');
    }

    const record = await this.prisma.interCompanyTransaction.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
    });

    await this.auditLogs.log({
      action: 'INTERCOMPANY_APPROVE',
      entityType: 'InterCompanyTransaction',
      entityId: id,
      userId,
      oldValue: { status: 'PENDING_APPROVAL' } as any,
      newValue: { status: 'APPROVED' } as any,
    });

    return record;
  }

  async reject(id: string, dto: RejectIntercompanyTransactionDto, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only PENDING_APPROVAL transactions can be rejected');
    }

    const record = await this.prisma.interCompanyTransaction.update({
      where: { id },
      data: { status: 'REJECTED', rejectedReason: dto.reason },
    });

    await this.auditLogs.log({
      action: 'INTERCOMPANY_REJECT',
      entityType: 'InterCompanyTransaction',
      entityId: id,
      userId,
      oldValue: { status: 'PENDING_APPROVAL' } as any,
      newValue: { status: 'REJECTED', reason: dto.reason } as any,
    });

    return record;
  }

  async post(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'APPROVED') {
      throw new BadRequestException('Only APPROVED transactions can be posted');
    }

    // Period locks must be honored on BOTH sides of the intercompany posting.
    await this.accountingControl.assertPostingAllowed({
      companyId: existing.fromCompanyId,
      transactionDate: existing.transactionDate,
      moduleName: 'intercompany',
    });
    await this.accountingControl.assertPostingAllowed({
      companyId: existing.toCompanyId,
      transactionDate: existing.transactionDate,
      moduleName: 'intercompany',
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const amount = Number(existing.amount);
      const desc = existing.description;
      const date = existing.transactionDate;

      // Resolve all four accounts up-front. If any role is unmappable on
      // either company's chart, this throws BEFORE any journal lines are
      // written — no more silent skips when accounts are missing.
      const fromAccounts = await this.accountResolver.resolveMany(
        existing.fromCompanyId,
        ['INTERCOMPANY_RECEIVABLE', 'CASH_ON_HAND'],
        tx,
      );
      const toAccounts = await this.accountResolver.resolveMany(
        existing.toCompanyId,
        ['CASH_ON_HAND', 'INTERCOMPANY_PAYABLE'],
        tx,
      );
      const fromArAccount = fromAccounts.INTERCOMPANY_RECEIVABLE;
      const fromCashAccount = fromAccounts.CASH_ON_HAND;
      const toCashAccount = toAccounts.CASH_ON_HAND;
      const toApAccount = toAccounts.INTERCOMPANY_PAYABLE;

      const fromJeNumber = await this.codes.next({ entityType: 'JournalEntry', companyId: existing.fromCompanyId, tx });
      const toJeNumber = await this.codes.next({ entityType: 'JournalEntry', companyId: existing.toCompanyId, tx });

      const fromJe = await tx.journalEntry.create({
        data: {
          journalNumber: fromJeNumber,
          companyId: existing.fromCompanyId,
          transactionDate: date,
          description: `IC Transaction: ${desc}`,
          totalDebit: amount,
          totalCredit: amount,
          status: 'POSTED',
          createdById: userId,
          postedById: userId,
          postedAt: new Date(),
        },
      });

      await tx.journalEntryLine.createMany({
        data: [
          {
            journalEntryId: fromJe.id,
            accountId: fromArAccount.id,
            description: `IC Receivable: ${desc}`,
            debit: amount,
            credit: 0,
            companyId: existing.fromCompanyId,
          },
          {
            journalEntryId: fromJe.id,
            accountId: fromCashAccount.id,
            description: `IC Cash: ${desc}`,
            debit: 0,
            credit: amount,
            companyId: existing.fromCompanyId,
          },
        ],
      });

      const toJe = await tx.journalEntry.create({
        data: {
          journalNumber: toJeNumber,
          companyId: existing.toCompanyId,
          transactionDate: date,
          description: `IC Transaction: ${desc}`,
          totalDebit: amount,
          totalCredit: amount,
          status: 'POSTED',
          createdById: userId,
          postedById: userId,
          postedAt: new Date(),
        },
      });

      await tx.journalEntryLine.createMany({
        data: [
          {
            journalEntryId: toJe.id,
            accountId: toCashAccount.id,
            description: `IC Cash received: ${desc}`,
            debit: amount,
            credit: 0,
            companyId: existing.toCompanyId,
          },
          {
            journalEntryId: toJe.id,
            accountId: toApAccount.id,
            description: `IC Payable: ${desc}`,
            debit: 0,
            credit: amount,
            companyId: existing.toCompanyId,
          },
        ],
      });

      return tx.interCompanyTransaction.update({
        where: { id },
        data: {
          status: 'POSTED',
          postedAt: new Date(),
          fromCompanyJournalEntryId: fromJe.id,
          toCompanyJournalEntryId: toJe.id,
        },
      });
    });

    await this.auditLogs.log({
      action: 'INTERCOMPANY_POST',
      entityType: 'InterCompanyTransaction',
      entityId: id,
      userId,
      oldValue: { status: 'APPROVED' } as any,
      newValue: { status: 'POSTED' } as any,
      severity: AuditSeverity.HIGH,
    });

    return result;
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT transactions can be deleted');
    }

    await this.prisma.interCompanyTransaction.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'INTERCOMPANY_DELETE',
      entityType: 'InterCompanyTransaction',
      entityId: id,
      userId,
      oldValue: existing as any,
    });

    return { success: true };
  }
}
