import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateDeductionTypeDto } from './dto/create-deduction-type.dto';
import { UpdateDeductionTypeDto } from './dto/update-deduction-type.dto';

@Injectable()
export class DeductionTypesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, search, companyId } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    if (companyId) where.companyId = companyId;
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const [data, total] = await Promise.all([
      this.prisma.deductionType.findMany({
        where, skip, take: Number(limit), orderBy: { name: 'asc' },
        include: { company: { select: { id: true, name: true } } },
      }),
      this.prisma.deductionType.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.deductionType.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!record) throw new NotFoundException('Deduction type not found');
    return record;
  }

  async create(dto: CreateDeductionTypeDto, user: any) {
    const record = await this.prisma.deductionType.create({ data: dto as any });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'DeductionType', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateDeductionTypeDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.deductionType.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'DeductionType', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.deductionType.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'DeductionType', entityId: id, newValue: {} });
    return { message: 'Deduction type deleted' };
  }
}
