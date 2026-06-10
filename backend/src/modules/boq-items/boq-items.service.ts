import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateBOQItemDto } from './dto/create-boq-item.dto';
import { UpdateBOQItemDto } from './dto/update-boq-item.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class BOQItemsService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  private async nextCode(tx: Prisma.TransactionClient, projectId: string) {
    const count = await tx.bOQItem.count({ where: { projectId } });
    return `BOQ-${String(count + 1).padStart(5, '0')}`;
  }

  async create(dto: CreateBOQItemDto, userId: string) {
    const totalAmount = dto.quantity * dto.unitRate;
    // Generate the per-project BOQ code and create the row atomically so two
    // concurrent creates cannot derive the same count()+1 number. Retry once on
    // a unique-constraint clash (@@unique([projectId, boqCode])).
    let item: Awaited<ReturnType<typeof this.prisma.bOQItem.create>> | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        item = await this.prisma.$transaction(async (tx) => {
          const boqCode = await this.nextCode(tx, dto.projectId);
          return tx.bOQItem.create({ data: { ...dto, boqCode, totalAmount } });
        });
        break;
      } catch (err) {
        if (
          attempt === 0 &&
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          continue;
        }
        throw err;
      }
    }
    if (!item) throw new Error('Failed to allocate BOQ item code');
    await this.audit.log({ userId, action: 'CREATE', entityType: 'BOQItem', entityId: item.id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async findAll(projectId?: string, companyId?: string, page = 1, limit = 50, user?: any) {
    const where: any = { deletedAt: null };
    if (projectId) where.projectId = projectId;
    applyCompanyScopeWhere(where, user, companyId);
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
