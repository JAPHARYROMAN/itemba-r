import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccessLevel, AuditSeverity } from '@prisma/client';
import { CompanyScopeService } from '../../common/services';
import { JournalEntriesService } from './journal-entries.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/**
 * P0-01 regression — cross-company isolation on journal-entries.
 *
 * Phase 1 rewired this service to require `CurrentUser` and route every
 * read/write through CompanyScopeService. These tests pin that contract so
 * a future change can't silently re-introduce the old "trust the query
 * companyId" pattern.
 *
 * The tests stay close to the actual Prisma surface but mock the client at
 * the boundary so they can run without a database. CompanyScopeService is
 * exercised live (against the same test prisma) since it is the unit under
 * test together with the JournalEntriesService.
 */

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-A',
    email: 'a@itemba.local',
    roles: ['Company User'],
    roleScopes: ['COMPANY'],
    permissions: ['journal-entries.read', 'journal-entries.create'],
    companyId: 'company-A',
    companyAccess: [],
    ...overrides,
  };
}

function makePrisma() {
  return {
    journalEntry: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    userCompanyAccess: { findMany: jest.fn().mockResolvedValue([]) },
  } as any;
}

function makeService(prisma: any) {
  const companyScope = new CompanyScopeService(prisma);
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const accountingControl = { assertPostingAllowed: jest.fn().mockResolvedValue(undefined) } as any;
  const codes = { next: jest.fn().mockResolvedValue('JE-1') } as any;
  return new JournalEntriesService(prisma, auditLogs, accountingControl, companyScope, codes);
}

describe('JournalEntriesService isolation (P0-01 regression)', () => {
  it('findAll restricts a company-A user to company-A entries when no filter is supplied', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    await service.findAll({ page: 1, limit: 20 } as any, authUser());

    // CompanyScopeService.companyWhereFor returns `{ companyId: { in: [...] } }`
    // for non-GROUP-scoped users. The exact shape is verified separately in
    // company-scope.service.spec.ts; here we only assert that some companyId
    // restriction reaches Prisma — and that it does NOT permit company-B.
    const where = (prisma.journalEntry.findMany as jest.Mock).mock.calls[0][0]
      .where;
    const cidValue =
      typeof where.companyId === 'string'
        ? [where.companyId]
        : where.companyId?.in ?? [];
    expect(cidValue).toEqual(['company-A']);
  });

  it('findAll rejects a query attempting to read another company by id', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    await expect(
      service.findAll({ page: 1, limit: 20, companyId: 'company-B' } as any, authUser()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // No DB read should occur after access denial.
    expect(prisma.journalEntry.findMany).not.toHaveBeenCalled();
  });

  it('findAll permits group-scoped users to query any company', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    await service.findAll(
      { page: 1, limit: 20, companyId: 'company-B' } as any,
      authUser({ roleScopes: ['GROUP'], companyId: null }),
    );

    expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'company-B' }),
      }),
    );
  });

  it('findOne refuses access to a journal that belongs to a different company', async () => {
    const prisma = makePrisma();
    prisma.journalEntry.findFirst.mockResolvedValue({
      id: 'je-1',
      companyId: 'company-B',
      lines: [],
    });
    const service = makeService(prisma);

    await expect(service.findOne('je-1', authUser())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('findOne returns the record when the requesting user has access', async () => {
    const prisma = makePrisma();
    prisma.journalEntry.findFirst.mockResolvedValue({
      id: 'je-1',
      companyId: 'company-A',
      lines: [],
    });
    const service = makeService(prisma);

    const result = await service.findOne('je-1', authUser());
    expect(result.id).toBe('je-1');
  });

  it('findOne throws NotFound (not Forbidden) when the journal id does not exist', async () => {
    const prisma = makePrisma();
    prisma.journalEntry.findFirst.mockResolvedValue(null);
    const service = makeService(prisma);

    await expect(service.findOne('missing', authUser())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('explicitly scoped users can read a company they were granted access to', async () => {
    const prisma = makePrisma();
    prisma.journalEntry.findFirst.mockResolvedValue({
      id: 'je-2',
      companyId: 'company-B',
      lines: [],
    });
    const service = makeService(prisma);

    const grantedUser = authUser({
      companyId: null,
      companyAccess: [{ companyId: 'company-B', accessLevel: AccessLevel.READ }],
    });

    const result = await service.findOne('je-2', grantedUser, AccessLevel.READ);
    expect(result.id).toBe('je-2');
  });

  it('write-level minimum rejects READ-only access on the granted company', async () => {
    const prisma = makePrisma();
    prisma.journalEntry.findFirst.mockResolvedValue({
      id: 'je-2',
      companyId: 'company-B',
      lines: [],
    });
    const service = makeService(prisma);

    const grantedUser = authUser({
      companyId: null,
      companyAccess: [{ companyId: 'company-B', accessLevel: AccessLevel.READ }],
    });

    await expect(
      service.findOne('je-2', grantedUser, AccessLevel.WRITE),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// Suppress unused-import warning when the test file is consumed but specific
// symbols aren't referenced in this file.
void AuditSeverity;
