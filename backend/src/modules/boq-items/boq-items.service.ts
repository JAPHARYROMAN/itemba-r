import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateBOQItemDto } from './dto/create-boq-item.dto';
import { UpdateBOQItemDto } from './dto/update-boq-item.dto';

@Injectable()
export class BOQItemsService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  private async nextCode(projectId: string) {
    const count = await this.prisma.bOQItem.count({ where: { projectId } });
    return `BOQ-${String(count + 1).padStart(5, '0')}`;
  }

  async create(dto: CreateBOQItemDto, userId: string) {
    const boqCode = await this.nextCode(dto.projectId);
    const totalAmount = dto.quantity * dto.unitRate;
    const item = await this.prisma.bOQItem.create({ data: { ...dto, boqCode, totalAmount } });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'BOQItem', entityId: item.id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async findAll(projectId?: string, companyId?: string, page = 1, limit = 50) {
    const where: any = { deletedAt: null };
    if (projectId) where.projectId = projectId;
    if (companyId) where.companyId = companyId;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.bOQItem.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { boqCode: 'asc' }, include: { unit: { select: { symbol: true } } } }),
      this.prisma.bOQItem.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const item = await this.prisma.bOQItem.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('BOQ item not found');
    return item;
  }

  async update(id: string, dto: UpdateBOQItemDto, userId: string) {
    await this.findOne(id);
    const totalAmount = (dto.quantity !== undefined && dto.unitRate !== undefined) ? dto.quantity * dto.unitRate : undefined;
    const item = await this.prisma.bOQItem.update({ where: { id }, data: { ...dto, ...(totalAmount !== undefined ? { totalAmount } : {}) } });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'BOQItem', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.bOQItem.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'BOQItem', entityId: id, newValue: {} });
    return { message: 'BOQ item deleted' };
  }
}
