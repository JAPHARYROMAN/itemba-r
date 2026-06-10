import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PetroleumShiftControlService } from '../../common/services';
import { GenerateReconciliationDto } from './dto/generate-reconciliation.dto';
import { UpdateReconciliationDto } from './dto/update-reconciliation.dto';

@Injectable()
export class FuelDailyReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly petroleumShiftControl: PetroleumShiftControlService,
  ) {}

  async generate(dto: GenerateReconciliationDto, user: AuthUser) {
    const dateObj = new Date(dto.reconciliationDate);

    const existing = await this.prisma.fuelDailyReconciliation.findFirst({
      where: { branchId: dto.branchId, reconciliationDate: dateObj, deletedAt: null },
    });
    if (existing) return existing;

    await this.petroleumShiftControl.assertDailyReconciliationReady({
      companyId: dto.companyId,
      branchId: dto.branchId,
      reconciliationDate: dateObj,
    });

    const year = dateObj.getFullYear();
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);

    const shifts = await this.prisma.fuelShift.findMany({
      where: {
        branchId: dto.branchId,
        shiftDate: dateObj,
        status: 'CLOSED',
        deletedAt: null,
      },
      select: { id: true },
    });
    const shiftIds = shifts.map((s) => s.id);

    let totalLitresSold = 0;
    let totalExpectedSales = 0;
    if (shiftIds.length > 0) {
      const readingsAgg = await this.prisma.fuelNozzleReading.aggregate({
        where: { fuelShiftId: { in: shiftIds }, status: 'CLOSED' },
        _sum: { litresSold: true, expectedAmount: true },
      });
      totalLitresSold = Number(readingsAgg._sum.litresSold ?? 0);
      totalExpectedSales = Number(readingsAgg._sum.expectedAmount ?? 0);
    }

    let totalCashCollected = 0;
    let totalMobileMoneyCollected = 0;
    let totalBankCardCollected = 0;
    let totalCreditSales = 0;
    if (shiftIds.length > 0) {
      const collectionsByType = await this.prisma.fuelShiftCollection.groupBy({
        by: ['collectionType'],
        where: { fuelShiftId: { in: shiftIds } },
        _sum: { amount: true },
      });
      for (const c of collectionsByType) {
        const amt = Number(c._sum.amount ?? 0);
        if (c.collectionType === 'CASH') totalCashCollected = amt;
        else if (c.collectionType === 'MOBILE_MONEY') totalMobileMoneyCollected = amt;
        else if (c.collectionType === 'BANK_CARD') totalBankCardCollected = amt;
        else if (c.collectionType === 'CREDIT_SALE') totalCreditSales = amt;
      }
    }

    let totalTankVarianceLitres = 0;
    let totalTankVarianceValue = 0;
    const dipsAgg = await this.prisma.fuelTankDip.aggregate({
      where: { branchId: dto.branchId, dipDate: dateObj, status: 'POSTED' },
      _sum: { varianceLitres: true, varianceValue: true },
    });
    totalTankVarianceLitres = Number(dipsAgg._sum.varianceLitres ?? 0);
    totalTankVarianceValue = Number(dipsAgg._sum.varianceValue ?? 0);

    const totalCollections =
      totalCashCollected + totalMobileMoneyCollected + totalBankCardCollected + totalCreditSales;
    const difference = totalCollections - totalExpectedSales;
    const cashShortage = difference < 0 ? Math.abs(difference) : 0;
    const cashExcess = difference > 0 ? difference : 0;

    // Scope the reconciliation-number sequence to the company (and year) so it is
    // unique per company per @@unique([companyId, reconciliationNumber]). Compute the
    // next number and create atomically, retrying once on a unique-constraint clash
    // caused by a concurrent close.
    const createWithNumber = () =>
      this.prisma.$transaction(async (tx) => {
        const count = await tx.fuelDailyReconciliation.count({
          where: {
            companyId: dto.companyId,
            reconciliationDate: { gte: yearStart, lt: yearEnd },
          },
        });
        const reconciliationNumber = `RECON-${year}-${(count + 1).toString().padStart(5, '0')}`;
        return tx.fuelDailyReconciliation.create({
          data: {
            reconciliationNumber,
            companyId: dto.companyId,
            branchId: dto.branchId,
            reconciliationDate: dateObj,
            totalLitresSold,
            totalExpectedSales,
            totalCashCollected,
            totalMobileMoneyCollected,
            totalBankCardCollected,
            totalCreditSales,
            totalCollections,
            cashShortage,
            cashExcess,
            totalTankVarianceLitres,
            totalTankVarianceValue,
            status: 'DRAFT',
            preparedById: user.id,
            notes: dto.notes,
          },
        });
      });

    let recon;
    try {
      recon = await createWithNumber();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        recon = await createWithNumber();
      } else {
        throw e;
      }
    }

    await this.auditLogsService.log({
      userId: user.id,
      action: 'RECONCILIATION_GENERATE',
      entityType: 'FuelDailyReconciliation',
      entityId: recon.id,
      newValue: recon as unknown as Record<string, unknown>,
      companyId: dto.companyId,
    });

    return recon;
  }

  async findAll(query: Record<string, string>) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { deletedAt: null };
    if (query.companyId) where.companyId = query.companyId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.fuelDailyReconciliation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { reconciliationDate: 'desc' },
      }),
      this.prisma.fuelDailyReconciliation.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const rec = await this.prisma.fuelDailyReconciliation.findFirstOrThrow({
      where: { id, deletedAt: null },
    });

    await this.auditLogsService.log({
      userId: user.id,
      action: 'RECONCILIATION_VIEW',
      entityType: 'FuelDailyReconciliation',
      entityId: id,
      companyId: rec.companyId,
    });

    return rec;
  }

  async update(id: string, dto: UpdateReconciliationDto, user: AuthUser) {
    const rec = await this.prisma.fuelDailyReconciliation.findFirstOrThrow({
      where: { id, deletedAt: null },
    });
    if (rec.status !== 'DRAFT') {
      throw new BadRequestException('Can only update DRAFT reconciliations');
    }

    const updated = await this.prisma.fuelDailyReconciliation.update({
      where: { id },
      data: { notes: dto.notes },
    });

    await this.auditLogsService.log({
      userId: user.id,
      action: 'RECONCILIATION_UPDATE',
      entityType: 'FuelDailyReconciliation',
      entityId: id,
      newValue: dto as unknown as Record<string, unknown>,
      companyId: rec.companyId,
    });

    return updated;
  }

  async submit(id: string, user: AuthUser) {
    const rec = await this.prisma.fuelDailyReconciliation.findFirstOrThrow({
      where: { id, deletedAt: null },
    });
    if (rec.status !== 'DRAFT') {
      throw new BadRequestException('Can only submit DRAFT reconciliations');
    }

    const updated = await this.prisma.fuelDailyReconciliation.update({
      where: { id },
      data: { status: 'SUBMITTED' },
    });

    await this.auditLogsService.log({
      userId: user.id,
      action: 'RECONCILIATION_SUBMIT',
      entityType: 'FuelDailyReconciliation',
      entityId: id,
      companyId: rec.companyId,
    });

    return updated;
  }

  async approve(id: string, user: AuthUser) {
    const rec = await this.prisma.fuelDailyReconciliation.findFirstOrThrow({
      where: { id, deletedAt: null },
    });
    if (rec.status !== 'SUBMITTED') {
      throw new BadRequestException('Can only approve SUBMITTED reconciliations');
    }

    const updated = await this.prisma.fuelDailyReconciliation.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() },
    });

    await this.auditLogsService.log({
      userId: user.id,
      action: 'RECONCILIATION_APPROVE',
      entityType: 'FuelDailyReconciliation',
      entityId: id,
      companyId: rec.companyId,
    });

    return updated;
  }

  async post(id: string, user: AuthUser) {
    const rec = await this.prisma.fuelDailyReconciliation.findFirstOrThrow({
      where: { id, deletedAt: null },
    });
    if (rec.status !== 'APPROVED') {
      throw new BadRequestException('Can only post APPROVED reconciliations');
    }

    const updated = await this.prisma.fuelDailyReconciliation.update({
      where: { id },
      data: { status: 'POSTED', postedById: user.id, postedAt: new Date() },
    });

    await this.auditLogsService.log({
      userId: user.id,
      action: 'RECONCILIATION_POST',
      entityType: 'FuelDailyReconciliation',
      entityId: id,
      companyId: rec.companyId,
    });

    return updated;
  }

  async remove(id: string, user: AuthUser) {
    const rec = await this.prisma.fuelDailyReconciliation.findFirstOrThrow({
      where: { id, deletedAt: null },
    });
    if (!['DRAFT', 'REJECTED'].includes(rec.status)) {
      throw new BadRequestException('Can only delete DRAFT or REJECTED reconciliations');
    }

    await this.prisma.fuelDailyReconciliation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      userId: user.id,
      action: 'RECONCILIATION_DELETE',
      entityType: 'FuelDailyReconciliation',
      entityId: id,
      companyId: rec.companyId,
    });

    return { message: 'Deleted' };
  }
}
