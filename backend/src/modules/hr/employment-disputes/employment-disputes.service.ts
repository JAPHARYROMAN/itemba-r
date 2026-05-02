import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../../entity-code-generator/entity-code-generator.service';
import { CreateEmploymentDisputeDto } from './dto/create-employment-dispute.dto';
import {
  MediateDisputeDto,
  ReferCmaDisputeDto,
  ResolveDisputeDto,
  UpdateEmploymentDisputeDto,
} from './dto/update-employment-dispute.dto';

@Injectable()
export class EmploymentDisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  private include() {
    return {
      employee: {
        select: {
          id: true,
          employeeCode: true,
          fullName: true,
          firstName: true,
          lastName: true,
          department: { select: { name: true } },
          position: { select: { title: true } },
        },
      },
      raisedBy: { select: { id: true, fullName: true } },
      mediatedBy: { select: { id: true, fullName: true } },
      cmaReferredBy: { select: { id: true, fullName: true } },
      resolvedBy: { select: { id: true, fullName: true } },
      disciplinaryActions: { where: { deletedAt: null }, orderBy: { issuedAt: 'desc' as const } },
    };
  }

  async findAll(query: { page?: number; limit?: number; companyId?: string; employeeId?: string; status?: string }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;
    const where: Record<string, unknown> = { deletedAt: null };
    if (query.companyId) where.companyId = query.companyId;
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
    const [data, total] = await Promise.all([
      this.prisma.employmentDispute.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: { raisedAt: 'desc' },
        include: this.include(),
      }),
      this.prisma.employmentDispute.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const row = await this.prisma.employmentDispute.findFirst({
      where: { id, deletedAt: null },
      include: this.include(),
    });
    if (!row) throw new NotFoundException('Dispute not found');
    return row;
  }

  async create(dto: CreateEmploymentDisputeDto, userId: string) {
    const disputeNumber = await this.codes.next({ entityType: 'EmploymentDispute', companyId: dto.companyId });
    const row = await this.prisma.employmentDispute.create({
      data: {
        disputeNumber,
        companyId: dto.companyId,
        employeeId: dto.employeeId,
        raisedById: userId,
        type: dto.type,
        raisedAt: new Date(dto.raisedAt),
        summary: dto.summary,
        initialPosition: dto.initialPosition,
        notes: dto.notes,
        status: 'RAISED',
      },
      include: this.include(),
    });
    await this.audit.log({
      userId, action: 'CREATE', entityType: 'EmploymentDispute', entityId: row.id,
      newValue: row as unknown as Record<string, unknown>,
    });
    return row;
  }

  async update(id: string, dto: UpdateEmploymentDisputeDto, userId: string) {
    const existing = await this.findOne(id);
    const data: Record<string, unknown> = {};
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.summary !== undefined) data.summary = dto.summary;
    if (dto.initialPosition !== undefined) data.initialPosition = dto.initialPosition;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.raisedAt !== undefined) data.raisedAt = new Date(dto.raisedAt);
    const row = await this.prisma.employmentDispute.update({ where: { id }, data, include: this.include() });
    await this.audit.log({
      userId, action: 'UPDATE', entityType: 'EmploymentDispute', entityId: id,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: row as unknown as Record<string, unknown>,
    });
    return row;
  }

  async startMediation(id: string, dto: MediateDisputeDto, userId: string) {
    const existing = await this.findOne(id);
    if (!['RAISED'].includes(existing.status)) {
      throw new BadRequestException('Only RAISED disputes can move to internal mediation');
    }
    const row = await this.prisma.employmentDispute.update({
      where: { id },
      data: {
        status: 'INTERNAL_MEDIATION',
        mediatedById: userId,
        mediatedAt: new Date(),
        mediationOutcome: dto.mediationOutcome,
      },
      include: this.include(),
    });
    await this.audit.log({
      userId, action: 'UPDATE', entityType: 'EmploymentDispute', entityId: id,
      oldValue: { status: existing.status }, newValue: { status: 'INTERNAL_MEDIATION' },
    });
    return row;
  }

  async referToCma(id: string, dto: ReferCmaDisputeDto, userId: string) {
    const existing = await this.findOne(id);
    if (!['RAISED', 'INTERNAL_MEDIATION'].includes(existing.status)) {
      throw new BadRequestException('Dispute cannot be referred to CMA in its current status');
    }
    const row = await this.prisma.employmentDispute.update({
      where: { id },
      data: {
        status: 'CMA_REFERRED',
        cmaReferredById: userId,
        cmaReferredAt: new Date(),
        cmaReferenceNumber: dto.cmaReferenceNumber,
        cmaHearingDate: dto.cmaHearingDate ? new Date(dto.cmaHearingDate) : undefined,
        cmaArbitrator: dto.cmaArbitrator,
      },
      include: this.include(),
    });
    await this.audit.log({
      userId, action: 'UPDATE', entityType: 'EmploymentDispute', entityId: id,
      oldValue: { status: existing.status }, newValue: { status: 'CMA_REFERRED', ...dto },
    });
    return row;
  }

  async resolve(id: string, dto: ResolveDisputeDto, userId: string) {
    const existing = await this.findOne(id);
    if (['RESOLVED', 'DISMISSED', 'WITHDRAWN'].includes(existing.status)) {
      throw new BadRequestException('Dispute is already closed');
    }
    const row = await this.prisma.employmentDispute.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedById: userId,
        resolvedAt: new Date(),
        resolutionType: dto.resolutionType,
        resolutionAmount: dto.resolutionAmount,
        resolutionNotes: dto.resolutionNotes,
      },
      include: this.include(),
    });
    await this.audit.log({
      userId, action: 'UPDATE', entityType: 'EmploymentDispute', entityId: id,
      oldValue: { status: existing.status }, newValue: { status: 'RESOLVED', ...dto },
    });
    return row;
  }

  async withdraw(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (['RESOLVED', 'DISMISSED', 'WITHDRAWN'].includes(existing.status)) {
      throw new BadRequestException('Dispute is already closed');
    }
    const row = await this.prisma.employmentDispute.update({
      where: { id },
      data: { status: 'WITHDRAWN', resolvedById: userId, resolvedAt: new Date() },
      include: this.include(),
    });
    await this.audit.log({
      userId, action: 'UPDATE', entityType: 'EmploymentDispute', entityId: id,
      oldValue: { status: existing.status }, newValue: { status: 'WITHDRAWN' },
    });
    return row;
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    await this.prisma.employmentDispute.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId, action: 'DELETE', entityType: 'EmploymentDispute', entityId: id,
      oldValue: existing as unknown as Record<string, unknown>,
    });
    return { success: true };
  }
}
