import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateReportingStationDto,
  CreateReportingPumpDto,
  CreateReportingTankDto,
  ReopenFuelReportDto,
  SaveFuelReportDto,
} from '../fuel-reporting/fuel-reporting.dto';
import { FuelReportingService } from '../fuel-reporting/fuel-reporting.service';
import { PETRODOLLAR_COMPANY_CODE, PetroDollarService } from './petrodollar.service';

const mwanjalisi = '5a1f0000-0000-4000-8000-000000000001';
const other = '5a1f0000-0000-4000-8000-000000000002';
const ownBranch = 'b0000000-0000-4000-8000-000000000001';
const foreignBranch = 'b0000000-0000-4000-8000-000000000002';
const report = 'c0000000-0000-4000-8000-000000000001';
const user = { id: 'manager', roles: ['BRANCH_MANAGER'], permissions: [] } as unknown as AuthUser;

describe('PetroDollar company pin', () => {
  const prisma = {
    company: { findFirst: jest.fn() },
    branch: { findFirst: jest.fn() },
    division: { findFirst: jest.fn() },
    fuelPump: { findUnique: jest.fn() },
    fuelReport: { findUnique: jest.fn() },
  };
  const fuel = {
    bootstrap: jest.fn(),
    workspace: jest.fn(),
    history: jest.fn(),
    revisions: jest.fn(),
    save: jest.fn(),
    reopen: jest.fn(),
    stations: jest.fn(),
    createStation: jest.fn(),
    updateStation: jest.fn(),
    setStationActive: jest.fn(),
    createPump: jest.fn(),
    deactivatePump: jest.fn(),
    createTank: jest.fn(),
  };
  let service: PetroDollarService;
  const companyOf = { [ownBranch]: mwanjalisi, [foreignBranch]: other } as Record<string, string>;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new PetroDollarService(
      prisma as unknown as PrismaService,
      fuel as unknown as FuelReportingService,
    );
    prisma.company.findFirst.mockResolvedValue({
      id: mwanjalisi,
      code: PETRODOLLAR_COMPANY_CODE,
      name: 'Mwanjalisi Oil',
    });
    prisma.branch.findFirst.mockImplementation(({ where }) =>
      Promise.resolve(
        companyOf[where.id] ? { division: { companyId: companyOf[where.id] } } : null,
      ),
    );
    prisma.fuelReport.findUnique.mockResolvedValue({ branchId: foreignBranch });
  });

  it('resolves the company by its code, never by name, and ignores inactive or deleted rows', async () => {
    fuel.bootstrap.mockResolvedValue({ canManage: false, canAdmin: false, branches: [] });
    await service.bootstrap(user);
    expect(prisma.company.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { code: 'MWANJALISI', deletedAt: null, status: 'ACTIVE' },
      }),
    );
  });

  it('lists only Mwanjalisi stations, even when the user can see other companies', async () => {
    fuel.bootstrap.mockResolvedValue({
      canManage: true,
      canAdmin: false,
      branches: [
        {
          id: ownBranch,
          name: 'Mpemba',
          companyId: mwanjalisi,
          companyName: 'x',
          companyCode: 'M',
        },
        { id: foreignBranch, name: 'Other', companyId: other, companyName: 'y', companyCode: 'O' },
      ],
    });
    const result = await service.bootstrap(user);
    expect(result.branches.map((b) => b.id)).toEqual([ownBranch]);
    expect(result.company).toEqual({
      id: mwanjalisi,
      code: 'MWANJALISI',
      name: 'Mwanjalisi Oil',
    });
    expect(result).toMatchObject({ canManage: true, canAdmin: false });
  });

  it('refuses another company’s station on every branch-bound call as if it did not exist', async () => {
    const payload = { branchId: foreignBranch } as SaveFuelReportDto;
    await expect(
      service.workspace(user, foreignBranch, '2026-09-30', 'DAY'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.history(user, foreignBranch)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.save(user, payload)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.revisions(user, report)).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.reopen(user, report, { reason: 'fix', version: 1 } as ReopenFuelReportDto),
    ).rejects.toBeInstanceOf(NotFoundException);
    for (const call of Object.values(fuel)) expect(call).not.toHaveBeenCalled();
  });

  it('delegates a Mwanjalisi station to Fuel Reporting, which keeps its own access rules', async () => {
    const dto = { branchId: ownBranch } as SaveFuelReportDto;
    prisma.fuelReport.findUnique.mockResolvedValue({ branchId: ownBranch });
    await service.workspace(user, ownBranch, '2026-09-30', 'NIGHT');
    await service.history(user, ownBranch, 'cursor');
    await service.save(user, dto);
    await service.revisions(user, report);
    await service.reopen(user, report, { reason: 'fix', version: 2 } as ReopenFuelReportDto);
    expect(fuel.workspace).toHaveBeenCalledWith(user, ownBranch, '2026-09-30', 'NIGHT');
    expect(fuel.history).toHaveBeenCalledWith(user, ownBranch, 'cursor');
    expect(fuel.save).toHaveBeenCalledWith(user, dto);
    expect(fuel.revisions).toHaveBeenCalledWith(user, report);
    expect(fuel.reopen).toHaveBeenCalledWith(user, report, { reason: 'fix', version: 2 });
  });

  it('lets the delegate report malformed or unknown ids instead of masking them', async () => {
    await service.workspace(user, 'not-a-uuid', '2026-09-30', 'DAY');
    await service.history(user, 'b0000000-0000-4000-8000-0000000000ff');
    expect(fuel.workspace).toHaveBeenCalledTimes(1);
    expect(fuel.history).toHaveBeenCalledTimes(1);
    prisma.fuelReport.findUnique.mockResolvedValue(null);
    await expect(service.revisions(user, report)).rejects.toThrow('Report not found.');
  });

  it('fails as a configuration problem, not a permission problem, when the company is unavailable', async () => {
    prisma.company.findFirst.mockResolvedValue(null);
    await expect(service.bootstrap(user)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.workspace(user, ownBranch, '2026-09-30', 'DAY')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fuel.bootstrap).not.toHaveBeenCalled();
  });

  it('caches the resolved company briefly and re-resolves after it expires', async () => {
    fuel.bootstrap.mockResolvedValue({ canManage: false, canAdmin: false, branches: [] });
    jest.useFakeTimers();
    try {
      await service.bootstrap(user);
      await service.bootstrap(user);
      expect(prisma.company.findFirst).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(61_000);
      await service.bootstrap(user);
      expect(prisma.company.findFirst).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('filters station administration to Mwanjalisi divisions, including inactive stations', async () => {
    fuel.stations.mockResolvedValue({
      divisions: [
        { id: 'own', companyId: mwanjalisi },
        { id: 'foreign', companyId: other },
      ],
      stations: [
        { id: ownBranch, divisionId: 'own', isActive: false },
        { id: foreignBranch, divisionId: 'foreign' },
      ],
    });
    const data = await service.stations(user);
    expect(data.divisions).toEqual([{ id: 'own', companyId: mwanjalisi }]);
    expect(data.stations).toEqual([{ id: ownBranch, divisionId: 'own', isActive: false }]);
  });

  it('rejects foreign station and hardware mutations before delegation', async () => {
    prisma.division.findFirst.mockResolvedValue({ companyId: other });
    prisma.fuelPump.findUnique.mockResolvedValue({ branchId: foreignBranch });
    await expect(
      service.createStation(user, { divisionId: report } as CreateReportingStationDto),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updateStation(user, foreignBranch, { code: 'x', name: 'x', location: '' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.setStationActive(user, foreignBranch, false)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.setStationActive(user, foreignBranch, true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.createPump(user, { branchId: foreignBranch } as CreateReportingPumpDto),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deactivatePump(user, report)).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.createTank(user, { branchId: foreignBranch } as CreateReportingTankDto),
    ).rejects.toBeInstanceOf(NotFoundException);
    for (const call of Object.values(fuel)) expect(call).not.toHaveBeenCalled();
  });

  it('retains the engine’s administrator and organisation access enforcement', async () => {
    prisma.division.findFirst.mockResolvedValue({ companyId: mwanjalisi });
    prisma.fuelPump.findUnique.mockResolvedValue({ branchId: ownBranch });
    const station = { divisionId: report, code: 'new', name: 'New station', location: '' };
    await service.createStation(user, station);
    await service.updateStation(user, ownBranch, {
      code: 'updated',
      name: 'Updated station',
      location: '',
    });
    await service.setStationActive(user, ownBranch, false);
    await service.setStationActive(user, ownBranch, true);
    await service.createPump(user, { branchId: ownBranch } as CreateReportingPumpDto);
    await service.deactivatePump(user, report);
    await service.createTank(user, { branchId: ownBranch } as CreateReportingTankDto);
    expect(fuel.createStation).toHaveBeenCalledWith(user, station);
    expect(fuel.setStationActive).toHaveBeenCalledWith(user, ownBranch, false);
    expect(fuel.setStationActive).toHaveBeenCalledWith(user, ownBranch, true);
    expect(fuel.deactivatePump).toHaveBeenCalledWith(user, report);
    fuel.stations.mockRejectedValue(new ForbiddenException('Administrator required'));
    await expect(service.stations(user)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
