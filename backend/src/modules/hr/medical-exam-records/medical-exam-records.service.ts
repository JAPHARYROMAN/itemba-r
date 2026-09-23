import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { applyCompanyScopeWhere, assertCanAccessCompanyFromUser } from '../../../common/services';
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

  async findAll(
    query: {
      page?: number;
      limit?: number;
      companyId?: string;
      employeeId?: string;
      fitnessStatus?: string;
      expiringDays?: number;
      hazardOnly?: boolean;
      search?: string;
    },
    user: AuthUser,
  ) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { deletedAt: null };
    applyCompanyScopeWhere(where, user, query.companyId);
    const search = query.search?.trim();
    if (search)
      where.OR = [
        { employee: { fullName: { contains: search, mode: 'insensitive' } } },
        { employee: { employeeCode: { contains: search, mode: 'insensitive' } } },
        { facilityName: { contains: search, mode: 'insensitive' } },
        { doctorName: { contains: search, mode: 'insensitive' } },
      ];
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

  async findOne(id: string, user: AuthUser) {
    const where = applyCompanyScopeWhere({ id, deletedAt: null }, user);
    const row = await this.prisma.medicalExamRecord.findFirst({
      where,
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
    });
    if (!row) throw new NotFoundException('Medical exam record not found');
    return row;
  }

  private async validateIdentity(companyId: string, employeeId: string, user: AuthUser) {
    assertCanAccessCompanyFromUser(user, companyId, AccessLevel.WRITE);
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new BadRequestException('Choose an employee belonging to this company.');
  }

  private validateDates(examDate: string | Date, expiresAt: string | Date) {
    if (
      !examDate ||
      !expiresAt ||
      !Number.isFinite(new Date(examDate).getTime()) ||
      !Number.isFinite(new Date(expiresAt).getTime())
    )
      throw new BadRequestException('Valid examination and expiry dates are required.');
    if (new Date(expiresAt).getTime() < new Date(examDate).getTime())
      throw new BadRequestException('Expiry must be on or after the examination date.');
  }

  async create(dto: CreateMedicalExamRecordDto, user: AuthUser) {
    await this.validateIdentity(dto.companyId, dto.employeeId, user);
    this.validateDates(dto.examDate, dto.expiresAt);
    const row = await this.prisma.medicalExamRecord.create({
      data: {
        ...dto,
        examDate: new Date(dto.examDate),
        expiresAt: new Date(dto.expiresAt),
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'MedicalExamRecord',
      entityId: row.id,
      newValue: row as unknown as Record<string, unknown>,
    });
    return row;
  }

  async update(id: string, dto: UpdateMedicalExamRecordDto, user: AuthUser) {
    const existing = await this.findOne(id, user);
    assertCanAccessCompanyFromUser(user, existing.companyId, AccessLevel.WRITE);
    if (
      (dto.companyId !== undefined && dto.companyId !== existing.companyId) ||
      (dto.employeeId !== undefined && dto.employeeId !== existing.employeeId)
    )
      throw new BadRequestException(
        'The company and employee of an examination cannot be changed.',
      );
    this.validateDates(
      dto.examDate === undefined ? existing.examDate : dto.examDate,
      dto.expiresAt === undefined ? existing.expiresAt : dto.expiresAt,
    );
    const data: Record<string, unknown> = { ...dto };
    if (dto.examDate !== undefined) data.examDate = new Date(dto.examDate);
    if (dto.expiresAt !== undefined) data.expiresAt = new Date(dto.expiresAt);

    const row = await this.prisma.medicalExamRecord.update({ where: { id }, data });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'MedicalExamRecord',
      entityId: id,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: row as unknown as Record<string, unknown>,
    });
    return row;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    assertCanAccessCompanyFromUser(user, existing.companyId, AccessLevel.WRITE);
    await this.prisma.medicalExamRecord.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'MedicalExamRecord',
      entityId: id,
      oldValue: existing as unknown as Record<string, unknown>,
    });
    return { success: true };
  }
}
