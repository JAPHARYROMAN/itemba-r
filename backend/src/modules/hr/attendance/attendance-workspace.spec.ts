import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AttendanceService } from './attendance.service';
import { AttendanceQueryDto } from '../../../common/dto/resource-query.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';

const user = { id: 'manager', companyId: 'company-a', role: { scope: 'COMPANY' } };
describe('Attendance workspace', () => {
  it('keeps search, dates, status and pagination inside company and employee scope', async () => {
    const delegate = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const service = new AttendanceService(
      { attendanceRecord: delegate } as never,
      {} as never,
      {} as never,
    );
    const query = plainToInstance(AttendanceQueryDto, {
      search: ' Alex ',
      page: 2,
      limit: 20,
      employeeId: 'employee',
      companyId: 'company-a',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-17',
      attendanceStatus: 'PRESENT',
    });
    expect(await validate(query, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    await service.findAll(user, query);
    const args = delegate.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 20,
      take: 20,
      where: {
        companyId: 'company-a',
        employeeId: 'employee',
        deletedAt: null,
        attendanceStatus: 'PRESENT',
        attendanceDate: {
          gte: new Date('2026-09-01T00:00:00Z'),
          lte: new Date('2026-09-17T23:59:59.999Z'),
        },
      },
    });
    expect(args.where.AND[0].OR).toContainEqual({
      employee: { fullName: { contains: 'Alex', mode: 'insensitive' } },
    });
    expect(delegate.count).toHaveBeenCalledWith({ where: args.where });
    await expect(
      service.findAll(user, { search: 'Alex', companyId: 'company-b' }),
    ).rejects.toThrow();
  });
  function setup() {
    const record = {
      id: 'record',
      attendanceNumber: 'ATT-1',
      employeeId: 'employee',
      companyId: 'company-a',
      createdById: 'creator',
      attendanceDate: new Date('2026-09-17'),
      clockInTime: new Date('2026-09-17T08:00:00Z'),
      clockOutTime: new Date('2026-09-17T16:00:00Z'),
      attendanceStatus: 'PRESENT',
      totalHours: 8,
      source: 'MANUAL',
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
    };
    const delegate = {
      findFirst: jest.fn().mockResolvedValueOnce(record).mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(record),
    };
    return {
      delegate,
      service: new AttendanceService(
        { attendanceRecord: delegate } as never,
        { log: jest.fn() } as never,
        {} as never,
      ),
    };
  }
  it('clears both times explicitly and recalculates absence hours', async () => {
    const { service, delegate } = setup();
    const dto = plainToInstance(UpdateAttendanceDto, {
      clockInTime: null,
      clockOutTime: null,
      attendanceStatus: 'ABSENT',
    });
    expect(await validate(dto)).toHaveLength(0);
    await service.update('record', dto, user);
    expect(delegate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clockInTime: null,
          clockOutTime: null,
          totalHours: 0,
          attendanceStatus: 'ABSENT',
        }),
      }),
    );
  });
  it('retains omitted times and hours on notes-only edits', async () => {
    const { service, delegate } = setup();
    await service.update('record', { notes: 'Corrected note' }, user);
    expect(delegate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clockInTime: undefined,
          clockOutTime: undefined,
          totalHours: 8,
        }),
      }),
    );
  });
  it('rejects clearing arrival while departure remains', async () => {
    const { service, delegate } = setup();
    await expect(
      service.update('record', { clockInTime: null, attendanceStatus: 'ABSENT' }, user),
    ).rejects.toThrow('Clock-out requires a clock-in');
    expect(delegate.update).not.toHaveBeenCalled();
  });
  it('calculates an overnight interval from complete timestamps', async () => {
    const { service, delegate } = setup();
    await service.update(
      'record',
      { clockInTime: '2026-09-17T22:00:00+03:00', clockOutTime: '2026-09-18T06:00:00+03:00' },
      user,
    );
    expect(delegate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clockInTime: new Date('2026-09-17T19:00:00Z'),
          clockOutTime: new Date('2026-09-18T03:00:00Z'),
          totalHours: 8,
        }),
      }),
    );
  });
});
