import { HrReportsService } from './hr-reports.service';

describe('HrReportsService.attendanceReport', () => {
  it('filters every attendance query by the Prisma attendanceDate field', async () => {
    const attendanceRecord = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { totalHours: null, overtimeHours: null, lateMinutes: null },
        _count: { id: 0 },
      }),
    };
    const service = new HrReportsService({ attendanceRecord } as any);
    const user = {
      companyId: 'company-1',
      companyAccess: [],
      roleScopes: [],
    } as any;

    await service.attendanceReport(user, {
      dateFrom: '2026-08-01T00:00:00.000Z',
      dateTo: '2026-08-31T23:59:59.999Z',
    });

    const expectedWhere = {
      deletedAt: null,
      companyId: { in: ['company-1'] },
      attendanceDate: {
        gte: new Date('2026-08-01T00:00:00.000Z'),
        lte: new Date('2026-08-31T23:59:59.999Z'),
      },
    };
    expect(attendanceRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(attendanceRecord.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(attendanceRecord.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(expectedWhere).not.toHaveProperty('date');
  });
});
