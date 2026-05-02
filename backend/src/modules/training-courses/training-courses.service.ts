import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
@Injectable()
export class TrainingCoursesService {
  constructor(private readonly prisma: PrismaService, private readonly auditLogs: AuditLogsService) {}
  async create(dto: any, userId: string) {
    const record = await this.prisma.trainingCourse.create({ data: { courseCode: 'TC-' + Date.now(), title: dto.title, description: dto.description, roleName: dto.roleName, moduleName: dto.moduleName, difficulty: dto.difficulty ?? 'BEGINNER', status: 'DRAFT', estimatedMinutes: dto.estimatedMinutes ?? dto.estimatedDurationMinutes, createdById: userId } });
    await this.auditLogs.log({ action: 'TRAINING_COURSE_CREATED', entityType: 'TrainingCourse', entityId: record.id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }
  async findAll(query: any) {
    const { page = 1, pageSize = 20, status, roleName, moduleName, difficulty } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = { deletedAt: null };
    if (status) where.status = status;
    if (roleName) where.roleName = roleName;
    if (moduleName) where.moduleName = moduleName;
    if (difficulty) where.difficulty = difficulty;
    const [data, total] = await Promise.all([this.prisma.trainingCourse.findMany({ where, skip, take: Number(pageSize), orderBy: { createdAt: 'desc' } }), this.prisma.trainingCourse.count({ where })]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }
  async findOne(id: string) {
    const record = await this.prisma.trainingCourse.findFirst({ where: { id, deletedAt: null }, include: { lessons: { where: { deletedAt: null }, orderBy: { lessonOrder: 'asc' } } } });
    if (!record) throw new NotFoundException('Training course not found');
    return record;
  }
  async update(id: string, dto: any, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.trainingCourse.update({ where: { id }, data: { ...(dto.title !== undefined && { title: dto.title }), ...(dto.description !== undefined && { description: dto.description }), ...(dto.roleName !== undefined && { roleName: dto.roleName }), ...(dto.moduleName !== undefined && { moduleName: dto.moduleName }), ...(dto.difficulty !== undefined && { difficulty: dto.difficulty }), ...(dto.estimatedDurationMinutes !== undefined && { estimatedDurationMinutes: dto.estimatedDurationMinutes }) } });
    await this.auditLogs.log({ action: 'TRAINING_COURSE_UPDATED', entityType: 'TrainingCourse', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }
  async setStatus(id: string, status: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.trainingCourse.update({ where: { id }, data: { status: status as any } });
    await this.auditLogs.log({ action: 'TRAINING_COURSE_' + status, entityType: 'TrainingCourse', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }
  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.trainingCourse.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'TRAINING_COURSE_DELETED', entityType: 'TrainingCourse', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return { success: true };
  }
}
