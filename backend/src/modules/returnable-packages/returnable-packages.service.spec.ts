import { Prisma } from '@prisma/client';
import { ReturnablePackagesService } from './returnable-packages.service';

/**
 * Builds a service whose `$transaction(fn)` simply runs the callback with a
 * `tx` client. The `returnablePackage.count` mock returns whatever the
 * per-test counter map dictates for a given `startsWith` filter, so we can
 * assert the generated packageCode without a real DB.
 */
function makeService(opts?: {
  countByPrefix?: Record<string, number>;
  createImpl?: (data: any, callIndex: number) => any;
}) {
  const countByPrefix = opts?.countByPrefix ?? {};
  let createCalls = 0;

  const returnablePackage = {
    count: jest.fn(async ({ where }: any) => {
      const startsWith: string = where?.packageCode?.startsWith ?? '';
      return countByPrefix[startsWith] ?? 0;
    }),
    create: jest.fn(async ({ data }: any) => {
      const idx = createCalls++;
      if (opts?.createImpl) return opts.createImpl(data, idx);
      return { id: `rp-${idx + 1}`, ...data };
    }),
  };

  const prisma = {
    returnablePackage,
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  } as any;

  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;

  const service = new ReturnablePackagesService(prisma, auditLogs);
  return { service, prisma, returnablePackage, auditLogs };
}

const baseDto = {
  companyId: '11111111-2222-3333-4444-555555555555',
  packageType: 'CRATE',
  name: 'Beer Crate',
  depositValue: 5000,
} as any;

describe('ReturnablePackagesService.create packageCode generation', () => {
  const year = new Date().getFullYear();

  it('embeds a company-derived prefix so the code is globally unique by construction', async () => {
    const { service, returnablePackage } = makeService();

    const record = await service.create(baseDto, 'user-1');

    // Company prefix = first 8 hex chars of the (dashless) company id, uppercased.
    expect(record.packageCode).toBe(`PKG-11111111-${year}-00001`);
    expect(returnablePackage.create).toHaveBeenCalledTimes(1);
  });

  it('produces different codes for two companies whose per-company counters are both at zero', async () => {
    const companyA = '11111111-0000-0000-0000-000000000000';
    const companyB = 'abcdef99-0000-0000-0000-000000000000';

    const svcA = makeService();
    const svcB = makeService();

    const recA = await svcA.service.create({ ...baseDto, companyId: companyA }, 'user-1');
    const recB = await svcB.service.create({ ...baseDto, companyId: companyB }, 'user-1');

    // Both are the "first" package for their company, yet the codes differ ->
    // no collision on the global @unique constraint.
    expect(recA.packageCode).toBe(`PKG-11111111-${year}-00001`);
    expect(recB.packageCode).toBe(`PKG-ABCDEF99-${year}-00001`);
    expect(recA.packageCode).not.toBe(recB.packageCode);
  });

  it('increments the per-company counter using the company-scoped prefix filter', async () => {
    const prefix = `PKG-11111111-${year}`;
    const { service, returnablePackage } = makeService({
      countByPrefix: { [prefix]: 4 },
    });

    const record = await service.create(baseDto, 'user-1');

    expect(returnablePackage.count).toHaveBeenCalledWith({
      where: { companyId: baseDto.companyId, packageCode: { startsWith: prefix } },
    });
    expect(record.packageCode).toBe(`${prefix}-00005`);
  });

  it('retries once on a P2002 unique-constraint violation instead of 500-ing', async () => {
    let attempts = 0;
    const { service, returnablePackage } = makeService({
      createImpl: (data, _idx) => {
        attempts++;
        if (attempts === 1) {
          throw new Prisma.PrismaClientKnownRequestError('unique', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        return { id: 'rp-retry', ...data };
      },
    });

    const record = await service.create(baseDto, 'user-1');

    expect(returnablePackage.create).toHaveBeenCalledTimes(2);
    expect(record.id).toBe('rp-retry');
  });

  it('rethrows non-P2002 errors without retrying', async () => {
    const { service, returnablePackage } = makeService({
      createImpl: () => {
        throw new Prisma.PrismaClientKnownRequestError('fk', {
          code: 'P2003',
          clientVersion: 'test',
        });
      },
    });

    await expect(service.create(baseDto, 'user-1')).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(returnablePackage.create).toHaveBeenCalledTimes(1);
  });
});
