import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateEmployeeAssignmentDto } from './dto/create-employee-assignment.dto';
import { UpdateEmployeeAssignmentDto } from './dto/update-employee-assignment.dto';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class EmployeeAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, employeeId, companyId } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (employeeId) where.employeeId = employeeId;
    const [data, total] = await Promise.all([
      this.prisma.employeeAssignment.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          department: { select: { id: true, name: true } },
          position: { select: { id: true, title: true } },
          company: { select: { id: true, name: true } },
        },
      }),
      this.prisma.employeeAssignment.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.employeeAssignment.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        department: { select: { id: true, name: true } },
        position: { select: { id: true, title: true } },
        company: { select: { id: true, name: true } },
      },
    });
    if (!record) throw new NotFoundException('Employee assignment not found');
    return record;
  }

  async create(dto: CreateEmployeeAssignmentDto, user: any) {
    const startDate = new Date(dto.startDate);
    const endDate = dto.endDate ? new Date(dto.endDate) : undefined;
    this.assertValidDateRange(startDate, endDate);

    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const existingPrimary = await tx.employeeAssignment.findFirst({
          where: { employeeId: dto.employeeId, status: 'ACTIVE', isPrimary: true, deletedAt: null },
          select: { id: true },
        });
        const isPrimary = dto.isPrimary ?? !existingPrimary;
        if (isPrimary) {
          await tx.employeeAssignment.updateMany({
            where: {
              employeeId: dto.employeeId,
              status: 'ACTIVE',
              isPrimary: true,
              deletedAt: null,
            },
            data: { isPrimary: false },
          });
        }

        return tx.employeeAssignment.create({
          data: {
            ...dto,
            startDate,
            endDate,
            isPrimary,
          } as any,
        });
      });
      await this.audit.log({
        userId: user.id,
        action: 'CREATE',
        entityType: 'EmployeeAssignment',
        entityId: record.id,
        newValue: dto as unknown as Record<string, unknown>,
      });
      return record;
    } catch (error) {
      this.handleUniqueConstraint(error);
    }
  }

  async update(id: string, dto: UpdateEmployeeAssignmentDto, user: any) {
    const existing = await this.findOne(id, user);
    const startDate = dto.startDate ? new Date(dto.startDate) : existing.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : (existing.endDate ?? undefined);
    this.assertValidDateRange(startDate, endDate);

    const data: Record<string, unknown> = { ...dto };
    if (dto.startDate) data.startDate = startDate;
    if (dto.endDate) data.endDate = endDate;

    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const finalStatus = (dto as any).status ?? existing.status;
        const finalPrimary = dto.isPrimary ?? existing.isPrimary;
        if (finalStatus === 'ACTIVE' && finalPrimary) {
          await tx.employeeAssignment.updateMany({
            where: {
              employeeId: existing.employeeId,
              status: 'ACTIVE',
              isPrimary: true,
              NOT: { id },
              deletedAt: null,
            },
            data: { isPrimary: false },
          });
        }

        return tx.employeeAssignment.update({ where: { id }, data });
      });
      await this.audit.log({
        userId: user.id,
        action: 'UPDATE',
        entityType: 'EmployeeAssignment',
        entityId: id,
        newValue: dto as unknown as Record<string, unknown>,
      });
      return record;
    } catch (error) {
      this.handleUniqueConstraint(error);
    }
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.employeeAssignment.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'EmployeeAssignment',
      entityId: id,
      newValue: {},
    });
    return { message: 'Employee assignment deleted' };
  }

  private assertValidDateRange(startDate: Date, endDate?: Date | null) {
    if (Number.isNaN(startDate.getTime()) || (endDate && Number.isNaN(endDate.getTime()))) {
      throw new BadRequestException('Invalid assignment date');
    }
    if (endDate && endDate < startDate) {
      throw new BadRequestException('Assignment end date cannot be before start date');
    }
  }

  private handleUniqueConstraint(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new BadRequestException('Only one active primary assignment is allowed per employee');
    }
    throw error;
  }
}
