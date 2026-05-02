import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
@Injectable()
export class TrainingLessonsService {
  constructor(private readonly prisma: PrismaService, private readonly auditLogs: AuditLogsService) {}
  async create(courseId: string, dto: any, userId: string) {
    const record = await this.prisma.trainingLesson.create({ data: { lessonCode: 'TL-' + Date.now(), trainingCourseId: courseId, title: dto.title, description: dto.description, content: dto.content ?? '', lessonType: dto.lessonType ?? 'TEXT', lessonOrder: dto.lessonOrder ?? 1, status: 'DRAFT' } });
    await this.auditLogs.log({ action: 'TRAINING_LESSON_CREATED', entityType: 'TrainingLesson', entityId: record.id, userId, severity: AuditSeverity.LOW });
    return record;
  }
  async findByCourse(courseId: string) {
    return this.prisma.trainingLesson.findMany({ where: { trainingCourseId: courseId, deletedAt: null }, orderBy: { lessonOrder: 'asc' } });
  }
  async findOne(id: string) {
    const record = await this.prisma.trainingLesson.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Training lesson not found');
    return record;
  }
  async update(id: string, dto: any, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.trainingLesson.update({ where: { id }, data: { ...(dto.title !== undefined && { title: dto.title }), ...(dto.description !== undefined && { description: dto.description }), ...(dto.content !== undefined && { content: dto.content }), ...(dto.lessonOrder !== undefined && { lessonOrder: dto.lessonOrder }), ...(dto.estimatedDurationMinutes !== undefined && { estimatedDurationMinutes: dto.estimatedDurationMinutes }) } });
    await this.auditLogs.log({ action: 'TRAINING_LESSON_UPDATED', entityType: 'TrainingLesson', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }
  async setStatus(id: string, status: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.trainingLesson.update({ where: { id }, data: { status: status as any } });
    await this.auditLogs.log({ action: 'TRAINING_LESSON_' + status, entityType: 'TrainingLesson', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }
  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.trainingLesson.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'TRAINING_LESSON_DELETED', entityType: 'TrainingLesson', entityId: id, userId, severity: AuditSeverity.LOW });
    return { success: true };
  }
}
