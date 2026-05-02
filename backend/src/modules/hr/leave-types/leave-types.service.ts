import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class LeaveTypesService {
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
      this.prisma.leaveType.findMany({
        where, skip, take: Number(limit), orderBy: { name: 'asc' },
        include: { company: { select: { id: true, name: true } } },
      }),
      this.prisma.leaveType.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.leaveType.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!record) throw new NotFoundException('Leave type not found');
    return record;
  }

  async create(dto: CreateLeaveTypeDto, user: any) {
    const record = await this.prisma.leaveType.create({ data: { ...dto } });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'LeaveType', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateLeaveTypeDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.leaveType.update({ where: { id }, data: dto });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'LeaveType', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.leaveType.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'LeaveType', entityId: id, newValue: {} });
    return { message: 'Leave type deleted' };
  }
}
