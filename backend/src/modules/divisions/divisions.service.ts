import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDivisionDto } from './dto/create-division.dto';
import { UpdateDivisionDto } from './dto/update-division.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class DivisionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(user: AuthUser, companyId?: string) {
    const where: Prisma.DivisionWhereInput = { deletedAt: null };

    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else {
      const accessibleCompanyIds = await this.companyScope.accessibleCompanyIds(user);
      if (accessibleCompanyIds !== null) {
        where.companyId = { in: accessibleCompanyIds };
      }
    }

    return this.prisma.division.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, code: true } },
        _count: { select: { branches: true } },
        branches: {
          where: { deletedAt: null },
          select: {
            id: true,
            name: true,
            code: true,
            type: true,
            location: true,
            address: true,
            phone: true,
            isActive: true,
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, user: AuthUser, minimumAccess: AccessLevel = AccessLevel.READ) {
    const division = await this.prisma.division.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        branches: {
          where: { deletedAt: null },
          orderBy: { name: 'asc' },
        },
        _count: { select: { branches: true } },
      },
    });
    if (!division) throw new NotFoundException(`Division ${id} not found`);
    await this.companyScope.assertCanAccessCompany(user, division.companyId, minimumAccess);
    return division;
  }

  async create(dto: CreateDivisionDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const division = await this.prisma.division.create({ data: dto });
    await this.auditLogs.log({
      action: 'DIVISION_CREATE',
      entityType: 'Division',
      entityId: division.id,
      userId: user.id,
      companyId: division.companyId,
      newValue: division as unknown as Record<string, unknown>,
    });
    return division;
  }

  async update(id: string, dto: UpdateDivisionDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (dto.companyId !== undefined && dto.companyId !== existing.companyId) {
      await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    }
    if (dto.isActive === false) {
      const [, division] = await this.prisma.$transaction([
        this.prisma.branch.updateMany({
          where: { divisionId: id, deletedAt: null },
          data: { isActive: false },
        }),
        this.prisma.division.update({ where: { id }, data: dto }),
      ]);
      await this.auditLogs.log({
        action: 'DIVISION_UPDATE',
        entityType: 'Division',
        entityId: id,
        userId: user.id,
        companyId: division.companyId,
        oldValue: existing as unknown as Record<string, unknown>,
        newValue: division as unknown as Record<string, unknown>,
      });
      return division;
    }
    const division = await this.prisma.division.update({ where: { id }, data: dto });
    await this.auditLogs.log({
      action: 'DIVISION_UPDATE',
      entityType: 'Division',
      entityId: id,
      userId: user.id,
      companyId: division.companyId,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: division as unknown as Record<string, unknown>,
    });
    return division;
  }

  async remove(id: string, user: AuthUser) {
    await this.findOne(id, user, AccessLevel.WRITE);
    const now = new Date();
    const [, division] = await this.prisma.$transaction([
      this.prisma.branch.updateMany({
        where: { divisionId: id, deletedAt: null },
        data: { deletedAt: now, isActive: false },
      }),
      this.prisma.division.update({
        where: { id },
        data: { deletedAt: now, isActive: false },
      }),
    ]);
    await this.auditLogs.log({
      action: 'DIVISION_DELETE',
      entityType: 'Division',
      entityId: id,
      userId: user.id,
      companyId: division.companyId,
      newValue: division as unknown as Record<string, unknown>,
    });
    return division;
  }
}
