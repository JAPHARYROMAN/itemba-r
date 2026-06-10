import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CreateLaborRecordDto } from './dto/create-labor-record.dto';
import { UpdateLaborRecordDto } from './dto/update-labor-record.dto';
import { AccessLevel, LaborPaymentStatus } from '@prisma/client';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class LaborRecordsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogsService,
    private codes: EntityCodeGeneratorService,
    private companyScope: CompanyScopeService,
  ) {}

  async create(dto: CreateLaborRecordDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    // Reject negative/unbounded money/quantity inputs (defence in depth on top
    // of DTO @Min validation).
    if (dto.totalAmount < 0) throw new BadRequestException('totalAmount must be >= 0');
    if (dto.hoursWorked !== undefined && dto.hoursWorked < 0) {
      throw new BadRequestException('hoursWorked must be >= 0');
    }
    if (dto.dayRate !== undefined && dto.dayRate < 0) {
      throw new BadRequestException('dayRate must be >= 0');
    }
    const laborRecordNumber = await this.codes.next({ entityType: 'LaborRecord', companyId: dto.companyId });
    // Do not trust a client-supplied paymentStatus on create: strip it so the
    // record starts at the schema default. Payment must be recorded via a
    // dedicated flow, not by mass-assignment at creation time.
    const { paymentStatus: _ignoredPaymentStatus, ...createData } = dto;
    void _ignoredPaymentStatus;
    const record = await this.prisma.laborRecord.create({
      data: {
        ...createData,
        laborRecordNumber,
        laborDate: new Date(dto.laborDate),
        createdById: user.id,
      },
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'LaborRecord', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async findAll(companyId?: string, divisionId?: string, paymentStatus?: LaborPaymentStatus, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (divisionId) where.divisionId = divisionId;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.laborRecord.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { laborDate: 'desc' } }),
      this.prisma.laborRecord.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const record = await this.prisma.laborRecord.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Labor record not found');
    return record;
  }

  async update(id: string, dto: UpdateLaborRecordDto, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.laborRecord.update({
      where: { id },
      data: { ...dto, laborDate: dto.laborDate ? new Date(dto.laborDate) : undefined },
    });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'LaborRecord', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.laborRecord.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'LaborRecord', entityId: id, newValue: {} });
    return { message: 'Labor record deleted' };
  }
}
