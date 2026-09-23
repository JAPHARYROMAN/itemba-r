import { DepartmentsService } from './departments.service';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

describe('Department workspace hierarchy changes', () => {
  const user = { id: 'manager', companyId: 'company-a', role: { scope: 'COMPANY' } };
  function setup() {
    const prisma = {
      department: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'dept',
          companyId: 'company-a',
          divisionId: 'old-division',
          branchId: 'old-branch',
        }),
        update: jest.fn().mockResolvedValue({ id: 'dept' }),
      },
      division: {
        findFirst: jest.fn().mockResolvedValue({ companyId: 'company-a', isActive: true }),
      },
      branch: {
        findFirst: jest.fn().mockResolvedValue({
          divisionId: 'old-division',
          isActive: true,
          division: { companyId: 'company-a', isActive: true, deletedAt: null },
        }),
      },
    };
    return {
      prisma,
      service: new DepartmentsService(prisma as never, { log: jest.fn() } as never),
    };
  }
  it('accepts explicit clearing and validates the resulting hierarchy instead of the previous assignment', async () => {
    const { service, prisma } = setup();
    const dto = plainToInstance(UpdateDepartmentDto, {
      divisionId: 'new-division',
      branchId: null,
    });
    expect(await validate(dto)).toHaveLength(0);
    await service.update('dept', dto, user);
    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
    expect(prisma.department.update).toHaveBeenCalledWith({ where: { id: 'dept' }, data: dto });
  });
  it('still checks existing assignments when a field is omitted', async () => {
    const { service, prisma } = setup();
    await expect(service.update('dept', { divisionId: 'new-division' }, user)).rejects.toThrow(
      'selected division',
    );
    expect(prisma.department.update).not.toHaveBeenCalled();
  });
  it('rejects branches in a different company', async () => {
    const { service, prisma } = setup();
    prisma.branch.findFirst.mockResolvedValue({
      divisionId: 'foreign',
      isActive: true,
      division: { companyId: 'company-b', isActive: true, deletedAt: null },
    });
    await expect(
      service.update('dept', { divisionId: null, branchId: 'foreign' }, user),
    ).rejects.toThrow('selected company');
    expect(prisma.department.update).not.toHaveBeenCalled();
  });
});
