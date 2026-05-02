import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, employeeId, companyId, dateFrom, dateTo, attendanceStatus } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    if (companyId) where.companyId = companyId;
    if (employeeId) where.employeeId = employeeId;
    if (attendanceStatus) where.attendanceStatus = attendanceStatus;
    if (dateFrom || dateTo) {
      where.attendanceDate = {};
      if (dateFrom) where.attendanceDate.gte = new Date(dateFrom);
      if (dateTo) where.attendanceDate.lte = new Date(dateTo);
    }
    const [data, total] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where, skip, take: Number(limit), orderBy: { attendanceDate: 'desc' },
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          company: { select: { id: true, name: true } },
        },
      }),
      this.prisma.attendanceRecord.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.attendanceRecord.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        company: { select: { id: true, name: true } },
      },
    });
    if (!record) throw new NotFoundException('Attendance record not found');
    return record;
  }

  async create(dto: CreateAttendanceDto, user: any) {
    const record = await this.prisma.attendanceRecord.create({
      data: {
        ...dto,
        attendanceDate: new Date(dto.attendanceDate),
        clockInTime: dto.clockInTime ? new Date(dto.clockInTime) : undefined,
        clockOutTime: dto.clockOutTime ? new Date(dto.clockOutTime) : undefined,
      } as any,
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'AttendanceRecord', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateAttendanceDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.attendanceRecord.update({
      where: { id },
      data: {
        ...dto,
        attendanceDate: dto.attendanceDate ? new Date(dto.attendanceDate) : undefined,
        clockInTime: dto.clockInTime ? new Date(dto.clockInTime) : undefined,
        clockOutTime: dto.clockOutTime ? new Date(dto.clockOutTime) : undefined,
      } as any,
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'AttendanceRecord', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async approve(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.attendanceRecord.update({
      where: { id },
      data: { approvedById: user.id, approvedAt: new Date() },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'AttendanceRecord', entityId: id, newValue: { approvalStatus: 'APPROVED' } });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.attendanceRecord.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'AttendanceRecord', entityId: id, newValue: {} });
    return { message: 'Attendance record deleted' };
  }
}
