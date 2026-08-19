import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpenseDto } from './dto/query-expense.dto';
import { RejectExpenseDto } from './dto/reject-expense.dto';
import { AccessLevel, AuditSeverity, CashAccount, Prisma } from '@prisma/client';
import { AccountingControlService, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import { PayExpenseDto } from './dto/pay-expense.dto';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly accountingControl: AccountingControlService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly companyScope: CompanyScopeService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  private async resolveCashLedgerAccountId(
    tx: Prisma.TransactionClient,
    companyId: string,
    cashAccount: CashAccount,
  ) {
    const preferredCode = cashAccount.accountType === 'BANK' ? '1010' : '1000';
    const fallbackName = cashAccount.accountType === 'BANK' ? 'Bank' : 'Cash';

    const account = await tx.chartOfAccount.findFirst({
      where: {
        companyId,
        accountType: 'ASSET',
        isActive: true,
        deletedAt: null,
        OR: [
          { accountCode: preferredCode },
          { accountName: cashAccount.accountName },
          { accountName: { contains: fallbackName, mode: 'insensitive' } },
        ],
      },
      orderBy: { accountCode: 'asc' },
    });

    if (!account) {
      throw new BadRequestException(
        `No active ${fallbackName.toLowerCase()} ledger account found for cash account ${cashAccount.accountName}`,
      );
    }

    return account.id;
  }

  async findAll(query: QueryExpenseDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      expenseCategoryId,
      status,
      dateFrom,
      dateTo,
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (expenseCategoryId) where.expenseCategoryId = expenseCategoryId;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.expenseDate = {};
      if (dateFrom) where.expenseDate.gte = dateRangeStart(dateFrom);
      if (dateTo) where.expenseDate.lte = dateRangeEnd(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          expenseCategory: { select: { id: true, name: true } },
          cashAccount: { select: { id: true, accountName: true } },
        },
        orderBy: { expenseDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.expense.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user?: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.expense.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        expenseCategory: true,
        cashAccount: {
          select: {
            id: true,
            accountName: true,
            accountType: true,
            currency: true,
            currentBalance: true,
          },
        },
        createdBy: { select: { id: true, fullName: true, email: true } },
        approvedBy: { select: { id: true, fullName: true, email: true } },
        paidBy: { select: { id: true, fullName: true, email: true } },
        journalEntry: {
          select: {
            id: true,
            journalNumber: true,
            transactionDate: true,
            description: true,
            status: true,
            totalDebit: true,
            totalCredit: true,
            postedAt: true,
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Expense not found');
    if (user) await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);

    const [division, branch] = await Promise.all([
      record.divisionId
        ? this.prisma.division.findFirst({
            where: { id: record.divisionId, companyId: record.companyId, deletedAt: null },
            select: { id: true, name: true, code: true },
          })
        : null,
      record.branchId
        ? this.prisma.branch.findFirst({
            where: {
              id: record.branchId,
              deletedAt: null,
              division: { companyId: record.companyId },
            },
            select: { id: true, name: true, code: true },
          })
        : null,
    ]);

    return { ...record, division, branch };
  }

  async create(dto: CreateExpenseDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const userId = user.id;
    const expenseNumber = await this.codes.next({
      entityType: 'Expense',
      companyId: dto.companyId,
    });
    const record = await this.prisma.expense.create({
      data: {
        expenseNumber,
        companyId: dto.companyId,
        divisionId: dto.divisionId,
        branchId: dto.branchId,
        expenseCategoryId: dto.expenseCategoryId,
        cashAccountId: dto.cashAccountId,
        vendorName: dto.vendorName,
        amount: dto.amount,
        currency: dto.currency,
        expenseDate: new Date(dto.expenseDate),
        description: dto.description,
        paymentMethod: dto.paymentMethod,
        status: 'DRAFT',
        createdById: userId,
      },
    });

    await this.auditLogs.log({
      action: 'EXPENSE_CREATE',
      entityType: 'Expense',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });

    return record;
  }

  async update(id: string, dto: UpdateExpenseDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['DRAFT', 'PENDING_APPROVAL'].includes(existing.status)) {
      throw new BadRequestException(
        'Expense can only be updated in DRAFT or PENDING_APPROVAL status',
      );
    }

    const record = await this.prisma.expense.update({
      where: { id },
      data: {
        ...(dto.vendorName !== undefined && { vendorName: dto.vendorName }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.currency && { currency: dto.currency }),
        ...(dto.expenseDate && { expenseDate: new Date(dto.expenseDate) }),
        ...(dto.description && { description: dto.description }),
        ...(dto.paymentMethod !== undefined && { paymentMethod: dto.paymentMethod }),
        ...(dto.expenseCategoryId && { expenseCategoryId: dto.expenseCategoryId }),
        ...(dto.cashAccountId !== undefined && { cashAccountId: dto.cashAccountId }),
        ...(dto.divisionId !== undefined && { divisionId: dto.divisionId }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
      },
    });

    await this.auditLogs.log({
      action: 'EXPENSE_UPDATE',
      entityType: 'Expense',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }

  async submit(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT expenses can be submitted');
    }

    const record = await this.prisma.expense.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL' },
    });

    await this.auditLogs.log({
      action: 'EXPENSE_SUBMIT',
      entityType: 'Expense',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'DRAFT' } as any,
      newValue: { status: 'PENDING_APPROVAL' } as any,
    });

    return record;
  }

  async approve(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only PENDING_APPROVAL expenses can be approved');
    }

    const record = await this.prisma.expense.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
    });

    await this.auditLogs.log({
      action: 'EXPENSE_APPROVE',
      entityType: 'Expense',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'PENDING_APPROVAL' } as any,
      newValue: { status: 'APPROVED' } as any,
    });

    return record;
  }

  async reject(id: string, dto: RejectExpenseDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only PENDING_APPROVAL expenses can be rejected');
    }

    const record = await this.prisma.expense.update({
      where: { id },
      data: { status: 'REJECTED', rejectedReason: dto.reason },
    });

    await this.auditLogs.log({
      action: 'EXPENSE_REJECT',
      entityType: 'Expense',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'PENDING_APPROVAL' } as any,
      newValue: { status: 'REJECTED', reason: dto.reason } as any,
    });

    return record;
  }

  async paymentOptions(id: string, user: AuthUser) {
    const expense = await this.findOne(id, user, AccessLevel.WRITE);
    if (expense.status !== 'APPROVED') {
      throw new BadRequestException('Only APPROVED expenses can be paid');
    }

    return this.prisma.cashAccount.findMany({
      where: {
        companyId: expense.companyId,
        currency: expense.currency,
        deletedAt: null,
        isActive: true,
      },
      select: {
        id: true,
        accountName: true,
        accountType: true,
        currency: true,
        currentBalance: true,
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ accountType: 'asc' }, { accountName: 'asc' }],
    });
  }

  async pay(id: string, dto: PayExpenseDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'APPROVED') {
      throw new BadRequestException('Only APPROVED expenses can be paid');
    }
    const cashAccountId = dto.cashAccountId?.trim() || existing.cashAccountId;
    if (!cashAccountId) {
      throw new BadRequestException('Cash account is required before an expense can be paid');
    }
    if (!existing.expenseCategory?.linkedAccountId) {
      throw new BadRequestException(
        'Expense category must be linked to a ledger account before payment',
      );
    }
    const expenseLedgerAccountId = existing.expenseCategory.linkedAccountId;

    const paymentDate = new Date();
    await this.accountingControl.assertPostingAllowed({
      companyId: existing.companyId,
      transactionDate: paymentDate,
      moduleName: 'expenses',
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const cashAccount = await tx.cashAccount.findFirst({
        where: {
          id: cashAccountId,
          companyId: existing.companyId,
          currency: existing.currency,
          deletedAt: null,
          isActive: true,
        },
      });

      if (!cashAccount) {
        throw new BadRequestException(
          `Select an active ${existing.currency} cash or bank account for this expense company`,
        );
      }

      const cashLedgerAccountId = await this.resolveCashLedgerAccountId(
        tx,
        existing.companyId,
        cashAccount,
      );

      const jeNumber = await this.codes.next({
        entityType: 'ExpenseJournal',
        companyId: existing.companyId,
        tx,
      });
      const je = await this.postingEngine.postLines(
        {
          journalNumber: jeNumber,
          companyId: existing.companyId,
          divisionId: existing.divisionId,
          branchId: existing.branchId,
          transactionDate: paymentDate,
          description: `Payment of expense ${existing.expenseNumber}`,
          referenceType: 'Expense',
          referenceId: existing.id,
          moduleName: 'expenses',
          userId,
          lines: [
            {
              accountId: expenseLedgerAccountId,
              description: `Expense: ${existing.description}`,
              debit: Number(existing.amount),
              credit: 0,
            },
            {
              accountId: cashLedgerAccountId,
              description: `Cash payment from ${cashAccount.accountName}`,
              debit: 0,
              credit: Number(existing.amount),
            },
          ],
        },
        tx,
      );

      await tx.cashAccount.update({
        where: { id: cashAccount.id },
        data: {
          currentBalance: {
            decrement: existing.amount,
          },
        },
      });

      return tx.expense.update({
        where: { id },
        data: {
          status: 'PAID',
          paidById: userId,
          paidAt: new Date(),
          journalEntryId: je.id,
          cashAccountId: cashAccount.id,
          ...(dto.paymentMethod?.trim() && { paymentMethod: dto.paymentMethod.trim() }),
        },
      });
    });

    await this.auditLogs.log({
      action: 'EXPENSE_PAY',
      entityType: 'Expense',
      entityId: id,
      userId,
      companyId: result.companyId,
      oldValue: { status: 'APPROVED' } as any,
      newValue: {
        status: 'PAID',
        cashAccountId,
        paymentMethod: dto.paymentMethod?.trim() || existing.paymentMethod,
      } as any,
      severity: AuditSeverity.HIGH,
    });

    return result;
  }

  async remove(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT expenses can be deleted');
    }

    await this.prisma.expense.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'EXPENSE_DELETE',
      entityType: 'Expense',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as any,
    });

    return { success: true };
  }
}
