import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';

/**
 * Petroleum sector commission engine — Mwanjalisi Oil's pump attendants are
 * paid a per-litre commission on top of base pay. Litres dispensed are already
 * captured by Phase 4-of-petroleum's `FuelShiftAttendant` + `FuelNozzleReading`
 * tables; this service joins them, applies a per-product rate, and writes the
 * result as an `EmployeeAllowance` so the existing payroll calculator picks it
 * up without any special-casing.
 *
 * Attribution rules (matching the fuel-shift efficiency endpoint):
 *   1. If the nozzle reading has its own `attendantId` (a User FK), match to
 *      the attendant that has that user as their `userId`. Skipped if no
 *      Employee owns that user.
 *   2. Else, if the shift's attendant has `assignedPumpId` matching the
 *      reading's `pumpId`, attribute to that attendant.
 *   3. Else, the litres are unattributed and excluded from commissions.
 *
 * Idempotency: writing twice for the same `(employeeId, allowanceTypeId,
 * effectiveFrom, effectiveTo)` updates the existing row rather than
 * duplicating. Operators can adjust rates and re-commit safely.
 */

export interface CommissionFilter {
  companyId: string;
  /** Optional branch scope. If omitted, commissions roll up across all branches. */
  branchId?: string;
  /** Inclusive ISO date (UTC) — payroll period start. */
  periodStart: string;
  /** Inclusive ISO date (UTC) — payroll period end. */
  periodEnd: string;
  /** Map of productId → TZS per litre. Products not in the map produce zero commission. */
  ratesByProductId: Record<string, number>;
}

interface AttendantBucket {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  branchId: string | null;
  branchName: string | null;
  byProduct: Map<string, { productId: string; productName: string; litres: number; rate: number; amount: number }>;
  totalLitres: number;
  totalAmount: number;
}

@Injectable()
export class PetroleumCommissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  /**
   * Compute commissions without writing anything. Used to preview before commit.
   */
  async preview(filter: CommissionFilter) {
    this.validateFilter(filter);

    const periodStart = new Date(filter.periodStart);
    const periodEnd = new Date(filter.periodEnd);
    // Make end inclusive — convert to end-of-day UTC.
    periodEnd.setUTCHours(23, 59, 59, 999);

    // 1. Find all CLOSED nozzle readings whose shift belongs to this company
    //    + period. Closed shifts have litresSold finalised.
    const readings = await this.prisma.fuelNozzleReading.findMany({
      where: {
        companyId: filter.companyId,
        ...(filter.branchId ? { branchId: filter.branchId } : {}),
        status: 'CLOSED',
        fuelShift: {
          shiftDate: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
        },
      },
      include: {
        product: { select: { id: true, name: true } },
        fuelShift: {
          select: {
            id: true,
            shiftDate: true,
            branchId: true,
            branch: { select: { id: true, name: true } },
            attendants: {
              include: {
                employee: {
                  select: {
                    id: true,
                    employeeCode: true,
                    fullName: true,
                    firstName: true,
                    lastName: true,
                    userId: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const buckets = new Map<string, AttendantBucket>();
    let unattributedLitres = 0;
    let unattributedAmount = 0;

    for (const r of readings) {
      const litres = Number(r.litresSold);
      if (litres <= 0) continue;
      const rate = Number(filter.ratesByProductId[r.productId] ?? 0);
      const productAmount = litres * rate;

      // Pick attendant per attribution rules (above).
      const shiftAttendants = r.fuelShift.attendants;

      // Rule 1: explicit attendantId on the reading → match to employee via userId
      let employee: { id: string; employeeCode: string; fullName: string | null; firstName: string; lastName: string; userId: string | null } | null = null;
      if (r.attendantId) {
        const ax = shiftAttendants.find((a) => a.employee?.userId === r.attendantId);
        if (ax?.employee) employee = ax.employee;
      }

      // Rule 2: attendant pinned to the pump
      if (!employee) {
        const pinned = shiftAttendants.find((a) => a.assignedPumpId === r.pumpId);
        if (pinned?.employee) employee = pinned.employee;
      }

      if (!employee) {
        unattributedLitres += litres;
        unattributedAmount += productAmount;
        continue;
      }

      const branchId = r.fuelShift.branchId ?? null;
      const branchName = r.fuelShift.branch?.name ?? null;

      const bucket = buckets.get(employee.id) ?? {
        employeeId: employee.id,
        employeeCode: employee.employeeCode,
        fullName: employee.fullName ?? `${employee.firstName} ${employee.lastName}`,
        branchId,
        branchName,
        byProduct: new Map(),
        totalLitres: 0,
        totalAmount: 0,
      };

      const productKey = r.productId;
      const prod = bucket.byProduct.get(productKey) ?? {
        productId: r.productId,
        productName: r.product.name,
        litres: 0,
        rate,
        amount: 0,
      };
      prod.litres += litres;
      prod.amount += productAmount;
      bucket.byProduct.set(productKey, prod);
      bucket.totalLitres += litres;
      bucket.totalAmount += productAmount;

      buckets.set(employee.id, bucket);
    }

    const rows = Array.from(buckets.values())
      .map((b) => ({
        employeeId: b.employeeId,
        employeeCode: b.employeeCode,
        fullName: b.fullName,
        branchId: b.branchId,
        branchName: b.branchName,
        byProduct: Array.from(b.byProduct.values()).map((p) => ({
          ...p,
          litres: round3(p.litres),
          amount: round2(p.amount),
        })),
        totalLitres: round3(b.totalLitres),
        totalAmount: round2(b.totalAmount),
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount);

    const totals = {
      attendants: rows.length,
      totalLitres: round3(rows.reduce((s, r) => s + r.totalLitres, 0)),
      totalAmount: round2(rows.reduce((s, r) => s + r.totalAmount, 0)),
      unattributedLitres: round3(unattributedLitres),
      unattributedAmount: round2(unattributedAmount),
    };

    return {
      filter: { ...filter, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() },
      totals,
      rows,
    };
  }

  /**
   * Persist the previewed commissions as `EmployeeAllowance` rows (one per
   * employee, total amount), idempotently keyed on
   * `(employeeId, PETROLEUM_COMMISSION allowance type, effectiveFrom, effectiveTo)`.
   */
  async commit(filter: CommissionFilter, userId: string) {
    const preview = await this.preview(filter);

    const allowanceType = await this.prisma.allowanceType.findFirst({
      where: { companyId: filter.companyId, code: 'PETROLEUM_COMMISSION', deletedAt: null },
    });
    if (!allowanceType) {
      throw new NotFoundException(
        'PETROLEUM_COMMISSION allowance type not found for company. Re-run the seed.',
      );
    }

    const periodStart = new Date(preview.filter.periodStart);
    const periodEnd = new Date(preview.filter.periodEnd);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const writtenRows: Array<{ employeeId: string; allowanceId: string; amount: number }> = [];

    for (const row of preview.rows) {
      if (row.totalAmount <= 0) {
        skipped++;
        continue;
      }
      // Look for existing row for this exact period.
      const existing = await this.prisma.employeeAllowance.findFirst({
        where: {
          employeeId: row.employeeId,
          allowanceTypeId: allowanceType.id,
          effectiveFrom: periodStart,
          effectiveTo: periodEnd,
          deletedAt: null,
        },
      });
      if (existing) {
        const updatedRow = await this.prisma.employeeAllowance.update({
          where: { id: existing.id },
          data: { amount: row.totalAmount, status: 'ACTIVE' },
        });
        writtenRows.push({ employeeId: row.employeeId, allowanceId: updatedRow.id, amount: row.totalAmount });
        updated++;
      } else {
        const newRow = await this.prisma.employeeAllowance.create({
          data: {
            companyId: filter.companyId,
            employeeId: row.employeeId,
            allowanceTypeId: allowanceType.id,
            amount: row.totalAmount,
            effectiveFrom: periodStart,
            effectiveTo: periodEnd,
            status: 'ACTIVE',
          },
        });
        writtenRows.push({ employeeId: row.employeeId, allowanceId: newRow.id, amount: row.totalAmount });
        created++;
      }
    }

    await this.audit.log({
      userId,
      action: 'CREATE',
      entityType: 'PetroleumCommissionBatch',
      entityId: `${filter.companyId}-${preview.filter.periodStart}-${preview.filter.periodEnd}`,
      newValue: {
        companyId: filter.companyId,
        branchId: filter.branchId,
        periodStart: preview.filter.periodStart,
        periodEnd: preview.filter.periodEnd,
        created,
        updated,
        skipped,
        totalAmount: preview.totals.totalAmount,
      } as unknown as Record<string, unknown>,
    });

    return {
      ...preview,
      committed: { created, updated, skipped, totalAmount: preview.totals.totalAmount, allowanceTypeId: allowanceType.id, rows: writtenRows },
    };
  }

  private validateFilter(filter: CommissionFilter) {
    if (!filter.companyId) throw new BadRequestException('companyId is required');
    if (!filter.periodStart || !filter.periodEnd) throw new BadRequestException('periodStart and periodEnd are required');
    const start = new Date(filter.periodStart);
    const end = new Date(filter.periodEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('periodStart and periodEnd must be valid ISO dates');
    }
    if (start > end) throw new BadRequestException('periodStart must be on or before periodEnd');
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
