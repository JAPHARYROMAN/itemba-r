import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { CustomerSegmentsService } from './customer-segments.service';

function makeService() {
  const prisma: any = {
    customerSegment: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }: any) => ({ id: 'seg1', ...data })),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, companyId: 'c1', ...data })),
    },
    customer: {
      findFirst: jest.fn(),
    },
    customerSegmentMembership: {
      upsert: jest.fn(async () => ({ id: 'm1' })),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    // create() runs inside a $transaction; run the callback against the same
    // mock client so the create/generator spies are observable.
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: { in: ['c1'] } }),
  } as any;
  const codes = {
    next: jest.fn().mockResolvedValue('CUSTOMER-SEGMENT-2026-00001'),
  } as any;
  const service = new CustomerSegmentsService(prisma, auditLogs, companyScope, codes);
  return { service, prisma, companyScope, auditLogs, codes };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

const user = { id: 'u1' } as any;

describe('CustomerSegmentsService company scoping', () => {
  describe('findAll', () => {
    it('filters to the caller-accessible companies via companyWhereFor', async () => {
      const { service, prisma, companyScope } = makeService();

      await service.findAll({ companyId: 'c1' } as any, user);

      expect(companyScope.companyWhereFor).toHaveBeenCalledWith(user, 'c1');
      expect(prisma.customerSegment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null, companyId: { in: ['c1'] } }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns the record when the caller can READ its company', async () => {
      const { service, prisma, companyScope } = makeService();
      prisma.customerSegment.findFirst.mockResolvedValue({ id: 'seg1', companyId: 'c1' });

      const result = await service.findOne('seg1', user);

      expect(result).toEqual({ id: 'seg1', companyId: 'c1' });
      expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
        user,
        'c1',
        AccessLevel.READ,
      );
    });

    it('throws NotFound (no existence leak) for a foreign-tenant record', async () => {
      const { service, prisma, companyScope } = makeService();
      prisma.customerSegment.findFirst.mockResolvedValue({ id: 'seg1', companyId: 'other' });
      companyScope.assertCanAccessCompany.mockRejectedValueOnce(new ForbiddenException());

      await expect(service.findOne('seg1', user)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound when the record does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.customerSegment.findFirst.mockResolvedValue(null);

      await expect(service.findOne('missing', user)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('generates a globally-unique segmentCode server-side when none is supplied', async () => {
      const { service, prisma, companyScope, codes } = makeService();

      const result = await service.create(
        { companyId: 'c1', name: 'VIP', isActive: true } as any,
        user,
      );

      expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
        user,
        'c1',
        AccessLevel.WRITE,
      );
      // GLOBAL counter (no companyId) → global uniqueness for the @unique column.
      expect(codes.next).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'CustomerSegment' }),
      );
      expect(codes.next.mock.calls[0][0]).not.toHaveProperty('companyId');
      const data = prisma.customerSegment.create.mock.calls[0][0].data;
      expect(data.segmentCode).toBe('CUSTOMER-SEGMENT-2026-00001');
      expect(result.segmentCode).toBe('CUSTOMER-SEGMENT-2026-00001');
    });

    it('validates the dto.companyId against WRITE access and whitelists fields', async () => {
      const { service, prisma, companyScope, codes } = makeService();

      await service.create(
        {
          companyId: 'c1',
          segmentCode: 'SEG-1',
          name: 'VIP',
          description: 'Top customers',
          isActive: true,
          // Fields that must never reach Prisma.
          id: 'attacker-supplied',
          createdById: 'someone-else',
        } as any,
        user,
      );

      expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
        user,
        'c1',
        AccessLevel.WRITE,
      );
      // Caller supplied a code → generator not consulted (backward-compat).
      expect(codes.next).not.toHaveBeenCalled();
      const data = prisma.customerSegment.create.mock.calls[0][0].data;
      expect(data).toEqual(
        expect.objectContaining({
          companyId: 'c1',
          segmentCode: 'SEG-1',
          name: 'VIP',
          description: 'Top customers',
          isActive: true,
        }),
      );
      expect(data).not.toHaveProperty('id');
      expect(data).not.toHaveProperty('createdById');
    });

    it('rejects when the caller lacks WRITE on the target company', async () => {
      const { service, prisma, companyScope } = makeService();
      companyScope.assertCanAccessCompany.mockRejectedValueOnce(new ForbiddenException());

      await expect(
        service.create({ companyId: 'other', segmentCode: 'X', name: 'Y' } as any, user),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.customerSegment.create).not.toHaveBeenCalled();
    });

    it('retries with a fresh generated code on a unique collision', async () => {
      const { service, prisma, codes } = makeService();
      prisma.customerSegment.create
        .mockRejectedValueOnce(p2002())
        .mockImplementationOnce(async ({ data }: any) => ({ id: 'seg1', ...data }));

      const result = await service.create({ companyId: 'c1', name: 'VIP' } as any, user);

      expect(codes.next).toHaveBeenCalledTimes(2);
      expect(prisma.customerSegment.create).toHaveBeenCalledTimes(2);
      expect(result.id).toBe('seg1');
    });

    it('surfaces a 400 (not a 500) when a caller-supplied code collides', async () => {
      const { service, prisma, codes } = makeService();
      prisma.customerSegment.create.mockRejectedValueOnce(p2002());

      await expect(
        service.create({ companyId: 'c1', segmentCode: 'DUP', name: 'VIP' } as any, user),
      ).rejects.toBeInstanceOf(BadRequestException);
      // No retry when the caller pinned the code.
      expect(codes.next).not.toHaveBeenCalled();
      expect(prisma.customerSegment.create).toHaveBeenCalledTimes(1);
    });

    it('gives up with a 400 after exhausting generation retries', async () => {
      const { service, prisma } = makeService();
      prisma.customerSegment.create.mockRejectedValue(p2002());

      await expect(
        service.create({ companyId: 'c1', name: 'VIP' } as any, user),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.customerSegment.create).toHaveBeenCalledTimes(5);
    });
  });

  describe('update', () => {
    it('asserts WRITE and rejects moving the record to another company', async () => {
      const { service, prisma } = makeService();
      prisma.customerSegment.findFirst.mockResolvedValue({ id: 'seg1', companyId: 'c1' });

      await expect(
        service.update('seg1', { companyId: 'c2', name: 'x' } as any, user),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.customerSegment.update).not.toHaveBeenCalled();
    });

    it('surfaces Forbidden when the caller can READ but not WRITE the company', async () => {
      const { service, prisma, companyScope } = makeService();
      prisma.customerSegment.findFirst.mockResolvedValue({ id: 'seg1', companyId: 'c1' });
      // READ passes, WRITE fails.
      companyScope.assertCanAccessCompany
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new ForbiddenException());

      await expect(service.update('seg1', { name: 'x' } as any, user)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.customerSegment.update).not.toHaveBeenCalled();
    });

    it('applies only whitelisted fields', async () => {
      const { service, prisma } = makeService();
      prisma.customerSegment.findFirst.mockResolvedValue({ id: 'seg1', companyId: 'c1' });

      await service.update('seg1', { name: 'Renamed', segmentCode: 'NEW', bogus: 1 } as any, user);

      const data = prisma.customerSegment.update.mock.calls[0][0].data;
      expect(data).toEqual({ name: 'Renamed', segmentCode: 'NEW' });
    });
  });

  describe('remove', () => {
    it('asserts WRITE before soft-deleting', async () => {
      const { service, prisma, companyScope } = makeService();
      prisma.customerSegment.findFirst.mockResolvedValue({ id: 'seg1', companyId: 'c1' });

      await service.remove('seg1', user);

      expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
        user,
        'c1',
        AccessLevel.WRITE,
      );
      expect(prisma.customerSegment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'seg1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe('addMember', () => {
    it('asserts WRITE and keeps the customer-belongs-to-company guard', async () => {
      const { service, prisma, companyScope, auditLogs } = makeService();
      prisma.customerSegment.findFirst.mockResolvedValue({ id: 'seg1', companyId: 'c1' });
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust1', companyId: 'c1' });

      await service.addMember('seg1', { customerId: 'cust1' } as any, user);

      expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
        user,
        'c1',
        AccessLevel.WRITE,
      );
      expect(prisma.customerSegmentMembership.upsert).toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ADD_MEMBER',
          entityType: 'CustomerSegment',
          entityId: 'seg1',
          companyId: 'c1',
        }),
      );
    });

    it('rejects a customer from a different company', async () => {
      const { service, prisma } = makeService();
      prisma.customerSegment.findFirst.mockResolvedValue({ id: 'seg1', companyId: 'c1' });
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust1', companyId: 'c2' });

      await expect(
        service.addMember('seg1', { customerId: 'cust1' } as any, user),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.customerSegmentMembership.upsert).not.toHaveBeenCalled();
    });

    it('throws NotFound for a foreign-tenant segment (no leak)', async () => {
      const { service, prisma, companyScope } = makeService();
      prisma.customerSegment.findFirst.mockResolvedValue({ id: 'seg1', companyId: 'other' });
      companyScope.assertCanAccessCompany.mockRejectedValueOnce(new ForbiddenException());

      await expect(
        service.addMember('seg1', { customerId: 'cust1' } as any, user),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    it('asserts WRITE before deleting the membership', async () => {
      const { service, prisma, companyScope, auditLogs } = makeService();
      prisma.customerSegment.findFirst.mockResolvedValue({ id: 'seg1', companyId: 'c1' });

      await service.removeMember('seg1', 'cust1', user);

      expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
        user,
        'c1',
        AccessLevel.WRITE,
      );
      expect(prisma.customerSegmentMembership.deleteMany).toHaveBeenCalledWith({
        where: { customerSegmentId: 'seg1', customerId: 'cust1' },
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'REMOVE_MEMBER',
          entityType: 'CustomerSegment',
          entityId: 'seg1',
          companyId: 'c1',
        }),
      );
    });

    it('throws NotFound for a foreign-tenant segment before deleting', async () => {
      const { service, prisma, companyScope } = makeService();
      prisma.customerSegment.findFirst.mockResolvedValue({ id: 'seg1', companyId: 'other' });
      companyScope.assertCanAccessCompany.mockRejectedValueOnce(new ForbiddenException());

      await expect(service.removeMember('seg1', 'cust1', user)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.customerSegmentMembership.deleteMany).not.toHaveBeenCalled();
    });
  });
});
