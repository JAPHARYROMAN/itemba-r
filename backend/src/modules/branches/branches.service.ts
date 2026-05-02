import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

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
  ) {}

  async findAll(user: AuthUser, args: FindAllBranchesArgs = {}) {
    const where: Prisma.BranchWhereInput = { deletedAt: null };
    const divisionWhere: Prisma.DivisionWhereInput = {};

    if (args.divisionId) where.divisionId = args.divisionId;
    if (args.companyId) {
      await this.companyScope.assertCanAccessCompany(user, args.companyId);
      divisionWhere.companyId = args.companyId;
    } else {
      const accessibleCompanyIds = await this.companyScope.accessibleCompanyIds(user);
      if (accessibleCompanyIds !== null) {
        divisionWhere.companyId = { in: accessibleCompanyIds };
      }
    }
    if (args.activeOnly) where.isActive = true;
    if (Object.keys(divisionWhere).length > 0) where.division = divisionWhere;

    return this.prisma.branch.findMany({
      where,
      include: { division: { include: { company: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, user: AuthUser, minimumAccess: AccessLevel = AccessLevel.READ) {
    const branch = await this.prisma.branch.findFirst({
      where: { id, deletedAt: null },
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
    return this.prisma.branch.create({ data: dto });
  }

  async update(id: string, dto: UpdateBranchDto, user: AuthUser) {
    await this.findOne(id, user, AccessLevel.WRITE);
    return this.prisma.branch.update({ where: { id }, data: dto });
  }

  async remove(id: string, user: AuthUser) {
    await this.findOne(id, user, AccessLevel.WRITE);
    return this.prisma.branch.delete({ where: { id } });
  }
}
