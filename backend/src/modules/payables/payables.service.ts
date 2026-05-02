import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreatePayableDto } from './dto/create-payable.dto';
import { UpdatePayableDto } from './dto/update-payable.dto';
import { QueryPayableDto } from './dto/query-payable.dto';
import { RecordPayablePaymentDto } from './dto/record-payable-payment.dto';
import { WriteOffPayableDto } from './dto/write-off-payable.dto';

function generatePayableNumber(): string {
  return `AP-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;
}

@Injectable()
export class PayablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryPayableDto, user: AuthUser) {
    const { page = 1, limit = 20, companyId, status, supplierId, dateFrom, dateTo } = query;
    const skip = (page - 1) * limit;

    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Prisma.PayableWhereInput = { deletedAt: null };
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else if (accessibleIds !== null) {
      where.companyId = { in: accessibleIds };
    }
    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    if (dateFrom || dateTo) {
      where.issueDate = {};
      if (dateFrom) where.issueDate.gte = new Date(dateFrom);
      if (dateTo) where.issueDate.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.payable.findMany({
        where,
        include: { company: { select: { id: true, name: true, code: true } } },
        orderBy: { issueDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.payable.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user?: AuthUser) {
    const record = await this.prisma.payable.findFirst({
      where: { id, deletedAt: null },
      include: { company: { select: { id: true, name: true, code: true } } },
    });
    if (!record) throw new NotFoundException('Payable not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId);
    }
    return record;
  }

  async create(dto: CreatePayableDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const userId = user.id;
    const record = await this.prisma.payable.create({
      data: {
        payableNumber: generatePayableNumber(),
        companyId: dto.companyId,
        supplierId: dto.supplierId,
        supplierName: dto.supplierName,
        sourceType: dto.sourceType,
        sourceId: dto.sourceId,
        amount: dto.amount,
        paidAmount: 0,
        outstandingAmount: dto.amount,
        currency: dto.currency,
        issueDate: new Date(dto.issueDate),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        status: 'OPEN',
        notes: dto.notes,
      },
    });

    await this.auditLogs.log({
      action: 'PAYABLE_CREATE',
      entityType: 'Payable',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });

    return record;
  }

  async update(id: string, dto: UpdatePayableDto, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
    const userId = user.id;
    const record = await this.prisma.payable.update({
      where: { id },
      data: {
        ...(dto.supplierName && { supplierName: dto.supplierName }),
        ...(dto.supplierId !== undefined && { supplierId: dto.supplierId }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.dueDate && { dueDate: new Date(dto.dueDate) }),
        ...(dto.issueDate && { issueDate: new Date(dto.issueDate) }),
      },
    });

    await this.auditLogs.log({
      action: 'PAYABLE_UPDATE',
      entityType: 'Payable',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }

  async recordPayment(id: string, dto: RecordPayablePaymentDto, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
    const userId = user.id;
    const outstanding = Number(existing.outstandingAmount);

    if (dto.amount > outstanding) {
      throw new BadRequestException(
        `Payment amount (${dto.amount}) exceeds outstanding amount (${outstanding})`,
      );
    }

    const newOutstanding = Math.round((outstanding - dto.amount) * 100) / 100;
    const newPaid = Math.round((Number(existing.paidAmount) + dto.amount) * 100) / 100;
    const newStatus = newOutstanding === 0 ? 'PAID' : 'PARTIALLY_PAID';

    const record = await this.prisma.payable.update({
      where: { id },
      data: {
        outstandingAmount: newOutstanding,
        paidAmount: newPaid,
        status: newStatus,
      },
    });

    await this.auditLogs.log({
      action: 'PAYABLE_PAYMENT',
      entityType: 'Payable',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { outstandingAmount: outstanding, status: existing.status } as any,
      newValue: { outstandingAmount: newOutstanding, paidAmount: newPaid, status: newStatus } as any,
    });

    return record;
  }

  async writeOff(id: string, dto: WriteOffPayableDto, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    const userId = user.id;
    const record = await this.prisma.payable.update({
      where: { id },
      data: { status: 'WRITTEN_OFF', notes: dto.reason },
    });

    await this.auditLogs.log({
      action: 'PAYABLE_WRITE_OFF',
      entityType: 'Payable',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: existing.status } as any,
      newValue: { status: 'WRITTEN_OFF', reason: dto.reason } as any,
    });

    return record;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    const userId = user.id;
    await this.prisma.payable.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'PAYABLE_DELETE',
      entityType: 'Payable',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as any,
    });

    return { success: true };
  }
}
