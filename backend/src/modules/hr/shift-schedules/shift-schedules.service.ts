import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateShiftScheduleDto } from './dto/create-shift-schedule.dto';
import { UpdateShiftScheduleDto } from './dto/update-shift-schedule.dto';

@Injectable()
export class ShiftSchedulesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, employeeId, shiftId, companyId, dateFrom, dateTo } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    if (companyId) where.companyId = companyId;
    if (employeeId) where.employeeId = employeeId;
    if (shiftId) where.workShiftId = shiftId;
    if (dateFrom || dateTo) {
      where.scheduleDate = {};
      if (dateFrom) where.scheduleDate.gte = new Date(dateFrom);
      if (dateTo) where.scheduleDate.lte = new Date(dateTo);
    }
    const [data, total] = await Promise.all([
      this.prisma.shiftSchedule.findMany({
        where, skip, take: Number(limit), orderBy: { scheduleDate: 'desc' },
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          workShift: { select: { id: true, name: true, startTime: true, endTime: true } },
          company: { select: { id: true, name: true } },
        },
      }),
      this.prisma.shiftSchedule.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.shiftSchedule.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        workShift: { select: { id: true, name: true, startTime: true, endTime: true } },
        company: { select: { id: true, name: true } },
      },
    });
    if (!record) throw new NotFoundException('Shift schedule not found');
    return record;
  }

  async create(dto: CreateShiftScheduleDto, user: any) {
    const record = await this.prisma.shiftSchedule.create({
      data: { ...dto, scheduleDate: new Date(dto.scheduleDate) } as any,
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'ShiftSchedule', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateShiftScheduleDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.shiftSchedule.update({
      where: { id },
      data: { ...dto, scheduleDate: dto.scheduleDate ? new Date(dto.scheduleDate) : undefined } as any,
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ShiftSchedule', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.shiftSchedule.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'ShiftSchedule', entityId: id, newValue: {} });
    return { message: 'Shift schedule deleted' };
  }
}
