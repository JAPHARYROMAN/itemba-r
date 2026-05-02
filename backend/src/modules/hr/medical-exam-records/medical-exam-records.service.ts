import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateMedicalExamRecordDto } from './dto/create-medical-exam-record.dto';
import { UpdateMedicalExamRecordDto } from './dto/update-medical-exam-record.dto';

@Injectable()
export class MedicalExamRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async findAll(query: {
    page?: number;
    limit?: number;
    companyId?: string;
    employeeId?: string;
    fitnessStatus?: string;
    expiringDays?: number;
    hazardOnly?: boolean;
  }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { deletedAt: null };
    if (query.companyId) where.companyId = query.companyId;
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.fitnessStatus) where.fitnessStatus = query.fitnessStatus;
    if (query.hazardOnly) where.hazardSector = true;
    if (query.expiringDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + Number(query.expiringDays));
      where.expiresAt = { lte: cutoff };
    }

    const [data, total] = await Promise.all([
      this.prisma.medicalExamRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { expiresAt: 'asc' },
        include: {
          company: { select: { id: true, name: true } },
          employee: {
            select: {
              id: true,
              employeeCode: true,
              fullName: true,
              firstName: true,
              lastName: true,
              department: { select: { name: true } },
              position: { select: { title: true } },
            },
          },
        },
      }),
      this.prisma.medicalExamRecord.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const row = await this.prisma.medicalExamRecord.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true } },
        employee: {
          select: {
            id: true, employeeCode: true, fullName: true, firstName: true, lastName: true,
            department: { select: { name: true } },
            position: { select: { title: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Medical exam record not found');
    return row;
  }

  async create(dto: CreateMedicalExamRecordDto, userId: string) {
    const row = await this.prisma.medicalExamRecord.create({
      data: {
        ...dto,
        examDate: new Date(dto.examDate),
        expiresAt: new Date(dto.expiresAt),
      },
    });
    await this.audit.log({
      userId,
      action: 'CREATE',
      entityType: 'MedicalExamRecord',
      entityId: row.id,
      newValue: row as unknown as Record<string, unknown>,
    });
    return row;
  }

  async update(id: string, dto: UpdateMedicalExamRecordDto, userId: string) {
    const existing = await this.findOne(id);
    const data: Record<string, unknown> = { ...dto };
    if (dto.examDate !== undefined) data.examDate = new Date(dto.examDate);
    if (dto.expiresAt !== undefined) data.expiresAt = new Date(dto.expiresAt);

    const row = await this.prisma.medicalExamRecord.update({ where: { id }, data });
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entityType: 'MedicalExamRecord',
      entityId: id,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: row as unknown as Record<string, unknown>,
    });
    return row;
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    await this.prisma.medicalExamRecord.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      userId,
      action: 'DELETE',
      entityType: 'MedicalExamRecord',
      entityId: id,
      oldValue: existing as unknown as Record<string, unknown>,
    });
    return { success: true };
  }
}
