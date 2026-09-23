import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { calculateReport, ReportCatalog } from './fuel-reporting.calculate';
import {
  CreateReportingPumpDto,
  CreateReportingTankDto,
  CreateReportingStationDto,
  ReportingStationDetailsDto,
  ReopenFuelReportDto,
  ReportPayloadDto,
  SaveFuelReportDto,
} from './fuel-reporting.dto';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const rank = (access: string) => ({ READ: 1, WRITE: 2, MANAGE: 3 })[access] ?? 0;
type Database = Prisma.TransactionClient;

@Injectable()
export class FuelReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CompanyScopeService,
    private readonly audit: AuditLogsService,
  ) {}

  isAdmin(user: AuthUser) {
    return (
      user.roles.includes('GROUP_SUPER_ADMIN') && user.permissions.includes('fuel_reporting.admin')
    );
  }

  private assertManager(user: AuthUser) {
    if (!this.isAdmin(user) && !user.roles.includes('BRANCH_MANAGER'))
      throw new ForbiddenException('Only a station branch manager can submit fuel reports.');
    if (!user.permissions.includes('fuel_reporting.manage'))
      throw new ForbiddenException('Fuel reporting management permission required.');
  }

  private assertAdmin(user: AuthUser) {
    if (!this.isAdmin(user))
      throw new ForbiddenException('Only an admin can configure stations, pumps or tanks.');
  }

  private async branch(user: AuthUser, branchId: string, write = false) {
    if (
      typeof branchId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(branchId)
    )
      throw new BadRequestException('Select a valid branch.');
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        type: 'FUEL_STATION',
        deletedAt: null,
        isActive: true,
        division: { deletedAt: null, isActive: true },
      },
      include: { division: { include: { company: true } } },
    });
    if (!branch || branch.division.company.deletedAt)
      throw new NotFoundException('Branch not found.');
    // Even when a branch manager has company membership, that does not grant
    // authority to enter another station's report.
    const restricted =
      !this.isAdmin(user) &&
      (user.roles.includes('BRANCH_MANAGER') || user.roleScopes?.every((s) => s === 'BRANCH'));
    if (restricted) {
      const access = user.branchAccess?.find((a) => a.branchId === branchId);
      if (!access || rank(access.accessLevel) < (write ? 2 : 1))
        throw new ForbiddenException('This station is not assigned to you.');
      await this.scope.assertCanAccessCompany(user, branch.division.companyId, AccessLevel.READ);
    } else {
      await this.scope.assertCanAccessCompany(
        user,
        branch.division.companyId,
        write ? AccessLevel.WRITE : AccessLevel.READ,
      );
    }
    return branch;
  }

  async bootstrap(user: AuthUser) {
    const companyIds = await this.scope.accessibleCompanyIds(user);
    const restricted =
      !this.isAdmin(user) &&
      (user.roles.includes('BRANCH_MANAGER') || user.roleScopes?.every((s) => s === 'BRANCH'));
    const branches = await this.prisma.branch.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        type: 'FUEL_STATION',
        ...(restricted ? { id: { in: (user.branchAccess ?? []).map((a) => a.branchId) } } : {}),
        division: {
          deletedAt: null,
          isActive: true,
          companyId: { in: companyIds },
          company: { deletedAt: null },
        },
      },
      include: { division: { include: { company: true } } },
      orderBy: { name: 'asc' },
    });
    return {
      canManage:
        (this.isAdmin(user) || user.roles.includes('BRANCH_MANAGER')) &&
        user.permissions.includes('fuel_reporting.manage'),
      canAdmin: this.isAdmin(user),
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        companyId: b.division.companyId,
        companyName: b.division.company.name,
        companyCode: b.division.company.code,
      })),
    };
  }

  private async catalog(db: Database, branchId: string): Promise<ReportCatalog> {
    const [tanks, pumps] = await Promise.all([
      db.fuelTank.findMany({
        where: { branchId, deletedAt: null, status: 'ACTIVE' },
        include: { product: true },
        orderBy: { tankCode: 'asc' },
      }),
      db.fuelPump.findMany({
        where: { branchId, deletedAt: null, status: 'ACTIVE' },
        include: {
          nozzles: {
            where: { deletedAt: null, status: 'ACTIVE' },
            include: { product: true },
            orderBy: { nozzleCode: 'asc' },
          },
        },
        orderBy: { pumpCode: 'asc' },
      }),
    ]);
    return {
      tanks: tanks.map((t) => ({
        id: t.id,
        tankName: t.tankName,
        productId: t.productId,
        capacityLitres: Number(t.capacityLitres),
        productName: t.product.name,
      })),
      nozzles: pumps.flatMap((p) =>
        p.nozzles.map((n) => ({
          id: n.id,
          nozzleCode: n.nozzleCode,
          pumpId: p.id,
          pumpName: p.pumpName,
          productId: n.productId,
          productName: n.product.name,
        })),
      ),
    };
  }

  private date(value: string) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    )
      throw new BadRequestException('A valid business date is required.');
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Dar_es_Salaam',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    if (value > today) throw new BadRequestException('Future shifts cannot be reported.');
    return date;
  }

  async workspace(user: AuthUser, branchId: string, businessDate: string, shift: string) {
    const branch = await this.branch(user, branchId);
    const date = this.date(businessDate);
    if (!['DAY', 'NIGHT'].includes(shift)) throw new BadRequestException('Select Day or Night.');
    const [catalog, report, previous, daily, products, pumps] = await Promise.all([
      this.catalog(this.prisma, branchId),
      this.prisma.fuelReport.findUnique({
        where: { branchId_businessDate_shift: { branchId, businessDate: date, shift } },
      }),
      this.previous(this.prisma, branchId, date, shift),
      this.prisma.fuelReport.findMany({
        where: { branchId, businessDate: date },
        orderBy: { shift: 'asc' },
      }),
      this.prisma.product.findMany({
        where: { companyId: branch.division.companyId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.fuelPump.findMany({
        where: { branchId, deletedAt: null },
        select: { id: true, pumpCode: true, pumpName: true, status: true },
        orderBy: { pumpCode: 'asc' },
      }),
    ]);
    return { catalog, report, previous, daily, products, pumps };
  }

  private previous(db: Database, branchId: string, date: Date, shift: string) {
    return db.fuelReport.findFirst({
      where: {
        branchId,
        status: 'CLOSED',
        OR: [
          { businessDate: { lt: date } },
          ...(shift === 'NIGHT' ? [{ businessDate: date, shift: 'DAY' }] : []),
        ],
      },
      orderBy: [{ businessDate: 'desc' }, { shift: 'desc' }],
    });
  }

  async history(user: AuthUser, branchId: string, before?: string) {
    await this.branch(user, branchId);
    const cursor = before
      ? await this.prisma.fuelReport.findFirst({ where: { id: before, branchId } })
      : null;
    if (before && !cursor) throw new BadRequestException('Invalid report history cursor.');
    return this.prisma.fuelReport.findMany({
      where: {
        branchId,
        ...(cursor
          ? {
              OR: [
                { businessDate: { lt: cursor.businessDate } },
                { businessDate: cursor.businessDate, shift: { lt: cursor.shift } },
              ],
            }
          : {}),
      },
      orderBy: [{ businessDate: 'desc' }, { shift: 'desc' }],
      take: 50,
    });
  }

  async revisions(user: AuthUser, id: string) {
    const report = await this.prisma.fuelReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found.');
    await this.branch(user, report.branchId);
    return this.prisma.fuelReportRevision.findMany({
      where: { reportId: id },
      orderBy: { version: 'desc' },
    });
  }

  // The branch lock serializes closure, baseline selection and configuration
  // changes across both shifts; the version rejects stale browser saves.
  private async lock(db: Database, branchId: string, allowInactive = false) {
    const rows = await db.$queryRaw<
      { isActive: boolean; deletedAt: Date | null }[]
    >`SELECT "isActive", "deletedAt" FROM "branches" WHERE "id" = ${branchId} FOR UPDATE`;
    if (!rows.length || rows[0].deletedAt || (!allowInactive && !rows[0].isActive))
      throw new ConflictException('This station is no longer active. Reload the station list.');
  }

  async save(user: AuthUser, dto: SaveFuelReportDto) {
    this.assertManager(user);
    const branch = await this.branch(user, dto.branchId, true);
    const businessDate = this.date(dto.businessDate);
    return this.prisma.$transaction(async (db) => {
      await this.lock(db, dto.branchId);
      const where = {
        branchId_businessDate_shift: { branchId: dto.branchId, businessDate, shift: dto.shift },
      };
      const existing = await db.fuelReport.findUnique({ where });
      if ((existing?.version ?? 0) !== dto.version)
        throw new ConflictException('This report changed in another window. Reload before saving.');
      if (existing?.status === 'CLOSED')
        throw new ConflictException('Reopen the report with a correction reason before editing.');
      // Freeze the physical register for a report. Later admin changes apply to
      // new shifts, while corrections retain the pumps/tanks actually reported.
      const catalog = existing
        ? (existing.payload as unknown as { catalog: ReportCatalog }).catalog
        : await this.catalog(db, dto.branchId);
      if (!catalog.tanks.length || !catalog.nozzles.length) {
        throw new BadRequestException(
          'An admin must configure the branch tanks and pumps before its first report.',
        );
      }
      const previous = await this.previous(db, dto.branchId, businessDate, dto.shift);
      if (dto.payload.documentIds.length) {
        const documents = await db.document.count({
          where: {
            id: { in: dto.payload.documentIds },
            companyId: branch.division.companyId,
            branchId: branch.id,
            deletedAt: null,
          },
        });
        if (documents !== new Set(dto.payload.documentIds).size)
          throw new BadRequestException('Attachments must belong to this branch.');
      }
      const summary = calculateReport(
        dto.payload,
        catalog,
        previous?.payload as unknown as ReportPayloadDto,
      );
      if (dto.close) {
        if (summary.issues.length) throw new BadRequestException(summary.issues);
        const later = await db.fuelReport.findFirst({
          where: {
            branchId: dto.branchId,
            status: 'CLOSED',
            OR: [
              { businessDate: { gt: businessDate } },
              ...(dto.shift === 'DAY' ? [{ businessDate, shift: 'NIGHT' }] : []),
            ],
          },
        });
        if (later)
          throw new ConflictException(
            'A later shift is already closed. Close reports in business-date order to preserve stock continuity.',
          );
        const earlierDraft = await db.fuelReport.findFirst({
          where: {
            branchId: dto.branchId,
            status: 'DRAFT',
            OR: [
              { businessDate: { lt: businessDate } },
              ...(dto.shift === 'NIGHT' ? [{ businessDate, shift: 'DAY' }] : []),
            ],
          },
        });
        if (earlierDraft)
          throw new ConflictException('Complete the earlier draft shift before closing this one.');
      }
      const version = dto.version + 1;
      const payload = json({
        ...dto.payload,
        catalog,
        branchName: branch.name,
        companyName: branch.division.company.name,
        previousReportId: previous?.id ?? null,
      });
      const data = {
        payload,
        summary: json(summary),
        version,
        status: dto.close ? 'CLOSED' : 'DRAFT',
        closedAt: dto.close ? new Date() : null,
      };
      const report = existing
        ? await db.fuelReport.update({ where, data })
        : await db.fuelReport.create({
            data: {
              ...data,
              branchId: dto.branchId,
              companyId: branch.division.companyId,
              businessDate,
              shift: dto.shift,
            },
          });
      await db.fuelReportRevision.create({
        data: {
          reportId: report.id,
          version,
          action: dto.close ? 'CLOSE' : 'SAVE',
          authorId: user.id,
          authorName: user.fullName || user.email,
          payload,
          summary: json(summary),
        },
      });
      return report;
    });
  }

  async reopen(user: AuthUser, id: string, dto: ReopenFuelReportDto) {
    this.assertManager(user);
    if (!dto.reason.trim())
      throw new BadRequestException('Explain why this report needs a correction.');
    const report = await this.prisma.fuelReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found.');
    await this.branch(user, report.branchId, true);
    return this.prisma.$transaction(async (db) => {
      await this.lock(db, report.branchId);
      const current = await db.fuelReport.findUniqueOrThrow({ where: { id } });
      if (current.version !== dto.version || current.status !== 'CLOSED')
        throw new ConflictException('The report changed; reload before reopening.');
      const latest = await db.fuelReport.findFirst({
        where: { branchId: report.branchId, status: 'CLOSED' },
        orderBy: [{ businessDate: 'desc' }, { shift: 'desc' }],
      });
      if (latest?.id !== id)
        throw new ConflictException(
          'Reopen later shifts first so their opening balances can be corrected as well.',
        );
      const updated = await db.fuelReport.update({
        where: { id },
        data: { status: 'DRAFT', closedAt: null, version: { increment: 1 } },
      });
      await db.fuelReportRevision.create({
        data: {
          reportId: id,
          version: updated.version,
          action: 'REOPEN',
          reason: dto.reason.trim(),
          payload: json(current.payload),
          summary: json(current.summary),
          authorId: user.id,
          authorName: user.fullName || user.email,
        },
      });
      return updated;
    });
  }

  async stations(user: AuthUser) {
    this.assertAdmin(user);
    const companyIds = await this.scope.accessibleCompanyIds(user);
    const divisions = await this.prisma.division.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        companyId: { in: companyIds },
        company: { deletedAt: null },
      },
      include: { company: true },
      orderBy: { name: 'asc' },
    });
    const stations = await this.prisma.branch.findMany({
      where: {
        deletedAt: null,
        type: 'FUEL_STATION',
        divisionId: { in: divisions.map((d) => d.id) },
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        divisionId: true,
        code: true,
        name: true,
        location: true,
        isActive: true,
      },
    });
    return {
      divisions: divisions.map((d) => ({
        id: d.id,
        name: d.name,
        companyId: d.companyId,
        companyName: d.company.name,
        companyCode: d.company.code,
      })),
      stations,
    };
  }

  private stationDetails(dto: ReportingStationDetailsDto) {
    if (!dto.code.trim() || !dto.name.trim())
      throw new BadRequestException('Station code and name are required.');
    return {
      code: dto.code.trim().toUpperCase(),
      name: dto.name.trim(),
      location: dto.location.trim() || null,
    };
  }

  private async stationForAdmin(user: AuthUser, id: string) {
    this.assertAdmin(user);
    const station = await this.prisma.branch.findFirst({
      where: {
        id,
        type: 'FUEL_STATION',
        deletedAt: null,
        division: { deletedAt: null, isActive: true, company: { deletedAt: null } },
      },
      include: { division: true },
    });
    if (!station) throw new NotFoundException('Station not found.');
    await this.scope.assertCanAccessCompany(user, station.division.companyId, AccessLevel.WRITE);
    return station;
  }

  private async uniqueStationCode(db: Database, divisionId: string, code: string, id?: string) {
    const duplicate = await db.branch.findFirst({
      where: {
        divisionId,
        code: { equals: code, mode: 'insensitive' },
        ...(id ? { id: { not: id } } : {}),
      },
    });
    if (duplicate)
      throw new ConflictException(
        'This station code already exists in the division. Use another code or restore the existing station.',
      );
  }

  async createStation(user: AuthUser, dto: CreateReportingStationDto) {
    this.assertAdmin(user);
    const division = await this.prisma.division.findFirst({
      where: { id: dto.divisionId, deletedAt: null, isActive: true, company: { deletedAt: null } },
    });
    if (!division) throw new BadRequestException('Select an active company division.');
    await this.scope.assertCanAccessCompany(user, division.companyId, AccessLevel.WRITE);
    const data = this.stationDetails(dto);
    const station = await this.prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT "id" FROM "divisions" WHERE "id" = ${division.id} FOR UPDATE`;
      await this.uniqueStationCode(db, division.id, data.code);
      return db.branch.create({ data: { ...data, divisionId: division.id, type: 'FUEL_STATION' } });
    });
    await this.audit.log({
      action: 'FUEL_REPORTING_STATION_CREATE',
      entityType: 'Branch',
      entityId: station.id,
      userId: user.id,
      companyId: division.companyId,
      newValue: json(station) as Record<string, unknown>,
    });
    return station;
  }

  async updateStation(user: AuthUser, id: string, dto: ReportingStationDetailsDto) {
    const existing = await this.stationForAdmin(user, id);
    const data = this.stationDetails(dto);
    const station = await this.prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT "id" FROM "divisions" WHERE "id" = ${existing.divisionId} FOR UPDATE`;
      await this.lock(db, id, true);
      await this.uniqueStationCode(db, existing.divisionId, data.code, id);
      return db.branch.update({ where: { id }, data });
    });
    await this.audit.log({
      action: 'FUEL_REPORTING_STATION_UPDATE',
      entityType: 'Branch',
      entityId: id,
      userId: user.id,
      companyId: existing.division.companyId,
      oldValue: json(existing) as Record<string, unknown>,
      newValue: json(station) as Record<string, unknown>,
    });
    return station;
  }

  async setStationActive(user: AuthUser, id: string, isActive: boolean) {
    const existing = await this.stationForAdmin(user, id);
    const station = await this.prisma.$transaction(async (db) => {
      await this.lock(db, id, true);
      if (!isActive && (await db.fuelReport.count({ where: { branchId: id, status: 'DRAFT' } })))
        throw new ConflictException('Close this station’s draft reports before removing it.');
      return db.branch.update({ where: { id }, data: { isActive } });
    });
    await this.audit.log({
      action: isActive ? 'FUEL_REPORTING_STATION_RESTORE' : 'FUEL_REPORTING_STATION_DEACTIVATE',
      entityType: 'Branch',
      entityId: id,
      userId: user.id,
      companyId: existing.division.companyId,
      oldValue: json(existing) as Record<string, unknown>,
      newValue: json(station) as Record<string, unknown>,
    });
    return station;
  }

  async createPump(user: AuthUser, dto: CreateReportingPumpDto) {
    this.assertAdmin(user);
    const branch = await this.branch(user, dto.branchId, true);
    if (
      !dto.code.trim() ||
      !dto.name.trim() ||
      !dto.nozzles.length ||
      dto.nozzles.some((n) => !n.code.trim())
    )
      throw new BadRequestException('Enter a pump code, name and at least one nozzle.');
    if (new Set(dto.nozzles.map((n) => n.code.trim())).size !== dto.nozzles.length)
      throw new BadRequestException('Nozzle codes must be unique within the pump.');
    const pump = await this.prisma.$transaction(async (db) => {
      await this.lock(db, branch.id);
      if (
        await db.fuelPump.findFirst({
          where: { branchId: branch.id, pumpCode: dto.code.trim(), deletedAt: { equals: null } },
        })
      )
        throw new ConflictException('A pump with this code already exists.');
      const tanks = await db.fuelTank.findMany({
        where: {
          branchId: branch.id,
          status: 'ACTIVE',
          deletedAt: null,
          id: { in: dto.nozzles.map((n) => n.tankId) },
        },
      });
      if (dto.nozzles.some((n) => !tanks.some((t) => t.id === n.tankId)))
        throw new BadRequestException('Select an active branch tank for each nozzle.');
      return db.fuelPump.create({
        data: {
          companyId: branch.division.companyId,
          branchId: branch.id,
          divisionId: branch.divisionId,
          pumpCode: dto.code.trim(),
          pumpName: dto.name.trim(),
          nozzles: {
            create: dto.nozzles.map((n) => ({
              companyId: branch.division.companyId,
              branchId: branch.id,
              divisionId: branch.divisionId,
              tankId: n.tankId,
              productId: tanks.find((t) => t.id === n.tankId)!.productId,
              nozzleCode: n.code.trim(),
            })),
          },
        },
      });
    });
    await this.audit.log({
      action: 'FUEL_REPORTING_PUMP_CREATE',
      entityType: 'FuelPump',
      entityId: pump.id,
      userId: user.id,
      companyId: branch.division.companyId,
      newValue: json(pump) as Record<string, unknown>,
    });
    return pump;
  }

  async deactivatePump(user: AuthUser, id: string) {
    this.assertAdmin(user);
    const pump = await this.prisma.fuelPump.findFirst({ where: { id, deletedAt: null } });
    if (!pump) throw new NotFoundException('Pump not found.');
    const branch = await this.branch(user, pump.branchId, true);
    const updated = await this.prisma.$transaction(async (db) => {
      await this.lock(db, branch.id);
      const drafts = await db.fuelReport.count({ where: { branchId: branch.id, status: 'DRAFT' } });
      if (drafts)
        throw new ConflictException('Close the branch draft reports before removing a pump.');
      await db.fuelNozzle.updateMany({ where: { pumpId: id }, data: { status: 'INACTIVE' } });
      return db.fuelPump.update({ where: { id }, data: { status: 'INACTIVE' } });
    });
    await this.audit.log({
      action: 'FUEL_REPORTING_PUMP_DEACTIVATE',
      entityType: 'FuelPump',
      entityId: id,
      userId: user.id,
      companyId: branch.division.companyId,
      oldValue: json(pump) as Record<string, unknown>,
      newValue: json(updated) as Record<string, unknown>,
    });
    return updated;
  }

  async createTank(user: AuthUser, dto: CreateReportingTankDto) {
    this.assertAdmin(user);
    const branch = await this.branch(user, dto.branchId, true);
    if (!dto.code.trim() || !dto.name.trim())
      throw new BadRequestException('Tank code and name are required.');
    const product = await this.prisma.product.findFirst({
      where: {
        id: dto.productId,
        companyId: branch.division.companyId,
        deletedAt: null,
        status: 'ACTIVE',
      },
    });
    if (!product) throw new BadRequestException('Select a fuel product from this company.');
    const tank = await this.prisma.$transaction(async (db) => {
      await this.lock(db, branch.id);
      if (
        await db.fuelTank.findFirst({ where: { branchId: branch.id, tankCode: dto.code.trim() } })
      )
        throw new ConflictException('This tank code already exists.');
      return db.fuelTank.create({
        data: {
          companyId: branch.division.companyId,
          branchId: branch.id,
          divisionId: branch.divisionId,
          productId: product.id,
          tankName: dto.name.trim(),
          tankCode: dto.code.trim(),
          capacityLitres: dto.capacityLitres,
        },
      });
    });
    await this.audit.log({
      action: 'FUEL_REPORTING_TANK_CREATE',
      entityType: 'FuelTank',
      entityId: tank.id,
      userId: user.id,
      companyId: branch.division.companyId,
      newValue: json(tank) as Record<string, unknown>,
    });
    return tank;
  }
}
