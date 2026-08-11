import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccessLevel, CreditRiskRating, CreditStatus, Prisma } from '@prisma/client';
import { CustomerCreditProfilesService } from './customer-credit-profiles.service';

const user = { id: 'user-1' } as any;

// The real columns of CustomerCreditProfile (schema.prisma model
// CustomerCreditProfile). createdById is deliberately NOT here — it does not
// exist on the model and Prisma rejects it with a validation error.
const REAL_COLUMNS = new Set([
  'companyId',
  'customerId',
  'creditLimit',
  'currency',
  'paymentTermsDays',
  'riskRating',
  'creditStatus',
  'currentOutstanding',
  'overdueAmount',
  'lastReviewedAt',
  'reviewedById',
  'notes',
]);

function existingProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ccp-1',
    companyId: 'company-1',
    customerId: 'customer-1',
    creditLimit: new Prisma.Decimal(1000),
    currency: 'TZS',
    paymentTermsDays: 30,
    riskRating: CreditRiskRating.UNKNOWN,
    creditStatus: CreditStatus.ACTIVE,
    currentOutstanding: new Prisma.Decimal(0),
    overdueAmount: new Prisma.Decimal(0),
    lastReviewedAt: null,
    reviewedById: null,
    notes: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeService(
  opts: {
    profile?: Record<string, any>;
    customer?: Record<string, any> | null;
    accessibleCompanyIds?: string[];
    assertCanAccessCompany?: jest.Mock;
  } = {},
) {
  const profileDelegate = {
    findFirst: jest.fn(async () => existingProfile()),
    findMany: jest.fn(async () => [existingProfile()]),
    count: jest.fn(async () => 1),
    create: jest.fn(async ({ data }: any) => ({ ...existingProfile(), ...data })),
    update: jest.fn(async ({ data }: any) => ({ ...existingProfile(), ...data })),
    ...opts.profile,
  };

  const customer =
    opts.customer === undefined ? { id: 'customer-1', companyId: 'company-1' } : opts.customer;

  const prisma: any = {
    customerCreditProfile: profileDelegate,
    customer: { findFirst: jest.fn(async () => customer) },
  };

  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = {
    assertCanAccessCompany: opts.assertCanAccessCompany ?? jest.fn().mockResolvedValue(undefined),
    accessibleCompanyIds: jest.fn().mockResolvedValue(opts.accessibleCompanyIds ?? ['company-1']),
  } as any;

  const service = new CustomerCreditProfilesService(prisma, auditLogs, companyScope);
  return { service, prisma, auditLogs, companyScope };
}

describe('CustomerCreditProfilesService.create — no phantom createdById column', () => {
  it('creates a profile without ever writing a createdById column', async () => {
    const { service, prisma } = makeService();

    await service.create(
      {
        companyId: 'company-1',
        customerId: 'customer-1',
        creditLimit: 5000,
        currency: 'TZS',
        paymentTermsDays: 45,
        riskRating: CreditRiskRating.LOW,
        creditStatus: CreditStatus.ACTIVE,
        // A malicious/legacy caller may still send createdById — it must be dropped.
        createdById: 'user-1',
      } as any,
      user,
    );

    expect(prisma.customerCreditProfile.create).toHaveBeenCalledTimes(1);
    const { data } = prisma.customerCreditProfile.create.mock.calls[0][0];
    expect(data).not.toHaveProperty('createdById');
    // Every key written must be a real column on the model.
    for (const key of Object.keys(data)) {
      expect(REAL_COLUMNS.has(key)).toBe(true);
    }
  });

  it('persists only whitelisted, coerced columns from the dto', async () => {
    const { service, prisma } = makeService();

    await service.create(
      {
        companyId: 'company-1',
        customerId: 'customer-1',
        creditLimit: 5000,
        currency: 'USD',
        paymentTermsDays: 60,
        riskRating: CreditRiskRating.HIGH,
        creditStatus: CreditStatus.SUSPENDED,
        notes: 'watchlist',
        // Unknown/unwritable fields must be silently ignored.
        id: 'attacker-supplied',
        deletedAt: new Date(),
        bogus: true,
      } as any,
      user,
    );

    const { data } = prisma.customerCreditProfile.create.mock.calls[0][0];
    expect(data.companyId).toBe('company-1');
    expect(data.customerId).toBe('customer-1');
    expect(data.creditLimit).toBeInstanceOf(Prisma.Decimal);
    expect(data.creditLimit.equals(new Prisma.Decimal(5000))).toBe(true);
    expect(data.currency).toBe('USD');
    expect(data.paymentTermsDays).toBe(60);
    expect(data.riskRating).toBe(CreditRiskRating.HIGH);
    expect(data.creditStatus).toBe(CreditStatus.SUSPENDED);
    expect(data.notes).toBe('watchlist');
    expect(data).not.toHaveProperty('id');
    expect(data).not.toHaveProperty('deletedAt');
    expect(data).not.toHaveProperty('bogus');
  });

  it('rejects when companyId is missing', async () => {
    const { service, prisma } = makeService();
    await expect(service.create({ customerId: 'customer-1' } as any, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.customerCreditProfile.create).not.toHaveBeenCalled();
  });

  it('rejects when customerId is missing', async () => {
    const { service, prisma } = makeService();
    await expect(service.create({ companyId: 'company-1' } as any, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.customerCreditProfile.create).not.toHaveBeenCalled();
  });

  it('authorizes WRITE against the supplied companyId before inserting', async () => {
    const assertCanAccessCompany = jest.fn().mockResolvedValue(undefined);
    const { service } = makeService({ assertCanAccessCompany });

    await service.create({ companyId: 'company-1', customerId: 'customer-1' } as any, user);

    expect(assertCanAccessCompany).toHaveBeenCalledWith(user, 'company-1', AccessLevel.WRITE);
  });

  it('rejects a customer that does not belong to the supplied company', async () => {
    const { service, prisma } = makeService({
      customer: { id: 'customer-1', companyId: 'company-2' },
    });

    await expect(
      service.create({ companyId: 'company-1', customerId: 'customer-1' } as any, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.customerCreditProfile.create).not.toHaveBeenCalled();
  });

  it('rejects a missing customer', async () => {
    const { service, prisma } = makeService({ customer: null });
    await expect(
      service.create({ companyId: 'company-1', customerId: 'ghost' } as any, user),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customerCreditProfile.create).not.toHaveBeenCalled();
  });

  it('rejects a negative creditLimit', async () => {
    const { service } = makeService();
    await expect(
      service.create(
        {
          companyId: 'company-1',
          customerId: 'customer-1',
          creditLimit: -1,
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CustomerCreditProfilesService.findOne — company scoping', () => {
  it('asserts READ access against the record company', async () => {
    const assertCanAccessCompany = jest.fn().mockResolvedValue(undefined);
    const { service } = makeService({ assertCanAccessCompany });
    await service.findOne('ccp-1', user);
    expect(assertCanAccessCompany).toHaveBeenCalledWith(user, 'company-1', AccessLevel.READ);
  });

  it('propagates a forbidden access assertion (cross-tenant read blocked)', async () => {
    const assertCanAccessCompany = jest.fn().mockRejectedValue(new NotFoundException('forbidden'));
    const { service } = makeService({ assertCanAccessCompany });
    await expect(service.findOne('ccp-1', user)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFound when the profile does not exist', async () => {
    const { service } = makeService({
      profile: { findFirst: jest.fn(async () => null) },
    });
    await expect(service.findOne('missing', user)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CustomerCreditProfilesService.update — scoping & immutable identity', () => {
  it('never writes createdById, companyId, or customerId on update', async () => {
    const { service, prisma } = makeService();

    await service.update(
      'ccp-1',
      {
        creditLimit: 9999,
        // These must all be ignored: identity is immutable, createdById is phantom.
        companyId: 'company-EVIL',
        customerId: 'customer-EVIL',
        createdById: 'user-EVIL',
      } as any,
      user,
    );

    const { data } = prisma.customerCreditProfile.update.mock.calls[0][0];
    expect(data).not.toHaveProperty('createdById');
    expect(data).not.toHaveProperty('companyId');
    expect(data).not.toHaveProperty('customerId');
    expect(data.creditLimit.equals(new Prisma.Decimal(9999))).toBe(true);
  });

  it('asserts WRITE on the record company before mutating', async () => {
    const assertCanAccessCompany = jest.fn().mockResolvedValue(undefined);
    const { service } = makeService({ assertCanAccessCompany });
    await service.update('ccp-1', { creditLimit: 10 } as any, user);
    expect(assertCanAccessCompany).toHaveBeenCalledWith(user, 'company-1', AccessLevel.WRITE);
  });

  it('is a no-op (returns existing) when the dto has no mutable fields', async () => {
    const { service, prisma } = makeService();
    const result = await service.update('ccp-1', {} as any, user);
    expect(prisma.customerCreditProfile.update).not.toHaveBeenCalled();
    expect(result.id).toBe('ccp-1');
  });
});
