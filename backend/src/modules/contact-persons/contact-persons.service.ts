import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateContactPersonDto } from './dto/create-contact-person.dto';
import { UpdateContactPersonDto } from './dto/update-contact-person.dto';
import { QueryContactPersonDto } from './dto/query-contact-person.dto';

@Injectable()
export class ContactPersonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryContactPersonDto, user: AuthUser) {
    const { companyId, entityType, entityId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    const [items, total] = await Promise.all([
      this.prisma.contactPerson.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.contactPerson.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser) {
    return this.findOneScoped(id, user, AccessLevel.READ);
  }

  async create(dto: CreateContactPersonDto, user: AuthUser) {
    // Never trust the client-supplied companyId for authorization: validate it
    // against the caller's access before writing.
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);

    const item = await this.prisma.contactPerson.create({
      data: {
        companyId: dto.companyId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        fullName: dto.fullName,
        position: dto.position,
        phone: dto.phone,
        email: dto.email,
        isPrimary: dto.isPrimary ?? false,
        notes: dto.notes,
      },
    });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'ContactPerson', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async update(id: string, dto: UpdateContactPersonDto, user: AuthUser) {
    const existing = await this.findOneScoped(id, user, AccessLevel.WRITE);

    // companyId is immutable after creation; reject any attempt to move the
    // record to another company.
    if (dto.companyId !== undefined && dto.companyId !== existing.companyId) {
      throw new BadRequestException('Contact person companyId is immutable after creation');
    }

    const updated = await this.prisma.contactPerson.update({
      where: { id },
      data: {
        ...(dto.entityType !== undefined && { entityType: dto.entityType }),
        ...(dto.entityId !== undefined && { entityId: dto.entityId }),
        ...(dto.fullName !== undefined && { fullName: dto.fullName }),
        ...(dto.position !== undefined && { position: dto.position }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.isPrimary !== undefined && { isPrimary: dto.isPrimary }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
    await this.auditLogs.log({ action: 'UPDATE', entityType: 'ContactPerson', entityId: id, userId: user.id, oldValue: existing, newValue: updated });
    return updated;
  }

  async remove(id: string, user: AuthUser) {
    await this.findOneScoped(id, user, AccessLevel.WRITE);
    await this.prisma.contactPerson.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'DELETE', entityType: 'ContactPerson', entityId: id, userId: user.id });
    return { success: true };
  }

  private async findOneScoped(id: string, user: AuthUser, minimum: AccessLevel) {
    const record = await this.prisma.contactPerson.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Contact person not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }
}
