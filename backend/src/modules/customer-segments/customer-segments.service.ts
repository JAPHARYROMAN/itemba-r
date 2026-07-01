import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CreateCustomerSegmentDto } from './dto/create-customer-segment.dto';
import { UpdateCustomerSegmentDto } from './dto/update-customer-segment.dto';
import { QueryCustomerSegmentDto } from './dto/query-customer-segment.dto';
import { AddSegmentMemberDto } from './dto/add-member.dto';

@Injectable()
export class CustomerSegmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  async findAll(query: QueryCustomerSegmentDto, user: AuthUser) {
    const { companyId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    const [items, total] = await Promise.all([
      this.prisma.customerSegment.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' }, include: { memberships: true } }),
      this.prisma.customerSegment.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser) {
    return this.findOneScoped(id, user, AccessLevel.READ);
  }

  async create(dto: CreateCustomerSegmentDto, user: AuthUser) {
    // Never trust the client-supplied companyId for authorization: validate it
    // against the caller's access before writing.
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);

    // segmentCode is required and GLOBALLY unique (schema: `segmentCode String
    // @unique`, no DB default). The frontend never supplies one, so a POST with
    // a bare body used to fail the NOT-NULL/unique constraint (500). Generate it
    // server-side via the central EntityCodeGeneratorService. Because the
    // constraint is global (not per-company), we draw from the GLOBAL counter
    // (companyId omitted) so two companies can never collide. A caller may still
    // supply an explicit code for backward-compat/migration; if it collides we
    // return a clear 400. Generation + insert share one transaction so the
    // counter advance commits atomically with the row, and on a rare unique
    // collision (concurrent create or a manually seeded code) we retry with a
    // fresh number.
    const providedCode = dto.segmentCode?.trim();
    const maxAttempts = providedCode ? 1 : 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const item = await this.prisma.$transaction(async (tx) => {
          const segmentCode =
            providedCode ??
            (await this.codes.next({ entityType: 'CustomerSegment', tx }));
          return tx.customerSegment.create({
            data: {
              companyId: dto.companyId,
              segmentCode,
              name: dto.name,
              description: dto.description,
              criteria: (dto.criteria ?? undefined) as Prisma.InputJsonValue | undefined,
              ...(dto.isActive !== undefined && { isActive: dto.isActive }),
            },
          });
        });
        await this.auditLogs.log({ action: 'CREATE', entityType: 'CustomerSegment', entityId: item.id, userId: user.id, companyId: item.companyId });
        return item;
      } catch (err) {
        // P2002 = unique constraint violation. When we generated the code we
        // retry with a fresh number; when the caller supplied one we surface a
        // clear 400 instead of a generic 500.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          if (providedCode) {
            throw new BadRequestException(`Customer segment code "${providedCode}" already exists`);
          }
          if (attempt < maxAttempts) continue;
          throw new BadRequestException('Failed to generate a unique customer segment code, please retry');
        }
        throw err;
      }
    }
    // Unreachable: the loop either returns or throws on every path.
    throw new BadRequestException('Failed to create customer segment');
  }

  async update(id: string, dto: UpdateCustomerSegmentDto, user: AuthUser) {
    const existing = await this.findOneScoped(id, user, AccessLevel.WRITE);

    // companyId is immutable after creation; reject any attempt to move the
    // record to another company.
    if (dto.companyId !== undefined && dto.companyId !== existing.companyId) {
      throw new BadRequestException('Customer segment companyId is immutable after creation');
    }

    const updated = await this.prisma.customerSegment.update({
      where: { id },
      data: {
        ...(dto.segmentCode !== undefined && { segmentCode: dto.segmentCode }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.criteria !== undefined && { criteria: dto.criteria as Prisma.InputJsonValue }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
    await this.auditLogs.log({ action: 'UPDATE', entityType: 'CustomerSegment', entityId: id, userId: user.id, oldValue: existing, newValue: updated });
    return updated;
  }

  async remove(id: string, user: AuthUser) {
    await this.findOneScoped(id, user, AccessLevel.WRITE);
    await this.prisma.customerSegment.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'DELETE', entityType: 'CustomerSegment', entityId: id, userId: user.id });
    return { success: true };
  }

  async addMember(segmentId: string, dto: AddSegmentMemberDto, user: AuthUser) {
    // Ensure the caller can write to the segment's company (and that the segment
    // is visible to them at all — foreign tenants get a NotFound, no leak).
    const segment = await this.findOneScoped(segmentId, user, AccessLevel.WRITE);

    const customerId = dto?.customerId;
    if (!customerId || typeof customerId !== 'string') {
      throw new BadRequestException('customerId is required');
    }

    // The customer must exist, be live, and belong to the SAME company as the
    // segment. CustomerSegmentMembership has no companyId/FK to Customer, so the
    // DB cannot enforce this cross-company guard — do it here.
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true, companyId: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.companyId !== segment.companyId) {
      throw new BadRequestException('Customer does not belong to the segment\'s company');
    }

    const membership = await this.prisma.customerSegmentMembership.upsert({
      where: { customerSegmentId_customerId: { customerSegmentId: segmentId, customerId } },
      create: { customerSegmentId: segmentId, customerId, assignedById: user.id },
      update: {},
    });
    await this.auditLogs.log({ action: 'ADD_MEMBER', entityType: 'CustomerSegment', entityId: segmentId, userId: user.id });
    return membership;
  }

  async removeMember(segmentId: string, customerId: string, user: AuthUser) {
    // Assert WRITE on the segment's company before mutating memberships.
    await this.findOneScoped(segmentId, user, AccessLevel.WRITE);
    await this.prisma.customerSegmentMembership.deleteMany({ where: { customerSegmentId: segmentId, customerId } });
    await this.auditLogs.log({ action: 'REMOVE_MEMBER', entityType: 'CustomerSegment', entityId: segmentId, userId: user.id });
    return { success: true };
  }

  private async findOneScoped(id: string, user: AuthUser, minimum: AccessLevel) {
    const record = await this.prisma.customerSegment.findFirst({ where: { id, deletedAt: null }, include: { memberships: true } });
    if (!record) throw new NotFoundException('Customer segment not found');

    // Foreign tenant (cannot even READ the record's company): surface NotFound so
    // we don't leak the existence of records the caller may not see at all.
    try {
      await this.companyScope.assertCanAccessCompany(user, record.companyId, AccessLevel.READ);
    } catch {
      throw new NotFoundException('Customer segment not found');
    }

    // Caller can see the record but may still lack the required write level;
    // surface the real Forbidden here (existence is already known to be OK).
    if (minimum !== AccessLevel.READ) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    }
    return record;
  }
}
