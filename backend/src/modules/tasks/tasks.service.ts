import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, status, assignedToId, taskType, priority } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    else if (user.companyId) where.companyId = user.companyId;
    if (status) where.status = status;
    if (assignedToId) where.assignedToId = assignedToId;
    if (taskType) where.taskType = taskType;
    if (priority) where.priority = priority;
    const [data, total] = await Promise.all([
      this.prisma.task.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.task.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findMyTasks(user: any, query: any) {
    const { page = 1, limit = 20, status, taskType, priority } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { assignedToId: user.id, deletedAt: null };
    if (status) where.status = status;
    if (taskType) where.taskType = taskType;
    if (priority) where.priority = priority;
    const [data, total] = await Promise.all([
      this.prisma.task.findMany({ where, skip, take: Number(limit), orderBy: { dueDate: 'asc' } }),
      this.prisma.task.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.task.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Task not found');
    return record;
  }

  async create(dto: CreateTaskDto, user: any) {
    const taskNumber = `TASK-${Date.now()}`;
    const record = await this.prisma.task.create({
      data: {
        taskNumber,
        title: dto.title,
        description: dto.description,
        taskType: dto.taskType ?? 'CUSTOM',
        priority: dto.priority ?? 'NORMAL',
        status: dto.status ?? 'TODO',
        assignedToId: dto.assignedToId,
        assignedById: dto.assignedById ?? user.id,
        companyId: dto.companyId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        linkedEntityType: dto.linkedEntityType,
        linkedEntityId: dto.linkedEntityId,
      },
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'Task', entityId: record.id, newValue: dto as any });
    return record;
  }

  async update(id: string, dto: UpdateTaskDto, user: any) {
    await this.findOne(id, user);
    const data: any = { ...dto };
    if (dto.dueDate) data.dueDate = new Date(dto.dueDate);
    const record = await this.prisma.task.update({ where: { id }, data });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'Task', entityId: id, newValue: dto as any });
    return record;
  }

  async complete(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.task.update({
      where: { id },
      data: { status: 'COMPLETED', completedById: user.id, completedAt: new Date() },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'Task', entityId: id, newValue: { status: 'COMPLETED' } });
    return record;
  }

  async cancel(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.task.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'Task', entityId: id, newValue: { status: 'CANCELLED' } });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.task.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'Task', entityId: id, newValue: {} });
    return { message: 'Task deleted' };
  }
}
