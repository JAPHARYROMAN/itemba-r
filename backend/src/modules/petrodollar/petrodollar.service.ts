import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateReportingStationDto,
  ReportingStationDetailsDto,
  CreateReportingPumpDto,
  CreateReportingTankDto,
  ReopenFuelReportDto,
  SaveFuelReportDto,
  ReportingConfigurationRevisionDto,
  UpdateReportingTankDto,
  UpdateReportingPumpDto,
} from '../fuel-reporting/fuel-reporting.dto';
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
    const data = await this.fuel.bootstrap(user, pinned.id);
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

  async stations(user: AuthUser) {
    const pinned = await this.pinned();
    const data = await this.fuel.stations(user, pinned.id);
    const divisions = data.divisions.filter((division) => division.companyId === pinned.id);
    const ids = new Set(divisions.map((division) => division.id));
    return {
      companies: data.companies.filter((company) => company.id === pinned.id),
      divisions,
      stations: data.stations.filter((station) => ids.has(station.divisionId)),
    };
  }

  async createStation(user: AuthUser, dto: CreateReportingStationDto) {
    const pinned = await this.pinned();
    const division = await this.prisma.division.findFirst({
      where: { id: dto.divisionId },
      select: { companyId: true },
    });
    if (division && division.companyId !== pinned.id)
      throw new NotFoundException('Division not found.');
    return this.fuel.createStation(user, dto);
  }

  async updateStation(user: AuthUser, id: string, dto: ReportingStationDetailsDto) {
    await this.assertPinnedBranch(id);
    return this.fuel.updateStation(user, id, dto);
  }

  async setStationActive(user: AuthUser, id: string, active: boolean) {
    await this.assertPinnedBranch(id);
    return this.fuel.setStationActive(user, id, active);
  }

  async createPump(user: AuthUser, dto: CreateReportingPumpDto) {
    await this.assertPinnedBranch(dto.branchId);
    return this.fuel.createPump(user, dto);
  }

  async deactivatePump(user: AuthUser, id: string) {
    const pump = await this.prisma.fuelPump.findUnique({
      where: { id },
      select: { branchId: true },
    });
    if (pump) await this.assertPinnedBranch(pump.branchId);
    return this.fuel.deactivatePump(user, id);
  }

  async createTank(user: AuthUser, dto: CreateReportingTankDto) {
    await this.assertPinnedBranch(dto.branchId);
    return this.fuel.createTank(user, dto);
  }

  private async assertPinnedTank(id: string) {
    const tank = await this.prisma.fuelTank.findUnique({
      where: { id },
      select: { branchId: true },
    });
    if (!tank) throw new NotFoundException('Tank not found.');
    await this.assertPinnedBranch(tank.branchId);
  }

  private async assertPinnedPump(id: string) {
    const pump = await this.prisma.fuelPump.findUnique({
      where: { id },
      select: { branchId: true },
    });
    if (!pump) throw new NotFoundException('Pump not found.');
    await this.assertPinnedBranch(pump.branchId);
  }

  async updateTank(user: AuthUser, id: string, dto: UpdateReportingTankDto) {
    await this.assertPinnedTank(id);
    return this.fuel.updateTank(user, id, dto);
  }

  async deleteTank(user: AuthUser, id: string, dto: ReportingConfigurationRevisionDto) {
    await this.assertPinnedTank(id);
    return this.fuel.deleteTank(user, id, dto);
  }

  async restoreTank(user: AuthUser, id: string, dto: ReportingConfigurationRevisionDto) {
    await this.assertPinnedTank(id);
    return this.fuel.restoreTank(user, id, dto);
  }

  async updatePump(user: AuthUser, id: string, dto: UpdateReportingPumpDto) {
    await this.assertPinnedPump(id);
    return this.fuel.updatePump(user, id, dto);
  }

  async deletePump(user: AuthUser, id: string, dto: ReportingConfigurationRevisionDto) {
    await this.assertPinnedPump(id);
    return this.fuel.deactivatePump(user, id, dto);
  }

  async restorePump(user: AuthUser, id: string, dto: ReportingConfigurationRevisionDto) {
    await this.assertPinnedPump(id);
    return this.fuel.restorePump(user, id, dto);
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
