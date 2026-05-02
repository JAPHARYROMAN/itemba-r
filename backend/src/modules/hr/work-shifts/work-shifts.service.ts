import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateWorkShiftDto } from './dto/create-work-shift.dto';
import { UpdateWorkShiftDto } from './dto/update-work-shift.dto';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class WorkShiftsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, search, companyId } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const [data, total] = await Promise.all([
      this.prisma.workShift.findMany({
        where, skip, take: Number(limit), orderBy: { name: 'asc' },
        include: { company: { select: { id: true, name: true } } },
      }),
      this.prisma.workShift.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.workShift.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!record) throw new NotFoundException('Work shift not found');
    return record;
  }

  async create(dto: CreateWorkShiftDto, user: any) {
    const record = await this.prisma.workShift.create({ data: { ...dto } });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'WorkShift', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateWorkShiftDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.workShift.update({ where: { id }, data: dto });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'WorkShift', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.workShift.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'WorkShift', entityId: id, newValue: {} });
    return { message: 'Work shift deleted' };
  }
}
