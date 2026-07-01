import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { DocumentNumberSequencesService } from './document-number-sequences.service';

function companyUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'seq-user',
    email: 'seq@itemba.local',
    roles: ['Accountant'],
    roleScopes: ['COMPANY'],
    permissions: ['doc_sequences.view', 'doc_sequences.update'],
    companyId: 'company-1',
    companyAccess: [{ companyId: 'company-1', accessLevel: AccessLevel.MANAGE }],
    ...overrides,
  };
}

function groupUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'group-user',
    email: 'group@itemba.local',
    roles: ['GroupAdmin'],
    roleScopes: ['GROUP'],
    permissions: ['doc_sequences.view', 'doc_sequences.update'],
    companyId: null,
    companyAccess: [],
    ...overrides,
  };
}

function makePrisma() {
  return {
    documentNumberSequence: {
      findFirst: jest.fn(),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      create: jest.fn(async (args: any) => ({ id: 'seq-1', ...args.data })),
      update: jest.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
    },
    userCompanyAccess: {
      findMany: jest.fn(async () => []),
    },
  } as any;
}

function makeService(prisma: any) {
  return new DocumentNumberSequencesService(
    prisma,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    new CompanyScopeService(prisma),
  );
}

describe('DocumentNumberSequencesService company scoping', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('findOne', () => {
    it('returns the sequence for a user who can access its company', async () => {
      const prisma = makePrisma();
      prisma.documentNumberSequence.findFirst.mockResolvedValue({
        id: 'seq-1',
        companyId: 'company-1',
        prefix: 'INV-',
      });
      const service = makeService(prisma);

      await expect(service.findOne('seq-1', companyUser())).resolves.toMatchObject({
        id: 'seq-1',
        companyId: 'company-1',
      });
    });

    it('forbids a company user from reading another company\'s sequence', async () => {
      const prisma = makePrisma();
      prisma.documentNumberSequence.findFirst.mockResolvedValue({
        id: 'seq-b',
        companyId: 'company-2',
      });
      const service = makeService(prisma);

      await expect(service.findOne('seq-b', companyUser())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('forbids a company user from reading a group-level (null company) sequence', async () => {
      const prisma = makePrisma();
      prisma.documentNumberSequence.findFirst.mockResolvedValue({
        id: 'seq-null',
        companyId: null,
      });
      const service = makeService(prisma);

      await expect(service.findOne('seq-null', companyUser())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('lets a group-scoped user read a group-level (null company) sequence', async () => {
      const prisma = makePrisma();
      prisma.documentNumberSequence.findFirst.mockResolvedValue({
        id: 'seq-null',
        companyId: null,
      });
      const service = makeService(prisma);

      await expect(service.findOne('seq-null', groupUser())).resolves.toMatchObject({
        id: 'seq-null',
      });
    });

    it('throws NotFound before any scope check when the id does not exist', async () => {
      const prisma = makePrisma();
      prisma.documentNumberSequence.findFirst.mockResolvedValue(null);
      const service = makeService(prisma);

      await expect(service.findOne('missing', companyUser())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('remains callable without a user (internal use) without scoping', async () => {
      const prisma = makePrisma();
      prisma.documentNumberSequence.findFirst.mockResolvedValue({
        id: 'seq-b',
        companyId: 'company-2',
      });
      const service = makeService(prisma);

      await expect(service.findOne('seq-b')).resolves.toMatchObject({ id: 'seq-b' });
    });
  });

  describe('update', () => {
    it('blocks cross-company updates instead of mutating another tenant\'s sequence', async () => {
      const prisma = makePrisma();
      prisma.documentNumberSequence.findFirst.mockResolvedValue({
        id: 'seq-b',
        companyId: 'company-2',
      });
      const service = makeService(prisma);

      await expect(
        service.update('seq-b', { prefix: 'HACK-' }, companyUser()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.documentNumberSequence.update).not.toHaveBeenCalled();
    });

    it('requires WRITE access for the owning company (READ-only grant is rejected)', async () => {
      const prisma = makePrisma();
      prisma.documentNumberSequence.findFirst.mockResolvedValue({
        id: 'seq-1',
        companyId: 'company-1',
      });
      const service = makeService(prisma);
      const readOnly = companyUser({
        companyId: null,
        companyAccess: [{ companyId: 'company-1', accessLevel: AccessLevel.READ }],
      });

      await expect(
        service.update('seq-1', { prefix: 'X-' }, readOnly),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.documentNumberSequence.update).not.toHaveBeenCalled();
    });

    it('updates a sequence the user can write', async () => {
      const prisma = makePrisma();
      prisma.documentNumberSequence.findFirst.mockResolvedValue({
        id: 'seq-1',
        companyId: 'company-1',
      });
      const service = makeService(prisma);

      await service.update('seq-1', { prefix: 'INV-' }, companyUser());
      expect(prisma.documentNumberSequence.update).toHaveBeenCalledWith({
        where: { id: 'seq-1' },
        data: { prefix: 'INV-' },
      });
    });
  });

  describe('nextNumber', () => {
    it('does not advance another company\'s live counter', async () => {
      const prisma = makePrisma();
      prisma.documentNumberSequence.findFirst.mockResolvedValue({
        id: 'seq-b',
        companyId: 'company-2',
      });
      const service = makeService(prisma);

      await expect(service.nextNumber('seq-b', companyUser())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.documentNumberSequence.update).not.toHaveBeenCalled();
    });

    it('advances and formats a sequence the user owns', async () => {
      const prisma = makePrisma();
      prisma.documentNumberSequence.findFirst.mockResolvedValue({
        id: 'seq-1',
        companyId: 'company-1',
        prefix: 'INV-',
        suffix: '',
        padding: 5,
      });
      prisma.documentNumberSequence.update.mockResolvedValue({ currentNumber: 42 });
      const service = makeService(prisma);

      await expect(service.nextNumber('seq-1', companyUser())).resolves.toEqual({
        number: 42,
        formatted: 'INV-00042',
      });
      expect(prisma.documentNumberSequence.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'seq-1' },
          data: { currentNumber: { increment: 1 } },
        }),
      );
    });
  });
});
