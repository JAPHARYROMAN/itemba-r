import { NotFoundException } from '@nestjs/common';
import { PayslipsService } from './payslips.service';

function makeEntry(overrides: Partial<any> = {}) {
  return {
    id: 'entry-1',
    companyId: 'company-1',
    basePay: 100,
    attendancePay: 0,
    overtimePay: 0,
    totalAllowances: 0,
    grossPay: 100,
    totalDeductions: 0,
    netPay: 100,
    daysWorked: null,
    overtimeHours: null,
    status: 'FINALIZED',
    employee: { id: 'emp-1' },
    company: { id: 'company-1', name: 'Company 1' },
    payrollRun: { id: 'run-1', payrollRunNumber: 'PR-1', runDate: new Date(), payrollPeriod: null },
    allowances: [],
    deductions: [],
    statutoryLines: [],
    ...overrides,
  };
}

function makeService(entry: any = makeEntry()) {
  const prisma = {
    payrollEntry: {
      findFirst: jest.fn(async ({ where }: any) => {
        const companyWhere = where.companyId;
        if (companyWhere && typeof companyWhere === 'object' && Array.isArray(companyWhere.in)) {
          return companyWhere.in.includes(entry.companyId) ? entry : null;
        }
        if (companyWhere && companyWhere !== entry.companyId) return null;
        if (Array.isArray(where.id?.in)) return null;
        return entry;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        const companyWhere = where.companyId;
        if (companyWhere && typeof companyWhere === 'object' && Array.isArray(companyWhere.in)) {
          return companyWhere.in.includes(entry.companyId) ? [{ id: entry.id }] : [];
        }
        if (companyWhere && companyWhere !== entry.companyId) return [];
        return [{ id: entry.id }];
      }),
    },
  } as any;
  const service = new PayslipsService(prisma);
  return { service, prisma };
}

describe('PayslipsService company scoping', () => {
  it('returns the payslip when the requesting user belongs to the payroll entry company', async () => {
    const { service } = makeService();
    const user = { id: 'user-1', companyId: 'company-1', companyAccess: [] } as any;

    const result = await service.getPayslip('entry-1', user);

    expect(result.entry.id).toBe('entry-1');
  });

  it('throws NotFoundException when the payroll entry belongs to a company outside the user scope', async () => {
    const { service } = makeService();
    const user = { id: 'user-2', companyId: 'company-2', companyAccess: [] } as any;

    await expect(service.getPayslip('entry-1', user)).rejects.toThrow(NotFoundException);
  });

  it('scopes getPayslipsForRun to the requesting user company', async () => {
    const { service, prisma } = makeService();
    const user = { id: 'user-1', companyId: 'company-1', companyAccess: [] } as any;

    await service.getPayslipsForRun('run-1', user);

    expect(prisma.payrollEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          payrollRunId: 'run-1',
          companyId: { in: ['company-1'] },
        }),
      }),
    );
  });
});
