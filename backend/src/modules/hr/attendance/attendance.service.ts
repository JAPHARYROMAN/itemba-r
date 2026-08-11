import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../../entity-code-generator/entity-code-generator.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const {
      page = 1,
      limit = 20,
      employeeId,
      companyId,
      divisionId,
      branchId,
      dateFrom,
      dateTo,
      attendanceStatus,
    } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (employeeId) where.employeeId = employeeId;
    if (attendanceStatus) where.attendanceStatus = attendanceStatus;
    if (dateFrom || dateTo) {
      where.attendanceDate = {};
      if (dateFrom) where.attendanceDate.gte = startOfDay(new Date(dateFrom));
      if (dateTo) where.attendanceDate.lte = endOfDay(new Date(dateTo));
    }
    const [data, total] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { attendanceDate: 'desc' },
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          division: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
          shiftSchedule: {
            select: {
              id: true,
              scheduleNumber: true,
              workShift: { select: { id: true, name: true, startTime: true, endTime: true } },
            },
          },
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
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        shiftSchedule: {
          select: {
            id: true,
            scheduleNumber: true,
            workShift: { select: { id: true, name: true, startTime: true, endTime: true } },
          },
        },
        company: { select: { id: true, name: true } },
      },
    });
    if (!record) throw new NotFoundException('Attendance record not found');
    return record;
  }

  async create(dto: CreateAttendanceDto, user: any) {
    const hierarchy = await this.resolveEmployeeHierarchy(
      dto.companyId,
      dto.employeeId,
      dto.divisionId,
      dto.branchId,
    );
    await this.assertNoDailyDuplicate(dto.companyId, dto.employeeId, dto.attendanceDate);
    const normalized = await this.normalizeAttendance(dto);
    const attendanceNumber =
      dto.attendanceNumber ??
      (await this.codes.next({ companyId: dto.companyId, entityType: 'AttendanceRecord' }));
    const record = await this.prisma.attendanceRecord.create({
      data: {
        ...dto,
        attendanceNumber,
        divisionId: hierarchy.divisionId,
        branchId: hierarchy.branchId,
        attendanceDate: new Date(dto.attendanceDate),
        clockInTime: dto.clockInTime ? new Date(dto.clockInTime) : undefined,
        clockOutTime: dto.clockOutTime ? new Date(dto.clockOutTime) : undefined,
        totalHours: normalized.totalHours,
        lateMinutes: normalized.lateMinutes,
        earlyLeaveMinutes: normalized.earlyLeaveMinutes,
        attendanceStatus: normalized.attendanceStatus,
      } as any,
    });
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'AttendanceRecord',
      entityId: record.id,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }

  async update(id: string, dto: UpdateAttendanceDto, user: any) {
    const existing = await this.findOne(id, user);
    const hierarchy =
      dto.companyId !== undefined ||
      dto.employeeId !== undefined ||
      dto.divisionId !== undefined ||
      dto.branchId !== undefined
        ? await this.resolveEmployeeHierarchy(
            (dto as any).companyId ?? existing.companyId,
            (dto as any).employeeId ?? existing.employeeId,
            (dto as any).divisionId ?? existing.divisionId,
            (dto as any).branchId ?? existing.branchId,
          )
        : { divisionId: existing.divisionId, branchId: existing.branchId };
    await this.assertNoDailyDuplicate(
      (dto as any).companyId ?? existing.companyId,
      (dto as any).employeeId ?? existing.employeeId,
      dto.attendanceDate ?? existing.attendanceDate,
      id,
    );
    const normalized = await this.normalizeAttendance({
      attendanceNumber: existing.attendanceNumber,
      companyId: (dto as any).companyId ?? existing.companyId,
      employeeId: (dto as any).employeeId ?? existing.employeeId,
      createdById: existing.createdById,
      attendanceDate: String(dto.attendanceDate ?? existing.attendanceDate.toISOString()),
      shiftScheduleId: (dto as any).shiftScheduleId ?? existing.shiftScheduleId ?? undefined,
      clockInTime: dto.clockInTime ?? existing.clockInTime?.toISOString(),
      clockOutTime: dto.clockOutTime ?? existing.clockOutTime?.toISOString(),
      overtimeHours: dto.overtimeHours ?? Number(existing.overtimeHours ?? 0),
      lateMinutes: dto.lateMinutes ?? existing.lateMinutes,
      earlyLeaveMinutes: dto.earlyLeaveMinutes ?? existing.earlyLeaveMinutes,
      attendanceStatus: dto.attendanceStatus ?? existing.attendanceStatus,
      source: dto.source ?? existing.source,
      notes: dto.notes ?? existing.notes ?? undefined,
    });
    const record = await this.prisma.attendanceRecord.update({
      where: { id },
      data: {
        ...dto,
        divisionId: hierarchy.divisionId,
        branchId: hierarchy.branchId,
        attendanceDate: dto.attendanceDate ? new Date(dto.attendanceDate) : undefined,
        clockInTime: dto.clockInTime ? new Date(dto.clockInTime) : undefined,
        clockOutTime: dto.clockOutTime ? new Date(dto.clockOutTime) : undefined,
        totalHours: normalized.totalHours,
        lateMinutes: normalized.lateMinutes,
        earlyLeaveMinutes: normalized.earlyLeaveMinutes,
        attendanceStatus: normalized.attendanceStatus,
      } as any,
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'AttendanceRecord',
      entityId: id,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }

  async approve(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.attendanceRecord.update({
      where: { id },
      data: { approvedById: user.id, approvedAt: new Date() },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'AttendanceRecord',
      entityId: id,
      newValue: { approvalStatus: 'APPROVED' },
    });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.attendanceRecord.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'AttendanceRecord',
      entityId: id,
      newValue: {},
    });
    return { message: 'Attendance record deleted' };
  }

  private async assertNoDailyDuplicate(
    companyId: string,
    employeeId: string,
    attendanceDate: string | Date,
    excludeId?: string,
  ) {
    const day = new Date(attendanceDate);
    const duplicate = await this.prisma.attendanceRecord.findFirst({
      where: {
        companyId,
        employeeId,
        attendanceDate: { gte: startOfDay(day), lte: endOfDay(day) },
        deletedAt: null,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException('Attendance already exists for this employee on this date');
    }
  }

  private async resolveEmployeeHierarchy(
    companyId: string,
    employeeId: string,
    requestedDivisionId?: string | null,
    requestedBranchId?: string | null,
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId, deletedAt: null },
      select: { divisionId: true, branchId: true },
    });
    if (!employee) {
      throw new BadRequestException('Employee does not belong to this company');
    }

    const divisionId = requestedDivisionId ?? employee.divisionId;
    const branchId = requestedBranchId ?? employee.branchId;
    await this.assertHierarchyBelongsToCompany(companyId, divisionId, branchId);
    return { divisionId, branchId };
  }

  private async assertHierarchyBelongsToCompany(
    companyId: string,
    divisionId?: string | null,
    branchId?: string | null,
  ) {
    if (divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: divisionId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!division) throw new BadRequestException('Division does not belong to this company');
    }
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: {
          id: branchId,
          deletedAt: null,
          division: { companyId },
          ...(divisionId ? { divisionId } : {}),
        },
        select: { id: true },
      });
      if (!branch) throw new BadRequestException('Branch does not belong to this company/division');
    }
  }

  private async normalizeAttendance(dto: CreateAttendanceDto) {
    const clockIn = dto.clockInTime ? new Date(dto.clockInTime) : null;
    const clockOut = dto.clockOutTime ? new Date(dto.clockOutTime) : null;
    if (clockOut && !clockIn) {
      throw new BadRequestException('Clock-out requires a clock-in time');
    }
    if (clockIn && Number.isNaN(clockIn.getTime())) {
      throw new BadRequestException('Invalid clock-in time');
    }
    if (clockOut && Number.isNaN(clockOut.getTime())) {
      throw new BadRequestException('Invalid clock-out time');
    }
    if (clockIn && clockOut && clockOut <= clockIn) {
      throw new BadRequestException('Clock-out must be after clock-in');
    }

    let totalHours = 0;
    if (clockIn && clockOut) {
      totalHours = round2((clockOut.getTime() - clockIn.getTime()) / 3_600_000);
    }

    let lateMinutes = dto.lateMinutes ?? 0;
    let earlyLeaveMinutes = dto.earlyLeaveMinutes ?? 0;
    if (dto.shiftScheduleId) {
      const schedule = await this.prisma.shiftSchedule.findFirst({
        where: { id: dto.shiftScheduleId, deletedAt: null },
        include: { workShift: { select: { startTime: true, endTime: true } } },
      });
      if (!schedule) throw new BadRequestException('Shift schedule not found');
      if (schedule.employeeId !== dto.employeeId || schedule.companyId !== dto.companyId) {
        throw new BadRequestException('Shift schedule does not belong to this employee/company');
      }
      if (clockIn && dto.lateMinutes === undefined) {
        lateMinutes = minutesAfterScheduledTime(clockIn, schedule.workShift.startTime);
      }
      if (clockOut && dto.earlyLeaveMinutes === undefined) {
        earlyLeaveMinutes = minutesBeforeScheduledTime(clockOut, schedule.workShift.endTime);
      }
    }

    let attendanceStatus = dto.attendanceStatus;
    if (!attendanceStatus) {
      attendanceStatus = clockIn ? (lateMinutes > 0 ? 'LATE' : 'PRESENT') : 'UNPAID_ABSENT';
    }
    if (['PRESENT', 'LATE', 'HALF_DAY'].includes(attendanceStatus) && !clockIn) {
      throw new BadRequestException(`${attendanceStatus} attendance requires a clock-in time`);
    }
    if (['ABSENT', 'UNPAID_ABSENT', 'ON_LEAVE', 'HOLIDAY', 'SICK'].includes(attendanceStatus)) {
      totalHours = 0;
    }

    return { totalHours, lateMinutes, earlyLeaveMinutes, attendanceStatus };
  }
}

function startOfDay(value: Date): Date {
  const d = new Date(value);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfDay(value: Date): Date {
  const d = new Date(value);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function minutesAfterScheduledTime(actual: Date, scheduledTime: string): number {
  const scheduled = dateWithClock(actual, scheduledTime);
  return Math.max(0, Math.round((actual.getTime() - scheduled.getTime()) / 60_000));
}

function minutesBeforeScheduledTime(actual: Date, scheduledTime: string): number {
  const scheduled = dateWithClock(actual, scheduledTime);
  return Math.max(0, Math.round((scheduled.getTime() - actual.getTime()) / 60_000));
}

function dateWithClock(anchor: Date, time: string): Date {
  const [hours = '0', minutes = '0'] = time.split(':');
  const d = new Date(anchor);
  d.setUTCHours(Number(hours), Number(minutes), 0, 0);
  return d;
}
