import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { ReopenFuelReportDto, SaveFuelReportDto } from '../fuel-reporting/fuel-reporting.dto';
import { FuelReportingService } from '../fuel-reporting/fuel-reporting.service';

/** PetroDollar belongs to the group's fuel trading arm. Resolve it by code: names drift and ids differ per environment. */
export const PETRODOLLAR_COMPANY_CODE = 'MWANJALISI';
const CACHE_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A pinned view over Fuel Reporting. Every call is limited to one company that the
 * client cannot choose; the delegate still applies its own branch and permission rules.
 */
@Injectable()
export class PetroDollarService {
  private cached: { id: string; code: string; name: string; until: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fuel: FuelReportingService,
  ) {}

  private async pinned() {
    if (this.cached && this.cached.until > Date.now()) return this.cached;
    const company = await this.prisma.company.findFirst({
      where: { code: PETRODOLLAR_COMPANY_CODE, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, code: true, name: true },
    });
    if (!company) {
      this.cached = null;
      throw new ServiceUnavailableException(
        'PetroDollar is not set up: the Mwanjalisi company is missing or inactive.',
      );
    }
    return (this.cached = { ...company, until: Date.now() + CACHE_MS });
  }

  /** Another company's branch is reported as missing, exactly like a branch that does not exist. */
  private async assertPinnedBranch(branchId: unknown) {
    const pinned = await this.pinned();
    // Malformed or unknown ids fall through so the delegate returns its own error.
    if (typeof branchId !== 'string' || !UUID.test(branchId)) return;
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId },
      select: { division: { select: { companyId: true } } },
    });
    if (branch && branch.division.companyId !== pinned.id)
      throw new NotFoundException('Branch not found.');
  }

  private async assertPinnedReport(reportId: string) {
    const report = UUID.test(reportId)
      ? await this.prisma.fuelReport.findUnique({
          where: { id: reportId },
          select: { branchId: true },
        })
      : null;
    if (!report) throw new NotFoundException('Report not found.');
    await this.assertPinnedBranch(report.branchId);
  }

  async bootstrap(user: AuthUser) {
    const pinned = await this.pinned();
    const data = await this.fuel.bootstrap(user);
    return {
      company: { id: pinned.id, code: pinned.code, name: pinned.name },
      canManage: data.canManage,
      canAdmin: data.canAdmin,
      branches: data.branches.filter((branch) => branch.companyId === pinned.id),
    };
  }

  async workspace(user: AuthUser, branchId: string, businessDate: string, shift: string) {
    await this.assertPinnedBranch(branchId);
    return this.fuel.workspace(user, branchId, businessDate, shift);
  }

  async history(user: AuthUser, branchId: string, before?: string) {
    await this.assertPinnedBranch(branchId);
    return this.fuel.history(user, branchId, before);
  }

  async revisions(user: AuthUser, id: string) {
    await this.assertPinnedReport(id);
    return this.fuel.revisions(user, id);
  }

  async save(user: AuthUser, dto: SaveFuelReportDto) {
    await this.assertPinnedBranch(dto.branchId);
    return this.fuel.save(user, dto);
  }

  async reopen(user: AuthUser, id: string, dto: ReopenFuelReportDto) {
    await this.assertPinnedReport(id);
    return this.fuel.reopen(user, id, dto);
  }
}
