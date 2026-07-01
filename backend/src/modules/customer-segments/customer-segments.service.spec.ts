import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
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
  };
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: { in: ['c1'] } }),
  } as any;
  const service = new CustomerSegmentsService(prisma, auditLogs, companyScope);
  return { service, prisma, companyScope, auditLogs };
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
      expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'c1', AccessLevel.READ);
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
    it('validates the dto.companyId against WRITE access and whitelists fields', async () => {
      const { service, prisma, companyScope } = makeService();

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

      expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'c1', AccessLevel.WRITE);
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

      expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'c1', AccessLevel.WRITE);
      expect(prisma.customerSegment.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'seg1' }, data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      );
    });
  });

  describe('addMember', () => {
    it('asserts WRITE and keeps the customer-belongs-to-company guard', async () => {
      const { service, prisma, companyScope } = makeService();
      prisma.customerSegment.findFirst.mockResolvedValue({ id: 'seg1', companyId: 'c1' });
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust1', companyId: 'c1' });

      await service.addMember('seg1', { customerId: 'cust1' } as any, user);

      expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'c1', AccessLevel.WRITE);
      expect(prisma.customerSegmentMembership.upsert).toHaveBeenCalled();
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
      const { service, prisma, companyScope } = makeService();
      prisma.customerSegment.findFirst.mockResolvedValue({ id: 'seg1', companyId: 'c1' });

      await service.removeMember('seg1', 'cust1', user);

      expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'c1', AccessLevel.WRITE);
      expect(prisma.customerSegmentMembership.deleteMany).toHaveBeenCalledWith({
        where: { customerSegmentId: 'seg1', customerId: 'cust1' },
      });
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
