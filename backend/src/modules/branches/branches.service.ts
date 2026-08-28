import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

export interface FindAllBranchesArgs {
  divisionId?: string;
  /** Filter to branches whose division belongs to this company. */
  companyId?: string;
  /** When true, exclude soft-deleted and inactive branches. */
  activeOnly?: boolean;
}

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(user: AuthUser, args: FindAllBranchesArgs = {}) {
    const where: Prisma.BranchWhereInput = { deletedAt: null };
    const divisionWhere: Prisma.DivisionWhereInput = { deletedAt: null };

    if (args.divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: args.divisionId, deletedAt: null },
        select: { companyId: true },
      });
      if (!division) return [];
      await this.companyScope.assertCanAccessCompany(user, division.companyId);
      where.divisionId = args.divisionId;
      divisionWhere.companyId = division.companyId;
    }
    if (args.companyId) {
      await this.companyScope.assertCanAccessCompany(user, args.companyId);
      divisionWhere.companyId = args.companyId;
    } else if (!args.divisionId) {
      const accessibleCompanyIds = await this.companyScope.accessibleCompanyIds(user);
      if (accessibleCompanyIds !== null) {
        divisionWhere.companyId = { in: accessibleCompanyIds };
      }
    }
    if (args.activeOnly) {
      where.isActive = true;
      divisionWhere.isActive = true;
    }
    where.division = divisionWhere;

    return this.prisma.branch.findMany({
      where,
      include: { division: { include: { company: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, user: AuthUser, minimumAccess: AccessLevel = AccessLevel.READ) {
    const branch = await this.prisma.branch.findFirst({
      where: { id, deletedAt: null, division: { deletedAt: null } },
      include: { division: { include: { company: true } } },
    });
    if (!branch) throw new NotFoundException(`Branch ${id} not found`);
    await this.companyScope.assertCanAccessCompany(user, branch.division.companyId, minimumAccess);
    return branch;
  }

  async create(dto: CreateBranchDto, user: AuthUser) {
    const division = await this.prisma.division.findFirst({
      where: { id: dto.divisionId, deletedAt: null },
      select: { companyId: true },
    });
    if (!division) throw new NotFoundException(`Division ${dto.divisionId} not found`);
    await this.companyScope.assertCanAccessCompany(user, division.companyId, AccessLevel.WRITE);
    const branch = await this.prisma.branch.create({ data: dto });
    await this.auditLogs.log({
      action: 'BRANCH_CREATE',
      entityType: 'Branch',
      entityId: branch.id,
      userId: user.id,
      companyId: division.companyId,
      newValue: branch as unknown as Record<string, unknown>,
    });
    return branch;
  }

  async update(id: string, dto: UpdateBranchDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (dto.isActive === true && !existing.division.isActive) {
      throw new BadRequestException('Cannot activate a branch whose parent division is inactive');
    }
    const branch = await this.prisma.branch.update({ where: { id }, data: dto });
    await this.auditLogs.log({
      action: 'BRANCH_UPDATE',
      entityType: 'Branch',
      entityId: id,
      userId: user.id,
      companyId: existing.division.companyId,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: branch as unknown as Record<string, unknown>,
    });
    return branch;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const branch = await this.prisma.branch.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.auditLogs.log({
      action: 'BRANCH_DELETE',
      entityType: 'Branch',
      entityId: id,
      userId: user.id,
      companyId: existing.division.companyId,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: branch as unknown as Record<string, unknown>,
    });
    return branch;
  }
}
