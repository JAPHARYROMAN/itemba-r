import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateFiscalYearDto } from './dto/create-fiscal-year.dto';
import { UpdateFiscalYearDto } from './dto/update-fiscal-year.dto';
import { QueryFiscalYearDto } from './dto/query-fiscal-year.dto';

@Injectable()
export class FiscalYearsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryFiscalYearDto, user: AuthUser) {
    const { page = 1, limit = 20, companyId, status } = query;
    const skip = (page - 1) * limit;

    const where: any = await this.companyScope.companyWhereFor(user, companyId);
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.fiscalYear.findMany({
        where,
        include: { company: { select: { id: true, name: true, code: true } } },
        orderBy: { startDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.fiscalYear.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.fiscalYear.findFirst({
      where: { id },
      include: {
        company: { select: { id: true, name: true, code: true } },
        periods: { orderBy: { startDate: 'asc' } },
      },
    });
    if (!record) throw new NotFoundException('Fiscal year not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  async create(dto: CreateFiscalYearDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.assertValidRange(dto.companyId, new Date(dto.startDate), new Date(dto.endDate));
    const record = await this.prisma.fiscalYear.create({
      data: {
        companyId: dto.companyId,
        name: dto.name,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        status: dto.status,
      },
    });
    await this.auditLogs.log({
      action: 'FISCAL_YEAR_CREATE',
      entityType: 'FiscalYear',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId,
      newValue: record as any,
    });
    return record;
  }

  async update(id: string, dto: UpdateFiscalYearDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const startDate = dto.startDate ? new Date(dto.startDate) : existing.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : existing.endDate;
    await this.assertValidRange(existing.companyId, startDate, endDate, id);
    const record = await this.prisma.fiscalYear.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.startDate && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate && { endDate: new Date(dto.endDate) }),
        ...(dto.status && { status: dto.status }),
      },
    });
    await this.auditLogs.log({
      action: 'FISCAL_YEAR_UPDATE',
      entityType: 'FiscalYear',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });
    return record;
  }

  async close(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const record = await this.prisma.fiscalYear.update({
      where: { id },
      data: { status: 'CLOSED' },
    });
    await this.auditLogs.log({
      action: 'FISCAL_YEAR_CLOSE',
      entityType: 'FiscalYear',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: { status: existing.status },
      newValue: { status: 'CLOSED' },
    });
    return record;
  }

  async lock(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const record = await this.prisma.fiscalYear.update({
      where: { id },
      data: { status: 'LOCKED' },
    });
    await this.auditLogs.log({
      action: 'FISCAL_YEAR_LOCK',
      entityType: 'FiscalYear',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: { status: existing.status },
      newValue: { status: 'LOCKED' },
    });
    return record;
  }

  private async assertValidRange(
    companyId: string,
    startDate: Date,
    endDate: Date,
    excludeId?: string,
  ) {
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new BadRequestException('Fiscal year dates are invalid');
    }
    if (startDate > endDate) {
      throw new BadRequestException('Fiscal year start date cannot be after end date');
    }

    const overlapping = await this.prisma.fiscalYear.findFirst({
      where: {
        companyId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: [{ startDate: { lte: endDate }, endDate: { gte: startDate } }],
      },
      select: { id: true },
    });
    if (overlapping) {
      throw new BadRequestException('Fiscal year date range overlaps an existing fiscal year');
    }
  }
}
