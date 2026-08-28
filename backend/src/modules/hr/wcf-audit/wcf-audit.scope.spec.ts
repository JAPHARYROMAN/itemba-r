import { ForbiddenException } from '@nestjs/common';
import { WcfAuditService } from './wcf-audit.service';

const USER = {
  id: 'user-a',
  companyId: 'company-a',
  companyAccess: [],
  roleScopes: ['COMPANY'],
} as any;
const FILTER = { companyId: 'company-a', year: 2026, fromMonth: 1, toMonth: 12 };

describe('WcfAuditService read scope', () => {
  it('checks caller access before resolving the report company or payroll lines', async () => {
    const companyFindUnique = jest.fn();
    const linesFindMany = jest.fn();
    const denied = new ForbiddenException('foreign company');
    const companyScope = {
      assertCanAccessCompany: jest.fn().mockRejectedValue(denied),
    } as any;
    const service = new WcfAuditService(
      {
        company: { findUnique: companyFindUnique },
        payrollStatutoryLine: { findMany: linesFindMany },
      } as any,
      companyScope,
    );

    await expect(
      service.exposureRegister({ ...FILTER, companyId: 'company-b' }, USER),
    ).rejects.toBe(denied);
    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(USER, 'company-b');
    expect(companyFindUnique).not.toHaveBeenCalled();
    expect(linesFindMany).not.toHaveBeenCalled();
  });

  it('returns an explicitly company-bound header after access is granted', async () => {
    const companyScope = {
      assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new WcfAuditService(
      {
        company: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'company-a',
            name: 'Company A',
            profile: { tin: 'TIN-A' },
          }),
        },
        payrollStatutoryLine: { findMany: jest.fn().mockResolvedValue([]) },
      } as any,
      companyScope,
    );

    const result = await service.exposureRegister(FILTER, USER);

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(USER, 'company-a');
    expect(result.header).toEqual(
      expect.objectContaining({ companyId: 'company-a', companyName: 'Company A' }),
    );
  });
});
