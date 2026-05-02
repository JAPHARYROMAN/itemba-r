import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
@Injectable()
export class TrainingEnrollmentsService {
  constructor(private readonly prisma: PrismaService, private readonly auditLogs: AuditLogsService) {}
  async create(dto: any, userId: string) {
    const existing = await this.prisma.trainingEnrollment.findFirst({ where: { userId: dto.userId, trainingCourseId: dto.trainingCourseId } });
    if (existing && existing.status !== 'CANCELLED') throw new ConflictException('Enrollment already exists for this user and course');
    const record = await this.prisma.trainingEnrollment.create({ data: { userId: dto.userId, trainingCourseId: dto.trainingCourseId, status: 'ASSIGNED', progressPercent: 0, assignedById: userId } });
    await this.auditLogs.log({ action: 'TRAINING_ENROLLMENT_CREATED', entityType: 'TrainingEnrollment', entityId: record.id, userId, severity: AuditSeverity.LOW });
    return record;
  }
  async findAll(query: any) {
    const { page = 1, pageSize = 20, userId, status, trainingCourseId } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = {};
    if (userId) where.userId = userId;
    if (status) where.status = status;
    if (trainingCourseId) where.trainingCourseId = trainingCourseId;
    const [data, total] = await Promise.all([this.prisma.trainingEnrollment.findMany({ where, skip, take: Number(pageSize), orderBy: { createdAt: 'desc' } }), this.prisma.trainingEnrollment.count({ where })]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }
  async findMine(userId: string) {
    return this.prisma.trainingEnrollment.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }
  async findOne(id: string) {
    const record = await this.prisma.trainingEnrollment.findFirst({ where: { id }, include: { lessonProgresses: true } });
    if (!record) throw new NotFoundException('Enrollment not found');
    return record;
  }
  async startEnrollment(id: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.trainingEnrollment.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    await this.auditLogs.log({ action: 'TRAINING_ENROLLMENT_STARTED', entityType: 'TrainingEnrollment', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }
  async completeEnrollment(id: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.trainingEnrollment.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date(), progressPercent: 100 } });
    await this.auditLogs.log({ action: 'TRAINING_ENROLLMENT_COMPLETED', entityType: 'TrainingEnrollment', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }
  async startLessonProgress(id: string, userId: string) {
    const record = await this.prisma.trainingLessonProgress.findFirst({ where: { id } });
    if (!record) throw new NotFoundException('Lesson progress not found');
    return this.prisma.trainingLessonProgress.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
  }
  async completeLessonProgress(id: string, userId: string) {
    const progress = await this.prisma.trainingLessonProgress.findFirst({ where: { id } });
    if (!progress) throw new NotFoundException('Lesson progress not found');
    await this.prisma.trainingLessonProgress.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    const [total, completed] = await Promise.all([
      this.prisma.trainingLessonProgress.count({ where: { trainingEnrollmentId: progress.trainingEnrollmentId } }),
      this.prisma.trainingLessonProgress.count({ where: { trainingEnrollmentId: progress.trainingEnrollmentId, status: 'COMPLETED' } }),
    ]);
    const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
    await this.prisma.trainingEnrollment.update({ where: { id: progress.trainingEnrollmentId }, data: { progressPercent } });
    return { success: true, progressPercent };
  }
  async failLessonProgress(id: string, userId: string) {
    const record = await this.prisma.trainingLessonProgress.findFirst({ where: { id } });
    if (!record) throw new NotFoundException('Lesson progress not found');
    return this.prisma.trainingLessonProgress.update({ where: { id }, data: { status: 'FAILED' } });
  }
}
