import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CreateLaborRecordDto } from './dto/create-labor-record.dto';
import { UpdateLaborRecordDto } from './dto/update-labor-record.dto';
import { LaborPaymentStatus } from '@prisma/client';

@Injectable()
export class LaborRecordsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogsService,
    private codes: EntityCodeGeneratorService,
  ) {}

  async create(dto: CreateLaborRecordDto, userId: string) {
    const laborRecordNumber = await this.codes.next({ entityType: 'LaborRecord', companyId: dto.companyId });
    const record = await this.prisma.laborRecord.create({
      data: { ...dto, laborRecordNumber, laborDate: new Date(dto.laborDate), createdById: userId },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'LaborRecord', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async findAll(companyId?: string, divisionId?: string, paymentStatus?: LaborPaymentStatus, page = 1, limit = 20) {
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
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
