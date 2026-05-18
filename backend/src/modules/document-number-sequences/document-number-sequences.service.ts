import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { pagination } from '../../common/utils/pagination';
import {
  CreateDocumentNumberSequenceDto,
  QueryDocumentNumberSequenceDto,
  UpdateDocumentNumberSequenceDto,
} from './dto/document-number-sequence.dto';

@Injectable()
export class DocumentNumberSequencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: QueryDocumentNumberSequenceDto, user?: AuthUser) {
    const { companyId, entityType, page = 1, limit = 20 } = query;
    const paging = pagination({ page, limit });
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (entityType) where.entityType = entityType;
    const [items, total] = await Promise.all([
      this.prisma.documentNumberSequence.findMany({
        where,
        skip: paging.skip,
        take: paging.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.documentNumberSequence.count({ where }),
    ]);
    return { items, total, page: paging.page, limit: paging.limit };
  }

  async findOne(id: string) {
    const item = await this.prisma.documentNumberSequence.findFirst({
      where: { id, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Document number sequence not found');
    return item;
  }

  async create(dto: CreateDocumentNumberSequenceDto, user: AuthUser) {
    const { companyId, startNumber, ...rest } = dto;
    const item = await this.prisma.documentNumberSequence.create({
      data: { ...rest, currentNumber: startNumber ?? 1, ...(companyId ? { companyId } : {}) },
    });
    await this.auditLogs.log({
      action: 'CREATE',
      entityType: 'DocumentNumberSequence',
      entityId: item.id,
      userId: user.id,
      companyId: item.companyId ?? undefined,
    });
    return item;
  }

  async update(id: string, dto: UpdateDocumentNumberSequenceDto, user: AuthUser) {
    const existing = await this.findOne(id);
    const updated = await this.prisma.documentNumberSequence.update({ where: { id }, data: dto });
    await this.auditLogs.log({
      action: 'UPDATE',
      entityType: 'DocumentNumberSequence',
      entityId: id,
      userId: user.id,
      oldValue: existing,
      newValue: updated,
    });
    return updated;
  }

  async nextNumber(id: string, user: AuthUser) {
    const seq = await this.findOne(id);
    const updated = await this.prisma.documentNumberSequence.update({
      where: { id },
      data: { currentNumber: { increment: 1 } },
      select: { currentNumber: true },
    });
    const nextNum = updated.currentNumber;
    const padded = String(nextNum).padStart(seq.padding ?? 4, '0');
    const formatted = `${seq.prefix ?? ''}${padded}${seq.suffix ?? ''}`;
    await this.auditLogs.log({
      action: 'NEXT_NUMBER',
      entityType: 'DocumentNumberSequence',
      entityId: id,
      userId: user.id,
      metadata: { formatted },
    });
    return { number: nextNum, formatted };
  }
}
