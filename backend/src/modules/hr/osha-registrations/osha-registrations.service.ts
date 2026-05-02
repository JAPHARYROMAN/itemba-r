import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateOshaRegistrationDto } from './dto/create-osha-registration.dto';
import { UpdateOshaRegistrationDto } from './dto/update-osha-registration.dto';

@Injectable()
export class OshaRegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async findAll(query: {
    page?: number;
    limit?: number;
    companyId?: string;
    branchId?: string;
    status?: string;
    expiringDays?: number;
  }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = { deletedAt: null };
    if (query.companyId) where.companyId = query.companyId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.status) where.status = query.status;
    if (query.expiringDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + Number(query.expiringDays));
      where.expiresAt = { lte: cutoff };
    }
    const [data, total] = await Promise.all([
      this.prisma.oshaRegistration.findMany({
        where,
        skip,
        take: limit,
        orderBy: { expiresAt: 'asc' },
        include: {
          company: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true, location: true } },
        },
      }),
      this.prisma.oshaRegistration.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const row = await this.prisma.oshaRegistration.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true, location: true } },
      },
    });
    if (!row) throw new NotFoundException('OSHA registration not found');
    return row;
  }

  async create(dto: CreateOshaRegistrationDto, userId: string) {
    const row = await this.prisma.oshaRegistration.create({
      data: {
        ...dto,
        issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : undefined,
        expiresAt: new Date(dto.expiresAt),
      },
    });
    await this.audit.log({
      userId,
      action: 'CREATE',
      entityType: 'OshaRegistration',
      entityId: row.id,
      newValue: row as unknown as Record<string, unknown>,
    });
    return row;
  }

  async update(id: string, dto: UpdateOshaRegistrationDto, userId: string) {
    const existing = await this.findOne(id);
    const data: Record<string, unknown> = { ...dto };
    if (dto.issuedAt !== undefined) data.issuedAt = dto.issuedAt ? new Date(dto.issuedAt) : null;
    if (dto.expiresAt !== undefined) data.expiresAt = new Date(dto.expiresAt);

    const row = await this.prisma.oshaRegistration.update({ where: { id }, data });
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entityType: 'OshaRegistration',
      entityId: id,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: row as unknown as Record<string, unknown>,
    });
    return row;
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    await this.prisma.oshaRegistration.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      userId,
      action: 'DELETE',
      entityType: 'OshaRegistration',
      entityId: id,
      oldValue: existing as unknown as Record<string, unknown>,
    });
    return { success: true };
  }
}
