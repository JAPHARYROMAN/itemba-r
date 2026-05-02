import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreatePriceListDto } from './dto/create-price-list.dto';
import { UpdatePriceListDto } from './dto/update-price-list.dto';
import { QueryPriceListDto } from './dto/query-price-list.dto';
import { CreatePriceListItemStandaloneDto, UpdatePriceListItemDto } from './dto/price-list-item.dto';

@Injectable()
export class PriceListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(dto: CreatePriceListDto, userId: string) {
    const record = await this.prisma.$transaction(async (tx) => {
      const pl = await tx.priceList.create({
        data: {
          companyId: dto.companyId,
          name: dto.name,
          priceListType: dto.priceListType,
          currency: dto.currency as any,
          effectiveFrom: new Date(dto.effectiveFrom),
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
          status: 'ACTIVE' as any,
          createdById: userId,
          notes: dto.notes,
        },
      });
      if (dto.items?.length) {
        await tx.priceListItem.createMany({
          data: dto.items.map((item) => ({
            priceListId: pl.id,
            productId: item.productId,
            unitId: item.unitId,
            price: item.price,
            minimumQuantity: item.minimumQuantity ?? 0,
            maximumQuantity: item.maximumQuantity,
          })),
        });
      }
      return pl;
    });
    await this.auditLogs.log({
      action: 'PRICE_LIST_CREATE',
      entityType: 'PriceList',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });
    return this.findOne(record.id);
  }

  async findAll(query: QueryPriceListDto) {
    const { page = 1, limit = 20, companyId, priceListType, status } = query;
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (priceListType) where.priceListType = priceListType;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.priceList.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.priceList.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const record = await this.prisma.priceList.findFirst({
      where: { id, deletedAt: null },
      include: { items: true },
    });
    if (!record) throw new NotFoundException('Price list not found');
    return record;
  }

  async update(id: string, dto: UpdatePriceListDto, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.priceList.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.priceListType && { priceListType: dto.priceListType }),
        ...(dto.currency && { currency: dto.currency as any }),
        ...(dto.effectiveFrom && { effectiveFrom: new Date(dto.effectiveFrom) }),
        ...(dto.effectiveTo !== undefined && { effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      } as any,
    });
    await this.auditLogs.log({
      action: 'PRICE_LIST_UPDATE',
      entityType: 'PriceList',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });
    return this.findOne(id);
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    await this.prisma.priceList.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({
      action: 'PRICE_LIST_DELETE',
      entityType: 'PriceList',
      entityId: id,
      userId,
      companyId: existing.companyId,
    });
    return { success: true };
  }

  async approve(id: string, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.priceList.update({
      where: { id },
      data: { approvedById: userId, approvedAt: new Date() },
    });
    await this.auditLogs.log({
      action: 'PRICE_LIST_APPROVE',
      entityType: 'PriceList',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: existing.status } as any,
      newValue: { status: 'APPROVED' } as any,
    });
    return record;
  }

  async findItems(priceListId: string) {
    await this.findOne(priceListId);
    return this.prisma.priceListItem.findMany({ where: { priceListId } });
  }

  async addItem(priceListId: string, dto: CreatePriceListItemStandaloneDto, userId: string) {
    await this.findOne(priceListId);
    const item = await this.prisma.priceListItem.create({
      data: {
        priceListId,
        productId: dto.productId,
        unitId: dto.unitId,
        price: dto.price,
        minimumQuantity: dto.minimumQuantity ?? 0,
        maximumQuantity: dto.maximumQuantity,
      },
    });
    await this.auditLogs.log({
      action: 'PRICE_LIST_ITEM_CREATE',
      entityType: 'PriceListItem',
      entityId: item.id,
      userId,
    });
    return item;
  }

  async updateItem(itemId: string, dto: UpdatePriceListItemDto, userId: string) {
    const existing = await this.prisma.priceListItem.findUnique({ where: { id: itemId } });
    if (!existing) throw new NotFoundException('Price list item not found');
    const item = await this.prisma.priceListItem.update({
      where: { id: itemId },
      data: {
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.minimumQuantity !== undefined && { minimumQuantity: dto.minimumQuantity }),
        ...(dto.maximumQuantity !== undefined && { maximumQuantity: dto.maximumQuantity }),
      },
    });
    await this.auditLogs.log({
      action: 'PRICE_LIST_ITEM_UPDATE',
      entityType: 'PriceListItem',
      entityId: itemId,
      userId,
    });
    return item;
  }

  async removeItem(itemId: string, userId: string) {
    const existing = await this.prisma.priceListItem.findUnique({ where: { id: itemId } });
    if (!existing) throw new NotFoundException('Price list item not found');
    await this.prisma.priceListItem.delete({ where: { id: itemId } });
    await this.auditLogs.log({
      action: 'PRICE_LIST_ITEM_DELETE',
      entityType: 'PriceListItem',
      entityId: itemId,
      userId,
    });
    return { success: true };
  }
}
