import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';

@Injectable()
export class RfqsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    // EntityCodeGeneratorModule is @Global(), so this injects without any change
    // to rfqs.module.ts. Central, race-safe issuer for rfqNumber.
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  async findAll(query: any, user?: any) {
    const { companyId, status, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      this.prisma.requestForQuotation.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' }, include: { rfqSuppliers: true } }),
      this.prisma.requestForQuotation.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const item = await this.prisma.requestForQuotation.findFirst({ where: { id, deletedAt: null }, include: { rfqSuppliers: true } });
    if (!item) throw new NotFoundException('RFQ not found');
    return item;
  }

  async create(dto: any, user: any) {
    const { rfqSuppliers, suppliers, rfqNumber, ...rest } = dto;
    const suppliersToCreate = rfqSuppliers ?? suppliers;

    if (!rest.companyId) throw new BadRequestException('companyId is required');

    // rfqNumber is required (non-nullable, @@unique([companyId, rfqNumber])) but
    // has no DB default, so we must supply one before insert. Prefer a
    // caller-provided value for backward-compat; otherwise server-generate a
    // company-scoped, race-safe number (RFQ-{YYYY}-00001) via the central
    // EntityCodeGeneratorService. The generation and insert share one
    // transaction so the counter advance is committed atomically with the row,
    // and on a rare unique collision we retry with a fresh number.
    const maxAttempts = rfqNumber ? 1 : 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const item = await this.prisma.$transaction(async (tx) => {
          const number =
            rfqNumber ??
            (await this.codes.next({
              entityType: 'RFQ',
              companyId: rest.companyId,
              tx,
            }));
          return tx.requestForQuotation.create({
            data: {
              ...rest,
              rfqNumber: number,
              status: 'DRAFT',
              createdById: user.id,
              rfqSuppliers: suppliersToCreate ? { create: suppliersToCreate } : undefined,
            },
            include: { rfqSuppliers: true },
          });
        });
        await this.auditLogs.log({ action: 'CREATE', entityType: 'RequestForQuotation', entityId: item.id, userId: user.id, companyId: item.companyId });
        return item;
      } catch (err) {
        // P2002 = unique constraint violation. When the number was generated we
        // retry (a concurrent create or a manually seeded number may have taken
        // it); when the caller supplied rfqNumber we surface a clear 400.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          if (rfqNumber) {
            throw new BadRequestException(`RFQ number "${rfqNumber}" already exists for this company`);
          }
          if (attempt < maxAttempts) continue;
          throw new BadRequestException('Failed to generate a unique RFQ number, please retry');
        }
        throw err;
      }
    }
    // Unreachable: the loop either returns or throws on every path.
    throw new BadRequestException('Failed to create RFQ');
  }

  async update(id: string, dto: any, user: any) {
    const existing = await this.findOne(id);
    const updated = await this.prisma.requestForQuotation.update({ where: { id }, data: dto });
    await this.auditLogs.log({ action: 'UPDATE', entityType: 'RequestForQuotation', entityId: id, userId: user.id, oldValue: existing, newValue: updated });
    return updated;
  }

  async send(id: string, dto: any, user: any) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Only DRAFT RFQs can be sent');
    if (dto.supplierIds?.length) {
      await Promise.all(
        dto.supplierIds.map((supplierId: string) =>
          this.prisma.rFQSupplier.upsert({ where: { id: '' }, create: { rfqId: id, supplierId }, update: { supplierId } }),
        ),
      );
    }
    const updated = await this.prisma.requestForQuotation.update({ where: { id }, data: { status: 'SENT' } });
    await this.auditLogs.log({ action: 'SEND', entityType: 'RequestForQuotation', entityId: id, userId: user.id });
    return updated;
  }
}
