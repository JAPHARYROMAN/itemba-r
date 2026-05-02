import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateFarmFieldDto } from './dto/create-farm-field.dto';
import { UpdateFarmFieldDto } from './dto/update-farm-field.dto';

@Injectable()
export class FarmFieldsService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateFarmFieldDto, userId: string) {
    const existing = await this.prisma.farmField.findFirst({ where: { farmId: dto.farmId, fieldCode: dto.fieldCode, deletedAt: null } });
    if (existing) throw new BadRequestException('Field code already exists in this farm');
    const field = await this.prisma.farmField.create({ data: dto });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'FarmField', entityId: field.id, newValue: dto as unknown as Record<string, unknown> });
    return field;
  }

  async findAll(farmId?: string, companyId?: string, page = 1, limit = 20) {
    const where: any = { deletedAt: null };
    if (farmId) where.farmId = farmId;
    if (companyId) where.companyId = companyId;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.farmField.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { name: 'asc' }, include: { farm: { select: { name: true, farmCode: true } }, sizeUnit: { select: { symbol: true } } } }),
      this.prisma.farmField.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const field = await this.prisma.farmField.findFirst({ where: { id, deletedAt: null }, include: { farm: { select: { name: true, farmCode: true } } } });
    if (!field) throw new NotFoundException('Farm field not found');
    return field;
  }

  async update(id: string, dto: UpdateFarmFieldDto, userId: string) {
    await this.findOne(id);
    const field = await this.prisma.farmField.update({ where: { id }, data: dto });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'FarmField', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return field;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.farmField.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'FarmField', entityId: id, newValue: {} });
    return { message: 'Farm field deleted' };
  }
}
