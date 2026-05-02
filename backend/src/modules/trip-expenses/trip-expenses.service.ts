import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateTripExpenseDto } from './dto/create-trip-expense.dto';
import { UpdateTripExpenseDto } from './dto/update-trip-expense.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class TripExpensesService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  private async nextNumber(companyId: string) {
    const year = new Date().getFullYear();
    const count = await this.prisma.tripExpense.count({ where: { companyId } });
    return `TEXP-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  async create(dto: CreateTripExpenseDto, userId: string) {
    const tripExpenseNumber = await this.nextNumber(dto.companyId);
    const expense = await this.prisma.tripExpense.create({
      data: { ...dto, tripExpenseNumber, expenseDate: new Date(dto.expenseDate), createdById: userId },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'TripExpense', entityId: expense.id, newValue: dto as unknown as Record<string, unknown> });
    return expense;
  }

  async findByTrip(tripId: string) {
    return this.prisma.tripExpense.findMany({ where: { tripId, deletedAt: null }, orderBy: { expenseDate: 'desc' } });
  }

  async findAll(companyId?: string, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.tripExpense.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { expenseDate: 'desc' } }),
      this.prisma.tripExpense.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const e = await this.prisma.tripExpense.findFirst({ where: { id, deletedAt: null } });
    if (!e) throw new NotFoundException('Trip expense not found');
    return e;
  }

  async update(id: string, dto: UpdateTripExpenseDto, userId: string) {
    await this.findOne(id);
    const expense = await this.prisma.tripExpense.update({ where: { id }, data: { ...dto, expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : undefined } });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'TripExpense', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return expense;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.tripExpense.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'TripExpense', entityId: id, newValue: {} });
    return { message: 'Trip expense deleted' };
  }
}
