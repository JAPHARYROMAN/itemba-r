import { ForbiddenException } from '@nestjs/common';
import { EmployeesService } from './employees.service';

const USER = {
  id: 'user-a',
  companyId: 'company-a',
  companyAccess: [],
  roleScopes: ['COMPANY'],
} as any;

describe('EmployeesService.findLinkableUsers scope', () => {
  it('rejects a foreign company before querying linkable users', async () => {
    const findMany = jest.fn();
    const service = new EmployeesService({ user: { findMany } } as any, {} as any);

    await expect(service.findLinkableUsers('company-b', undefined, USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns only active, unlinked users eligible for the authorized company', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'linkable-user-a' }]);
    const service = new EmployeesService({ user: { findMany } } as any, {} as any);

    await expect(service.findLinkableUsers('company-a', undefined, USER)).resolves.toEqual([
      { id: 'linkable-user-a' },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          status: 'ACTIVE',
          AND: expect.arrayContaining([{ hrEmployee: { is: null } }]),
        }),
      }),
    );
  });
});
