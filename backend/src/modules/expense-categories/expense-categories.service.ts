import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto';
import { QueryExpenseCategoryDto } from './dto/query-expense-category.dto';

@Injectable()
export class ExpenseCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: QueryExpenseCategoryDto) {
    const { page = 1, limit = 20, companyId, isActive, search } = query;
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.expenseCategory.findMany({
        where,
        include: { company: { select: { id: true, name: true, code: true } } },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.expenseCategory.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.expenseCategory.findFirst({
      where: { id, deletedAt: null },
      include: { company: { select: { id: true, name: true, code: true } } },
    });
    if (!record) throw new NotFoundException('Expense category not found');
    return record;
  }

  async create(dto: CreateExpenseCategoryDto, userId: string) {
    try {
      const record = await this.prisma.expenseCategory.create({ data: dto });
      await this.auditLogs.log({
        action: 'EXPENSE_CATEGORY_CREATE',
        entityType: 'ExpenseCategory',
        entityId: record.id,
        userId,
        companyId: record.companyId,
        newValue: record as any,
      });
      return record;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException('An expense category with this name already exists for this company');
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateExpenseCategoryDto, userId: string) {
    const existing = await this.findOne(id);
    try {
      const record = await this.prisma.expenseCategory.update({ where: { id }, data: dto });
      await this.auditLogs.log({
        action: 'EXPENSE_CATEGORY_UPDATE',
        entityType: 'ExpenseCategory',
        entityId: id,
        userId,
        companyId: record.companyId,
        oldValue: existing as any,
        newValue: record as any,
      });
      return record;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException('An expense category with this name already exists for this company');
      }
      throw e;
    }
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    await this.prisma.expenseCategory.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({
      action: 'EXPENSE_CATEGORY_DELETE',
      entityType: 'ExpenseCategory',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as any,
    });
    return { success: true };
  }
}
