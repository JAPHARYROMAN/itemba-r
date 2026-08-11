import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  AccessLevel,
  CurrencyCode,
  Prisma,
  RecordBookPaymentMethod,
  RecordBookReceiptType,
  RecordBookStatus,
} from '@prisma/client';
import { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import {
  CreateDailySaleDto,
  CreateRecordBookCategoryDto,
  CreateRecordBookExpenseDto,
  ExportRecordBookDto,
  QueryRecordBookDto,
  RecordBookReceiptDto,
  UpdateDailySaleDto,
  UpdateRecordBookCategoryDto,
  UpdateRecordBookExpenseDto,
  VoidRecordBookDto,
} from './dto/record-book.dto';

const EPSILON = 0.005;
const EXPORT_LIMIT = 50_000;

function toNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function dayStart(value: string | Date) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayEnd(value: string | Date) {
  const d = dayStart(value);
  d.setHours(23, 59, 59, 999);
  return d;
}

function csvEscape(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return '';
  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((c) => csvEscape(row[c])).join(',')),
  ].join('\n');
}

function safeFileStem(value: string) {
  return (
    value
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'record-book'
  );
}

@Injectable()
export class RecordBookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async summary(query: QueryRecordBookDto, user: AuthUser) {
    const saleWhere = await this.dailySaleWhere(query, user, { excludeVoidedByDefault: true });
    const expenseWhere = await this.expenseWhere(query, user, { excludeVoidedByDefault: true });

    const [sales, expenses, draftSales, draftExpenses] = await Promise.all([
      this.prisma.recordBookDailySale.findMany({
        where: saleWhere,
        include: { receipts: true },
      }),
      this.prisma.recordBookExpense.findMany({ where: expenseWhere }),
      this.prisma.recordBookDailySale.count({
        where: { ...saleWhere, status: RecordBookStatus.DRAFT },
      }),
      this.prisma.recordBookExpense.count({
        where: { ...expenseWhere, status: RecordBookStatus.DRAFT },
      }),
    ]);

    const receiptTotals: Record<RecordBookReceiptType, number> = {
      CASH: 0,
      MPESA: 0,
      LIPA_NAMBA: 0,
      BANK: 0,
      CARD: 0,
      OTHER: 0,
    };
    let totalSales = 0;
    for (const sale of sales) {
      totalSales += toNumber(sale.totalSalesAmount);
      for (const receipt of sale.receipts) {
        receiptTotals[receipt.receiptType] += toNumber(receipt.amount);
      }
    }

    const totalExpenses = expenses.reduce((sum, row) => sum + toNumber(row.amount), 0);
    return {
      totalRecordedSales: totalSales,
      cashTotal: receiptTotals.CASH,
      mobileMoneyTotal: receiptTotals.MPESA + receiptTotals.LIPA_NAMBA,
      bankTotal: receiptTotals.BANK,
      cardTotal: receiptTotals.CARD,
      otherReceiptTotal: receiptTotals.OTHER,
      expensesTotal: totalExpenses,
      netMovement: totalSales - totalExpenses,
      draftRecords: draftSales + draftExpenses,
      receiptTotals,
      salesCount: sales.length,
      expenseCount: expenses.length,
    };
  }

  async findDailySales(query: QueryRecordBookDto, user: AuthUser) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    const where = await this.dailySaleWhere(query, user);
    const [data, total] = await Promise.all([
      this.prisma.recordBookDailySale.findMany({
        where,
        include: this.dailySaleInclude(),
        orderBy: [{ recordDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.recordBookDailySale.count({ where }),
    ]);
    return {
      data: data.map((row) => this.serializeDailySale(row)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findDailySale(id: string, user: AuthUser) {
    const record = await this.getDailySale(id, user, AccessLevel.READ);
    await this.auditLogs.log({
      action: 'RECORD_BOOK_DAILY_SALE_VIEW',
      entityType: 'RecordBookDailySale',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId,
    });
    return this.serializeDailySale(record);
  }

  async createDailySale(dto: CreateDailySaleDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.assertOrgScope(dto.companyId, dto.divisionId, dto.branchId);
    this.assertReceiptSplit(dto.totalSalesAmount, dto.receipts);

    const recordDate = dayStart(dto.recordDate);
    await this.assertNoDuplicateDailySale({
      companyId: dto.companyId,
      branchId: dto.branchId,
      recordDate,
      currency: dto.currency ?? CurrencyCode.TZS,
    });

    const record = await this.prisma.$transaction(async (tx) => {
      const sale = await tx.recordBookDailySale.create({
        data: {
          companyId: dto.companyId,
          divisionId: dto.divisionId || null,
          branchId: dto.branchId || null,
          recordDate,
          currency: dto.currency ?? CurrencyCode.TZS,
          totalSalesAmount: dto.totalSalesAmount,
          notes: dto.notes,
          createdById: user.id,
          receipts: {
            create: dto.receipts.map((receipt) => this.receiptData(receipt)),
          },
        },
        include: this.dailySaleInclude(),
      });
      return sale;
    });

    await this.auditLogs.log({
      action: 'RECORD_BOOK_DAILY_SALE_CREATE',
      entityType: 'RecordBookDailySale',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId,
      newValue: record as any,
    });

    return this.serializeDailySale(record);
  }

  async updateDailySale(id: string, dto: UpdateDailySaleDto, user: AuthUser) {
    const existing = await this.getDailySale(id, user, AccessLevel.WRITE);
    this.assertEditable(existing.status);
    const nextCompanyId = existing.companyId;
    const nextDivisionId =
      dto.divisionId !== undefined ? dto.divisionId || null : existing.divisionId;
    const nextBranchId = dto.branchId !== undefined ? dto.branchId || null : existing.branchId;
    const nextCurrency = dto.currency ?? existing.currency;
    const nextRecordDate = dto.recordDate ? dayStart(dto.recordDate) : existing.recordDate;
    const nextTotal = dto.totalSalesAmount ?? toNumber(existing.totalSalesAmount);
    const nextReceipts =
      dto.receipts ??
      existing.receipts.map((receipt) => ({
        receiptType: receipt.receiptType,
        label: receipt.label ?? undefined,
        amount: toNumber(receipt.amount),
        reference: receipt.reference ?? undefined,
        notes: receipt.notes ?? undefined,
      }));

    await this.assertOrgScope(
      nextCompanyId,
      nextDivisionId ?? undefined,
      nextBranchId ?? undefined,
    );
    this.assertReceiptSplit(nextTotal, nextReceipts);
    await this.assertNoDuplicateDailySale({
      companyId: nextCompanyId,
      branchId: nextBranchId ?? undefined,
      recordDate: nextRecordDate,
      currency: nextCurrency,
      ignoreId: id,
    });

    const record = await this.prisma.$transaction(async (tx) => {
      await tx.recordBookSaleReceipt.deleteMany({ where: { dailySaleId: id } });
      return tx.recordBookDailySale.update({
        where: { id },
        data: {
          ...(dto.divisionId !== undefined && { divisionId: nextDivisionId }),
          ...(dto.branchId !== undefined && { branchId: nextBranchId }),
          ...(dto.recordDate && { recordDate: nextRecordDate }),
          ...(dto.currency && { currency: dto.currency }),
          ...(dto.totalSalesAmount !== undefined && { totalSalesAmount: dto.totalSalesAmount }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          updatedById: user.id,
          receipts: { create: nextReceipts.map((receipt) => this.receiptData(receipt)) },
        },
        include: this.dailySaleInclude(),
      });
    });

    await this.auditLogs.log({
      action: 'RECORD_BOOK_DAILY_SALE_UPDATE',
      entityType: 'RecordBookDailySale',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return this.serializeDailySale(record);
  }

  async removeDailySale(id: string, user: AuthUser) {
    const existing = await this.getDailySale(id, user, AccessLevel.WRITE);
    if (existing.status !== RecordBookStatus.DRAFT) {
      throw new BadRequestException('Only draft daily sales can be deleted');
    }
    await this.prisma.recordBookDailySale.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: user.id },
    });
    await this.auditLogs.log({
      action: 'RECORD_BOOK_DAILY_SALE_DELETE',
      entityType: 'RecordBookDailySale',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      oldValue: existing as any,
      severity: 'HIGH' as any,
    });
    return { success: true };
  }

  async restoreDailySale(id: string, user: AuthUser) {
    const existing = await this.getDailySale(id, user, AccessLevel.WRITE, true);
    if (existing.status !== RecordBookStatus.DRAFT) {
      throw new BadRequestException('Only deleted draft daily sales can be restored');
    }
    await this.assertNoDuplicateDailySale({
      companyId: existing.companyId,
      branchId: existing.branchId,
      recordDate: existing.recordDate,
      currency: existing.currency,
      ignoreId: existing.id,
    });
    const record = await this.prisma.recordBookDailySale.update({
      where: { id },
      data: { deletedAt: null, updatedById: user.id },
      include: this.dailySaleInclude(),
    });
    await this.auditLogs.log({
      action: 'RECORD_BOOK_DAILY_SALE_RESTORE',
      entityType: 'RecordBookDailySale',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      newValue: record as any,
      severity: 'HIGH' as any,
    });
    return this.serializeDailySale(record);
  }

  async finalizeDailySale(id: string, user: AuthUser) {
    const existing = await this.getDailySale(id, user, AccessLevel.WRITE);
    if (existing.status !== RecordBookStatus.DRAFT) {
      throw new BadRequestException('Only draft daily sales can be finalized');
    }
    const record = await this.prisma.recordBookDailySale.update({
      where: { id },
      data: { status: RecordBookStatus.FINALIZED, finalizedById: user.id, finalizedAt: new Date() },
      include: this.dailySaleInclude(),
    });
    await this.auditLogs.log({
      action: 'RECORD_BOOK_DAILY_SALE_FINALIZE',
      entityType: 'RecordBookDailySale',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: { status: existing.status } as any,
      newValue: { status: record.status } as any,
    });
    return this.serializeDailySale(record);
  }

  async reopenDailySale(id: string, user: AuthUser) {
    const existing = await this.getDailySale(id, user, AccessLevel.WRITE);
    if (existing.status !== RecordBookStatus.FINALIZED) {
      throw new BadRequestException('Only finalized daily sales can be reopened');
    }
    const record = await this.prisma.recordBookDailySale.update({
      where: { id },
      data: {
        status: RecordBookStatus.DRAFT,
        finalizedById: null,
        finalizedAt: null,
        updatedById: user.id,
      },
      include: this.dailySaleInclude(),
    });
    await this.auditLogs.log({
      action: 'RECORD_BOOK_DAILY_SALE_REOPEN',
      entityType: 'RecordBookDailySale',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: { status: existing.status } as any,
      newValue: { status: record.status } as any,
    });
    return this.serializeDailySale(record);
  }

  async voidDailySale(id: string, dto: VoidRecordBookDto, user: AuthUser) {
    const existing = await this.getDailySale(id, user, AccessLevel.WRITE);
    if (existing.status === RecordBookStatus.VOIDED) {
      throw new BadRequestException('Record is already voided');
    }
    const record = await this.prisma.recordBookDailySale.update({
      where: { id },
      data: {
        status: RecordBookStatus.VOIDED,
        voidedById: user.id,
        voidedAt: new Date(),
        voidReason: dto.reason,
      },
      include: this.dailySaleInclude(),
    });
    await this.auditLogs.log({
      action: 'RECORD_BOOK_DAILY_SALE_VOID',
      entityType: 'RecordBookDailySale',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: { status: existing.status } as any,
      newValue: { status: record.status, reason: dto.reason } as any,
      severity: 'HIGH' as any,
    });
    return this.serializeDailySale(record);
  }

  async findExpenses(query: QueryRecordBookDto, user: AuthUser) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    const where = await this.expenseWhere(query, user);
    const [data, total] = await Promise.all([
      this.prisma.recordBookExpense.findMany({
        where,
        include: this.expenseInclude(),
        orderBy: [{ recordDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.recordBookExpense.count({ where }),
    ]);
    return {
      data: data.map((row) => this.serializeExpense(row)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findExpense(id: string, user: AuthUser) {
    const record = await this.getExpense(id, user, AccessLevel.READ);
    await this.auditLogs.log({
      action: 'RECORD_BOOK_EXPENSE_VIEW',
      entityType: 'RecordBookExpense',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId,
    });
    return this.serializeExpense(record);
  }

  async createExpense(dto: CreateRecordBookExpenseDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.assertOrgScope(dto.companyId, dto.divisionId, dto.branchId);
    await this.assertCategory(dto.companyId, dto.expenseCategoryId);

    const record = await this.prisma.recordBookExpense.create({
      data: {
        companyId: dto.companyId,
        divisionId: dto.divisionId || null,
        branchId: dto.branchId || null,
        expenseCategoryId: dto.expenseCategoryId,
        recordDate: dayStart(dto.recordDate),
        currency: dto.currency ?? CurrencyCode.TZS,
        amount: dto.amount,
        description: dto.description,
        paidTo: dto.paidTo,
        paymentMethod: dto.paymentMethod ?? RecordBookPaymentMethod.CASH,
        paymentLabel: dto.paymentLabel,
        reference: dto.reference,
        notes: dto.notes,
        createdById: user.id,
      },
      include: this.expenseInclude(),
    });

    await this.auditLogs.log({
      action: 'RECORD_BOOK_EXPENSE_CREATE',
      entityType: 'RecordBookExpense',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId,
      newValue: record as any,
    });

    return this.serializeExpense(record);
  }

  async updateExpense(id: string, dto: UpdateRecordBookExpenseDto, user: AuthUser) {
    const existing = await this.getExpense(id, user, AccessLevel.WRITE);
    this.assertEditable(existing.status);
    const nextDivisionId =
      dto.divisionId !== undefined ? dto.divisionId || null : existing.divisionId;
    const nextBranchId = dto.branchId !== undefined ? dto.branchId || null : existing.branchId;
    const nextCategoryId = dto.expenseCategoryId ?? existing.expenseCategoryId;

    await this.assertOrgScope(
      existing.companyId,
      nextDivisionId ?? undefined,
      nextBranchId ?? undefined,
    );
    await this.assertCategory(existing.companyId, nextCategoryId);

    const record = await this.prisma.recordBookExpense.update({
      where: { id },
      data: {
        ...(dto.divisionId !== undefined && { divisionId: nextDivisionId }),
        ...(dto.branchId !== undefined && { branchId: nextBranchId }),
        ...(dto.expenseCategoryId && { expenseCategoryId: dto.expenseCategoryId }),
        ...(dto.recordDate && { recordDate: dayStart(dto.recordDate) }),
        ...(dto.currency && { currency: dto.currency }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.paidTo !== undefined && { paidTo: dto.paidTo }),
        ...(dto.paymentMethod && { paymentMethod: dto.paymentMethod }),
        ...(dto.paymentLabel !== undefined && { paymentLabel: dto.paymentLabel }),
        ...(dto.reference !== undefined && { reference: dto.reference }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        updatedById: user.id,
      },
      include: this.expenseInclude(),
    });

    await this.auditLogs.log({
      action: 'RECORD_BOOK_EXPENSE_UPDATE',
      entityType: 'RecordBookExpense',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return this.serializeExpense(record);
  }

  async removeExpense(id: string, user: AuthUser) {
    const existing = await this.getExpense(id, user, AccessLevel.WRITE);
    if (existing.status !== RecordBookStatus.DRAFT) {
      throw new BadRequestException('Only draft money-out records can be deleted');
    }
    await this.prisma.recordBookExpense.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: user.id },
    });
    await this.auditLogs.log({
      action: 'RECORD_BOOK_EXPENSE_DELETE',
      entityType: 'RecordBookExpense',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      oldValue: existing as any,
      severity: 'HIGH' as any,
    });
    return { success: true };
  }

  async restoreExpense(id: string, user: AuthUser) {
    const existing = await this.getExpense(id, user, AccessLevel.WRITE, true);
    const record = await this.prisma.recordBookExpense.update({
      where: { id },
      data: { deletedAt: null, updatedById: user.id },
      include: this.expenseInclude(),
    });
    await this.auditLogs.log({
      action: 'RECORD_BOOK_EXPENSE_RESTORE',
      entityType: 'RecordBookExpense',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      newValue: record as any,
      severity: 'HIGH' as any,
    });
    return this.serializeExpense(record);
  }

  async finalizeExpense(id: string, user: AuthUser) {
    const existing = await this.getExpense(id, user, AccessLevel.WRITE);
    if (existing.status !== RecordBookStatus.DRAFT) {
      throw new BadRequestException('Only draft expenses can be finalized');
    }
    const record = await this.prisma.recordBookExpense.update({
      where: { id },
      data: { status: RecordBookStatus.FINALIZED, finalizedById: user.id, finalizedAt: new Date() },
      include: this.expenseInclude(),
    });
    await this.auditLogs.log({
      action: 'RECORD_BOOK_EXPENSE_FINALIZE',
      entityType: 'RecordBookExpense',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: { status: existing.status } as any,
      newValue: { status: record.status } as any,
    });
    return this.serializeExpense(record);
  }

  async reopenExpense(id: string, user: AuthUser) {
    const existing = await this.getExpense(id, user, AccessLevel.WRITE);
    if (existing.status !== RecordBookStatus.FINALIZED) {
      throw new BadRequestException('Only finalized expenses can be reopened');
    }
    const record = await this.prisma.recordBookExpense.update({
      where: { id },
      data: {
        status: RecordBookStatus.DRAFT,
        finalizedById: null,
        finalizedAt: null,
        updatedById: user.id,
      },
      include: this.expenseInclude(),
    });
    await this.auditLogs.log({
      action: 'RECORD_BOOK_EXPENSE_REOPEN',
      entityType: 'RecordBookExpense',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: { status: existing.status } as any,
      newValue: { status: record.status } as any,
    });
    return this.serializeExpense(record);
  }

  async voidExpense(id: string, dto: VoidRecordBookDto, user: AuthUser) {
    const existing = await this.getExpense(id, user, AccessLevel.WRITE);
    if (existing.status === RecordBookStatus.VOIDED) {
      throw new BadRequestException('Record is already voided');
    }
    const record = await this.prisma.recordBookExpense.update({
      where: { id },
      data: {
        status: RecordBookStatus.VOIDED,
        voidedById: user.id,
        voidedAt: new Date(),
        voidReason: dto.reason,
      },
      include: this.expenseInclude(),
    });
    await this.auditLogs.log({
      action: 'RECORD_BOOK_EXPENSE_VOID',
      entityType: 'RecordBookExpense',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: { status: existing.status } as any,
      newValue: { status: record.status, reason: dto.reason } as any,
      severity: 'HIGH' as any,
    });
    return this.serializeExpense(record);
  }

  async findCategories(query: QueryRecordBookDto, user: AuthUser) {
    const { page = 1, limit = 100, companyId, search } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.RecordBookExpenseCategoryWhereInput = {
      deletedAt: query.recordState === 'DELETED' ? { not: null } : null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (search) {
      where.OR = [{ name: { contains: search, mode: 'insensitive' } }];
    }
    const [data, total] = await Promise.all([
      this.prisma.recordBookExpenseCategory.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          _count: { select: { expenses: true } },
        },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.recordBookExpenseCategory.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findCategory(id: string, user: AuthUser) {
    const record = await this.getCategory(id, user, AccessLevel.READ);
    await this.auditLogs.log({
      action: 'RECORD_BOOK_CATEGORY_VIEW',
      entityType: 'RecordBookExpenseCategory',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId,
    });
    return record;
  }

  async createCategory(dto: CreateRecordBookCategoryDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    try {
      const record = await this.prisma.recordBookExpenseCategory.create({
        data: {
          companyId: dto.companyId,
          name: dto.name.trim(),
          description: dto.description,
          isActive: dto.isActive ?? true,
        },
      });
      await this.auditLogs.log({
        action: 'RECORD_BOOK_CATEGORY_CREATE',
        entityType: 'RecordBookExpenseCategory',
        entityId: record.id,
        userId: user.id,
        companyId: record.companyId,
        newValue: record as any,
      });
      return record;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException('A Records Book category with this name already exists');
      }
      throw e;
    }
  }

  async updateCategory(id: string, dto: UpdateRecordBookCategoryDto, user: AuthUser) {
    const existing = await this.getCategory(id, user, AccessLevel.WRITE);
    try {
      const record = await this.prisma.recordBookExpenseCategory.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
      await this.auditLogs.log({
        action: 'RECORD_BOOK_CATEGORY_UPDATE',
        entityType: 'RecordBookExpenseCategory',
        entityId: record.id,
        userId: user.id,
        companyId: record.companyId,
        oldValue: existing as any,
        newValue: record as any,
      });
      return record;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException('A Records Book category with this name already exists');
      }
      throw e;
    }
  }

  async removeCategory(id: string, user: AuthUser) {
    const existing = await this.getCategory(id, user, AccessLevel.WRITE);
    const record = await this.prisma.recordBookExpenseCategory.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });
    await this.auditLogs.log({
      action: 'RECORD_BOOK_CATEGORY_DELETE',
      entityType: 'RecordBookExpenseCategory',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: existing as any,
    });
    return { success: true };
  }

  async restoreCategory(id: string, user: AuthUser) {
    const existing = await this.getCategory(id, user, AccessLevel.WRITE, true);
    const record = await this.prisma.recordBookExpenseCategory.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });
    await this.auditLogs.log({
      action: 'RECORD_BOOK_CATEGORY_RESTORE',
      entityType: 'RecordBookExpenseCategory',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
      severity: 'HIGH' as any,
    });
    return record;
  }

  async export(query: ExportRecordBookDto, user: AuthUser, res: Response) {
    const format = query.format ?? 'json';
    const type = query.type ?? 'combined';
    const rows = await this.exportRows(type, query, user);
    const stamp = new Date().toISOString().slice(0, 10);
    const fileStem = safeFileStem(`record-book-${type}-${stamp}`);

    await this.auditLogs.log({
      action: 'RECORD_BOOK_EXPORT',
      entityType: 'RecordBookExport',
      entityId: type,
      userId: user.id,
      companyId: query.companyId,
      newValue: {
        type,
        format,
        rowCount: rows.length,
        filters: {
          companyId: query.companyId,
          divisionId: query.divisionId,
          branchId: query.branchId,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          status: query.status,
          currency: query.currency,
        },
      } as any,
      severity: 'MEDIUM' as any,
    });

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      return res.json({ success: true, data: { type, rows }, timestamp: new Date().toISOString() });
    }

    if (format === 'csv') {
      const csv = rowsToCsv(rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileStem}.csv"`);
      return res.send(csv);
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ITEMBA-R';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(type === 'combined' ? 'Records Book' : type);
    const columns = rows.length
      ? Array.from(
          rows.reduce((set, row) => {
            Object.keys(row).forEach((key) => set.add(key));
            return set;
          }, new Set<string>()),
        )
      : ['message'];
    sheet.columns = columns.map((key) => ({
      header: key,
      key,
      width: Math.min(Math.max(key.length + 4, 14), 34),
    }));
    if (rows.length) {
      sheet.addRows(rows);
    } else {
      sheet.addRow({ message: 'No records found' });
    }
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileStem}.xlsx"`);
    return res.send(Buffer.from(buffer));
  }

  private async exportRows(
    type: 'sales' | 'expenses' | 'combined',
    query: QueryRecordBookDto,
    user: AuthUser,
  ) {
    if (type === 'sales') return this.salesExportRows(query, user);
    if (type === 'expenses') return this.expenseExportRows(query, user);
    const [sales, expenses] = await Promise.all([
      this.salesExportRows(query, user),
      this.expenseExportRows(query, user),
    ]);
    const rows = [
      ...sales.map((row) => ({
        recordType: 'SALE_RECEIPT',
        ...row,
        moneyIn: row.receiptAmount,
        moneyOut: '',
      })),
      ...expenses.map((row) => ({
        recordType: 'EXPENSE',
        ...row,
        moneyIn: '',
        moneyOut: row.amount,
      })),
    ].sort((a, b) => String(b.recordDate).localeCompare(String(a.recordDate)));
    if (rows.length > EXPORT_LIMIT) this.throwExportLimit();
    return rows;
  }

  private async salesExportRows(query: QueryRecordBookDto, user: AuthUser) {
    const where = await this.dailySaleWhere(query, user, { excludeVoidedByDefault: true });
    const rows = await this.prisma.recordBookDailySale.findMany({
      where,
      include: this.dailySaleInclude(),
      orderBy: [{ recordDate: 'desc' }, { createdAt: 'desc' }],
      take: EXPORT_LIMIT + 1,
    });
    const exportRows = rows.flatMap((sale) =>
      sale.receipts.map((receipt) => ({
        recordDate: sale.recordDate.toISOString().slice(0, 10),
        company: sale.company.name,
        division: sale.division?.name ?? '',
        branch: sale.branch?.name ?? '',
        currency: sale.currency,
        status: sale.status,
        totalSalesAmount: toNumber(sale.totalSalesAmount),
        receiptType: receipt.receiptType,
        receiptLabel: receipt.label ?? '',
        receiptAmount: toNumber(receipt.amount),
        reference: receipt.reference ?? '',
        notes: receipt.notes ?? sale.notes ?? '',
      })),
    );
    if (exportRows.length > EXPORT_LIMIT) this.throwExportLimit();
    return exportRows;
  }

  private async expenseExportRows(query: QueryRecordBookDto, user: AuthUser) {
    const where = await this.expenseWhere(query, user, { excludeVoidedByDefault: true });
    const rows = await this.prisma.recordBookExpense.findMany({
      where,
      include: this.expenseInclude(),
      orderBy: [{ recordDate: 'desc' }, { createdAt: 'desc' }],
      take: EXPORT_LIMIT + 1,
    });
    if (rows.length > EXPORT_LIMIT) this.throwExportLimit();
    return rows.map((expense) => ({
      recordDate: expense.recordDate.toISOString().slice(0, 10),
      company: expense.company.name,
      division: expense.division?.name ?? '',
      branch: expense.branch?.name ?? '',
      category: expense.expenseCategory.name,
      description: expense.description,
      paidTo: expense.paidTo ?? '',
      currency: expense.currency,
      amount: toNumber(expense.amount),
      paymentMethod: expense.paymentMethod,
      paymentLabel: expense.paymentLabel ?? '',
      reference: expense.reference ?? '',
      status: expense.status,
      notes: expense.notes ?? '',
    }));
  }

  private async dailySaleWhere(
    query: QueryRecordBookDto,
    user: AuthUser,
    opts: { excludeVoidedByDefault?: boolean } = {},
  ): Promise<Prisma.RecordBookDailySaleWhereInput> {
    const where: Prisma.RecordBookDailySaleWhereInput = {
      deletedAt: query.recordState === 'DELETED' ? { not: null } : null,
      ...(await this.companyScope.companyWhereFor(user, query.companyId)),
    };
    if (query.divisionId) where.divisionId = query.divisionId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.currency) where.currency = query.currency;
    if (query.status) where.status = query.status;
    else if (opts.excludeVoidedByDefault) where.status = { not: RecordBookStatus.VOIDED };
    if (query.dateFrom || query.dateTo) {
      where.recordDate = {};
      if (query.dateFrom) where.recordDate.gte = dateRangeStart(query.dateFrom);
      if (query.dateTo) where.recordDate.lte = dateRangeEnd(query.dateTo);
    }
    if (query.receiptType) where.receipts = { some: { receiptType: query.receiptType } };
    if (query.search) {
      where.OR = [
        { notes: { contains: query.search, mode: 'insensitive' } },
        { receipts: { some: { label: { contains: query.search, mode: 'insensitive' } } } },
        { receipts: { some: { reference: { contains: query.search, mode: 'insensitive' } } } },
      ];
    }
    return where;
  }

  private async expenseWhere(
    query: QueryRecordBookDto,
    user: AuthUser,
    opts: { excludeVoidedByDefault?: boolean } = {},
  ): Promise<Prisma.RecordBookExpenseWhereInput> {
    const where: Prisma.RecordBookExpenseWhereInput = {
      deletedAt: query.recordState === 'DELETED' ? { not: null } : null,
      ...(await this.companyScope.companyWhereFor(user, query.companyId)),
    };
    if (query.divisionId) where.divisionId = query.divisionId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.expenseCategoryId) where.expenseCategoryId = query.expenseCategoryId;
    if (query.currency) where.currency = query.currency;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
    if (query.status) where.status = query.status;
    else if (opts.excludeVoidedByDefault) where.status = { not: RecordBookStatus.VOIDED };
    if (query.dateFrom || query.dateTo) {
      where.recordDate = {};
      if (query.dateFrom) where.recordDate.gte = dateRangeStart(query.dateFrom);
      if (query.dateTo) where.recordDate.lte = dateRangeEnd(query.dateTo);
    }
    if (query.search) {
      where.OR = [
        { description: { contains: query.search, mode: 'insensitive' } },
        { paidTo: { contains: query.search, mode: 'insensitive' } },
        { paymentLabel: { contains: query.search, mode: 'insensitive' } },
        { reference: { contains: query.search, mode: 'insensitive' } },
        { notes: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private dailySaleInclude() {
    return {
      company: { select: { id: true, name: true, code: true } },
      division: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, name: true, code: true } },
      createdBy: { select: { id: true, fullName: true, email: true } },
      updatedBy: { select: { id: true, fullName: true, email: true } },
      finalizedBy: { select: { id: true, fullName: true, email: true } },
      voidedBy: { select: { id: true, fullName: true, email: true } },
      receipts: { orderBy: { receiptType: 'asc' as const } },
    };
  }

  private expenseInclude() {
    return {
      company: { select: { id: true, name: true, code: true } },
      division: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, name: true, code: true } },
      expenseCategory: { select: { id: true, name: true } },
      createdBy: { select: { id: true, fullName: true, email: true } },
      updatedBy: { select: { id: true, fullName: true, email: true } },
      finalizedBy: { select: { id: true, fullName: true, email: true } },
      voidedBy: { select: { id: true, fullName: true, email: true } },
    };
  }

  private serializeDailySale(row: any) {
    return {
      ...row,
      totalSalesAmount: toNumber(row.totalSalesAmount),
      receipts: (row.receipts ?? []).map((receipt: any) => ({
        ...receipt,
        amount: toNumber(receipt.amount),
      })),
    };
  }

  private serializeExpense(row: any) {
    return { ...row, amount: toNumber(row.amount) };
  }

  private receiptData(receipt: RecordBookReceiptDto) {
    return {
      receiptType: receipt.receiptType,
      label: receipt.label,
      amount: receipt.amount,
      reference: receipt.reference,
      notes: receipt.notes,
    };
  }

  private assertReceiptSplit(total: number, receipts: Array<RecordBookReceiptDto>) {
    if (!receipts?.length) throw new BadRequestException('At least one receipt split is required');
    const sum = receipts.reduce((acc, receipt) => {
      if (receipt.amount <= 0)
        throw new BadRequestException('Receipt amounts must be greater than zero');
      return acc + Number(receipt.amount);
    }, 0);
    if (Math.abs(sum - Number(total)) > EPSILON) {
      throw new BadRequestException('Receipt split must equal total sales amount');
    }
  }

  private assertEditable(status: RecordBookStatus) {
    if (status !== RecordBookStatus.DRAFT) {
      throw new BadRequestException('Only draft Records Book entries can be edited');
    }
  }

  private throwExportLimit(): never {
    throw new BadRequestException(
      `This export matches more than ${EXPORT_LIMIT.toLocaleString()} rows. Narrow the date or scope filters.`,
    );
  }

  private async assertNoDuplicateDailySale(input: {
    companyId: string;
    branchId?: string | null;
    recordDate: Date;
    currency: CurrencyCode;
    ignoreId?: string;
  }) {
    const duplicate = await this.prisma.recordBookDailySale.findFirst({
      where: {
        companyId: input.companyId,
        branchId: input.branchId || null,
        currency: input.currency,
        recordDate: { gte: dayStart(input.recordDate), lte: dayEnd(input.recordDate) },
        status: { not: RecordBookStatus.VOIDED },
        deletedAt: null,
        ...(input.ignoreId ? { id: { not: input.ignoreId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        'A daily sales summary already exists for this company, branch, date, and currency',
      );
    }
  }

  private async assertOrgScope(
    companyId: string,
    divisionId?: string | null,
    branchId?: string | null,
  ) {
    if (divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: divisionId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!division)
        throw new BadRequestException('Division does not belong to the selected company');
    }
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: {
          id: branchId,
          deletedAt: null,
          division: { companyId },
          ...(divisionId ? { divisionId } : {}),
        },
        select: { id: true },
      });
      if (!branch)
        throw new BadRequestException('Branch does not belong to the selected company/division');
    }
  }

  private async assertCategory(companyId: string, categoryId: string) {
    const category = await this.prisma.recordBookExpenseCategory.findFirst({
      where: { id: categoryId, companyId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!category) {
      throw new BadRequestException('Records Book expense category is invalid or inactive');
    }
  }

  private async getDailySale(id: string, user: AuthUser, minimum: AccessLevel, deleted = false) {
    const record = await this.prisma.recordBookDailySale.findFirst({
      where: { id, deletedAt: deleted ? { not: null } : null },
      include: this.dailySaleInclude(),
    });
    if (!record) throw new NotFoundException('Records Book daily sale not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  private async getExpense(id: string, user: AuthUser, minimum: AccessLevel, deleted = false) {
    const record = await this.prisma.recordBookExpense.findFirst({
      where: { id, deletedAt: deleted ? { not: null } : null },
      include: this.expenseInclude(),
    });
    if (!record) throw new NotFoundException('Records Book expense not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  private async getCategory(id: string, user: AuthUser, minimum: AccessLevel, deleted = false) {
    const record = await this.prisma.recordBookExpenseCategory.findFirst({
      where: { id, deletedAt: deleted ? { not: null } : null },
    });
    if (!record) throw new NotFoundException('Records Book category not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }
}
