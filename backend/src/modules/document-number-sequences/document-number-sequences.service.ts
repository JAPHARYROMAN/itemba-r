import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { companyWhereForUser, isGroupScopedUser, CompanyScopeService } from '../../common/services';
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
    private readonly companyScope: CompanyScopeService,
  ) {}

  /**
   * Build the company-scope predicate for document number sequences.
   *
   * Sequences may be created at the group level (companyId=null) to serve as
   * shared/default templates across the tenant group. A plain company scope
   * ({companyId:{in:[...]}}) can never match a null companyId, so those
   * group-level sequences were readable by id (findOne widens to null for
   * group-scoped users) yet invisible in findAll — an inconsistency. Group-scoped
   * viewers oversee group-level records, so we additionally surface
   * companyId:null rows to them WITHOUT loosening tenant isolation for
   * company-scoped rows. Regular company-scoped users keep the strict scope and
   * never see null rows.
   */
  private scopeWhere(user: AuthUser | undefined, requestedCompanyId?: string | null): any {
    const scope = companyWhereForUser(user, requestedCompanyId);
    // Only widen to include group-level (null companyId) sequences when the
    // viewer is group-scoped and is not narrowing to a single requested company.
    if (user && isGroupScopedUser(user) && !requestedCompanyId) {
      return { OR: [scope, { companyId: null }] };
    }
    return scope;
  }

  async findAll(query: QueryDocumentNumberSequenceDto, user?: AuthUser) {
    const { companyId, entityType, page = 1, limit = 20 } = query;
    const paging = pagination({ page, limit });
    const where: any = { deletedAt: null };
    Object.assign(where, this.scopeWhere(user, companyId));
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

  async findOne(id: string, user?: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.documentNumberSequence.findFirst({
      where: { id, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Document number sequence not found');
    if (user) await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
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
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
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
    const seq = await this.findOne(id, user, AccessLevel.WRITE);
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
