import { LoanStatus } from '@prisma/client';
import { LoansService } from './loans.service';

describe('LoansService.getUpcomingRepayments scope', () => {
  it('limits upcoming loans to the authenticated caller company ids', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'loan-a', companyId: 'company-a' }]);
    const companyScope = {
      accessibleCompanyIds: jest.fn().mockResolvedValue(['company-a']),
    } as any;
    const service = new LoansService(
      { loan: { findMany } } as any,
      {} as any,
      companyScope,
      {} as any,
      {} as any,
      {} as any,
    );
    const user = { id: 'user-a', companyId: 'company-a' } as any;

    await expect(service.getUpcomingRepayments(user, 30)).resolves.toEqual([
      { id: 'loan-a', companyId: 'company-a' },
    ]);
    expect(companyScope.accessibleCompanyIds).toHaveBeenCalledWith(user);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          status: LoanStatus.ACTIVE,
          companyId: { in: ['company-a'] },
        }),
      }),
    );
  });
});
