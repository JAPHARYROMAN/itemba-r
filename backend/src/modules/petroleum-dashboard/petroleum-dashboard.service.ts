import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class PetroleumDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getDashboard(query: { companyId?: string; branchId?: string }, user: AuthUser) {
    const companyWhere = (await this.companyScope.companyWhereFor(user, query.companyId)) as any;
    const branchWhere = query.branchId
      ? { branchId: query.branchId, ...companyWhere }
      : companyWhere;

    const [
      tankCount,
      activeTankCount,
      pumpCount,
      nozzleCount,
      openShiftCount,
      todayShiftCount,
      pendingDeliveries,
      fuelCreditOpenCount,
      pendingDipCount,
      tanks,
      recentShifts,
      recentDeliveries,
    ] = await Promise.all([
      this.prisma.fuelTank.count({ where: { ...branchWhere, deletedAt: null } }),
      this.prisma.fuelTank.count({ where: { ...branchWhere, status: 'ACTIVE', deletedAt: null } }),
      this.prisma.fuelPump.count({ where: { ...branchWhere, status: 'ACTIVE', deletedAt: null } }),
      this.prisma.fuelNozzle.count({ where: { ...branchWhere, status: 'ACTIVE', deletedAt: null } }),
      this.prisma.fuelShift.count({ where: { ...branchWhere, status: 'OPEN', deletedAt: null } }),
      this.prisma.fuelShift.count({
        where: {
          ...branchWhere,
          shiftDate: new Date(new Date().toDateString()),
          deletedAt: null,
        },
      }),
      this.prisma.fuelDelivery.count({
        where: { ...branchWhere, status: { in: ['DRAFT', 'RECEIVED'] }, deletedAt: null },
      }),
      this.prisma.fuelCreditSale.count({
        where: { ...branchWhere, status: 'OPEN', deletedAt: null },
      }),
      this.prisma.fuelTankDip.count({
        where: {
          ...branchWhere,
          status: { in: ['SUBMITTED', 'APPROVED'] },
          deletedAt: null,
        },
      }),
      this.prisma.fuelTank.findMany({
        where: { ...branchWhere, deletedAt: null },
        select: {
          id: true,
          tankName: true,
          tankCode: true,
          capacityLitres: true,
          currentBookBalance: true,
          status: true,
          product: { select: { name: true } },
        },
      }),
      this.prisma.fuelShift.findMany({
        where: { ...branchWhere, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          shiftNumber: true,
          shiftDate: true,
          shiftType: true,
          status: true,
          openedBy: { select: { fullName: true } },
        },
      }),
      this.prisma.fuelDelivery.findMany({
        where: { ...branchWhere, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          deliveryNumber: true,
          deliveredLitres: true,
          status: true,
          supplier: { select: { name: true } },
        },
      }),
    ]);

    return {
      summary: {
        tankCount,
        activeTankCount,
        pumpCount,
        nozzleCount,
        openShiftCount,
        todayShiftCount,
        pendingDeliveries,
        fuelCreditOpenCount,
        pendingDipCount,
      },
      tanks,
      recentShifts,
      recentDeliveries,
    };
  }

  async getBranchDashboard(branchId: string, user: AuthUser) {
    await this.assertBranchAccess(branchId, user);
    return this.getDashboard({ branchId }, user);
  }

  private async assertBranchAccess(branchId: string, user: AuthUser) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId },
      select: { division: { select: { companyId: true } } },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    await this.companyScope.assertCanAccessCompany(user, branch.division.companyId);
  }
}
