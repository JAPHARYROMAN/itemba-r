import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class GoodsReceivedNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: any, user: AuthUser) {
    const { companyId, status, supplierId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    const [items, total] = await Promise.all([
      this.prisma.goodsReceivedNote.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' }, include: { lines: true } }),
      this.prisma.goodsReceivedNote.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.goodsReceivedNote.findFirst({ where: { id, deletedAt: null }, include: { lines: true } });
    if (!item) throw new NotFoundException('GRN not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async create(dto: any, user: AuthUser) {
    if (dto.companyId) {
      await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    }
    const { lines, ...rest } = dto;
    const item = await this.prisma.goodsReceivedNote.create({
      data: { ...rest, status: 'DRAFT', receivedById: user.id, lines: lines ? { create: lines } : undefined },
      include: { lines: true },
    });
    await this.auditLogs.log({ action: 'GOODS_RECEIVED_NOTE_CREATE', entityType: 'GoodsReceivedNote', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async update(id: string, dto: any, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const updated = await this.prisma.goodsReceivedNote.update({ where: { id }, data: dto });
    await this.auditLogs.log({ action: 'GOODS_RECEIVED_NOTE_UPDATE', entityType: 'GoodsReceivedNote', entityId: id, userId: user.id, companyId: existing.companyId, oldValue: existing, newValue: updated });
    return updated;
  }

  async approve(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Only DRAFT GRNs can be approved');
    const updated = await this.prisma.goodsReceivedNote.update({ where: { id }, data: { status: 'APPROVED', approvedById: user.id } });
    await this.auditLogs.log({ action: 'GOODS_RECEIVED_NOTE_APPROVE', entityType: 'GoodsReceivedNote', entityId: id, userId: user.id, companyId: existing.companyId });
    return updated;
  }

  async post(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'APPROVED') throw new BadRequestException('Only APPROVED GRNs can be posted');
    const updated = await this.prisma.goodsReceivedNote.update({ where: { id }, data: { status: 'POSTED', postedAt: new Date(), postedById: user.id } });
    await this.auditLogs.log({ action: 'GOODS_RECEIVED_NOTE_POST', entityType: 'GoodsReceivedNote', entityId: id, userId: user.id, companyId: existing.companyId });
    return updated;
  }
}
