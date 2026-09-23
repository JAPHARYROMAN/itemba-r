import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAllowanceTypeDto } from './dto/update-allowance-type.dto';
import { UpdateDeductionTypeDto } from '../deduction-types/dto/update-deduction-type.dto';
import { AllowanceTypesService } from './allowance-types.service';
import { DeductionTypesService } from '../deduction-types/deduction-types.service';
const user = { id: 'operator', companyId: 'company', roleScopes: ['COMPANY'], companyAccess: [] };
describe.each(['allowance', 'deduction'])('%s type UI contracts', (kind) => {
  function setup() {
    const delegate = {
      findFirst: jest.fn().mockResolvedValue({ id: 'type', companyId: 'company' }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({ id: 'type' }),
    };
    const prisma = { [kind + 'Type']: delegate },
      audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service =
      kind === 'allowance'
        ? new AllowanceTypesService(prisma as never, audit as never)
        : new DeductionTypesService(prisma as never, audit as never);
    return { service, delegate };
  }
  it('accepts explicit nullable defaults and preserves omitted fields', async () => {
    const payload = {
      defaultAmount: null,
      ...(kind === 'deduction' ? { defaultPercentage: null } : {}),
    };
    const dto =
      kind === 'allowance'
        ? plainToInstance(UpdateAllowanceTypeDto, payload)
        : plainToInstance(UpdateDeductionTypeDto, payload);
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    expect(dto).toEqual(payload);
    const { service, delegate } = setup();
    await service.update('type', dto, user);
    expect(delegate.update).toHaveBeenCalledWith({ where: { id: 'type' }, data: payload });
  });
  it('keeps company scope and matching totals when searching page two', async () => {
    const { service, delegate } = setup();
    await service.findAll(user, { page: 2, limit: 20, companyId: 'company', search: 'Example' });
    const args = delegate.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 20,
      take: 20,
      where: {
        deletedAt: null,
        companyId: 'company',
        name: { contains: 'Example', mode: 'insensitive' },
      },
    });
    expect(delegate.count).toHaveBeenCalledWith({ where: args.where });
    await expect(service.findAll(user, { companyId: 'foreign' })).rejects.toThrow();
    expect(delegate.findMany).toHaveBeenCalledTimes(1);
  });
});
