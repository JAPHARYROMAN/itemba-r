import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateHousekeepingTaskDto } from './dto/create-housekeeping-task.dto';
import { UpdateHousekeepingTaskDto } from './dto/update-housekeeping-task.dto';
import { HousekeepingTaskStatus, HousekeepingTaskType, RoomStatus } from '@prisma/client';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class HousekeepingService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateHousekeepingTaskDto, userId: string) {
    const existing = await this.prisma.housekeepingTask.findFirst({
      where: { companyId: dto.companyId, taskNumber: dto.taskNumber, deletedAt: null },
    });
    if (existing) throw new BadRequestException('Task number already exists for this company');
    const task = await this.prisma.housekeepingTask.create({
      data: {
        ...dto,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        completedAt: dto.completedAt ? new Date(dto.completedAt) : undefined,
      },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'HousekeepingTask', entityId: task.id, newValue: dto as unknown as Record<string, unknown> });
    return task;
  }

  async findAll(companyId?: string, hospitalityFacilityId?: string, roomId?: string, status?: HousekeepingTaskStatus, taskType?: HousekeepingTaskType, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (hospitalityFacilityId) where.hospitalityFacilityId = hospitalityFacilityId;
    if (roomId) where.roomId = roomId;
    if (status) where.status = status;
    if (taskType) where.taskType = taskType;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.housekeepingTask.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' },
        include: {
          room: { select: { roomNumber: true } },
          assignedTo: { select: { fullName: true } },
        },
      }),
      this.prisma.housekeepingTask.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const task = await this.prisma.housekeepingTask.findFirst({
      where: { id, deletedAt: null },
      include: {
        room: { select: { roomNumber: true, roomType: true } },
        assignedTo: { select: { fullName: true } },
        createdBy: { select: { fullName: true } },
      },
    });
    if (!task) throw new NotFoundException('Housekeeping task not found');
    return task;
  }

  async update(id: string, dto: UpdateHousekeepingTaskDto, userId: string) {
    const task = await this.findOne(id);
    const isCompleting = dto.status === HousekeepingTaskStatus.COMPLETED && task.status !== HousekeepingTaskStatus.COMPLETED;
    const updated = await this.prisma.housekeepingTask.update({
      where: { id },
      data: {
        ...dto,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        completedAt: isCompleting ? new Date() : (dto.completedAt ? new Date(dto.completedAt) : undefined),
      },
    });
    if (isCompleting) {
      await this.prisma.room.update({ where: { id: task.roomId }, data: { status: RoomStatus.AVAILABLE } });
    }
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'HousekeepingTask', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return updated;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.housekeepingTask.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'HousekeepingTask', entityId: id, newValue: {} });
    return { message: 'Housekeeping task deleted' };
  }
}
