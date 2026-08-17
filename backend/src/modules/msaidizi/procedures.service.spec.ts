/**
 * Saved procedures: the guarantees that make a procedure safer than re-deriving
 * the task from prose every time.
 *
 *   1. A procedure cannot name capabilities its author does not hold.
 *   2. It runs under the invoker's permissions, never the author's — it is a
 *      saved instruction, not a grant.
 *   3. Its approved capability list is a ceiling that does not widen when the
 *      manifest grows.
 *   4. It cannot run until someone other than its author approved it.
 */

import { ForbiddenException } from '@nestjs/common';
import { MsaidiziProcedureStatus } from '@prisma/client';
import { Capability } from '../../common/capabilities/capability-manifest';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ManifestProvider } from './manifest.provider';
import { MsaidiziConfig } from './msaidizi.config';
import { ProceduresService } from './procedures.service';

function capability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: 'SuppliersController.findAll',
    controller: 'SuppliersController',
    handler: 'findAll',
    verb: 'GET',
    path: 'suppliers',
    permissions: ['suppliers.view'],
    anyPermissions: [],
    roles: [],
    apiScopes: [],
    guard: 'permission',
    tier: 'green',
    tierReason: 'read-verb',
    params: { path: [], query: [], freeFormQuery: false, hasBody: false },
    agentExcluded: false,
    ...overrides,
  };
}

function authUser(id: string, permissions: string[]): AuthUser {
  return {
    id,
    email: `${id}@itemba.local`,
    fullName: id,
    roles: [],
    roleScopes: ['COMPANY'],
    permissions,
    companyId: 'company-A',
    companyAccess: [{ companyId: 'company-A', accessLevel: 'WRITE' }],
  } as unknown as AuthUser;
}

const MANIFEST = [
  capability(),
  capability({
    id: 'SupplierInvoicesController.findAll',
    controller: 'SupplierInvoicesController',
    path: 'supplier-invoices',
    permissions: ['supplier_invoices.view'],
  }),
  capability({
    id: 'PayrollController.findAll',
    controller: 'PayrollController',
    path: 'hr/payroll',
    permissions: ['payroll.view'],
  }),
];

function makeService(overrides: { prisma?: unknown; config?: Partial<MsaidiziConfig> } = {}) {
  const manifest = new ManifestProvider();
  manifest.setForTesting(MANIFEST);

  const prisma = overrides.prisma ?? {
    msaidiziProcedure: {
      create: jest.fn(async ({ data }) => ({ id: 'proc-1', ...data })),
      update: jest.fn(async ({ data }) => ({ id: 'proc-1', ...data })),
      findFirst: jest.fn(),
      findMany: jest.fn(async () => []),
    },
  };

  const config = {
    allowedTiers: ['green'],
    writeMode: 'read-only',
    ...overrides.config,
  } as unknown as MsaidiziConfig;

  const companyScope = { assertCanAccessCompany: jest.fn(async () => undefined) };
  const audit = { log: jest.fn(async () => undefined) };

  const service = new ProceduresService(
    prisma as never,
    manifest,
    config,
    companyScope as never,
    audit as never,
  );
  return { service, prisma: prisma as never, audit };
}

describe('compiling an instruction', () => {
  it('resolves to capabilities the author actually holds', () => {
    const { service } = makeService();
    const compiled = service.compile(
      'check supplier invoices for a supplier',
      authUser('author', ['suppliers.view', 'supplier_invoices.view']),
    );

    expect(compiled.capabilities).toContain('SupplierInvoices_findAll');
    // Never offered payroll — the author does not hold that permission.
    expect(compiled.capabilities).not.toContain('Payroll_findAll');
  });

  it('refuses when nothing the author holds matches', () => {
    const { service } = makeService();
    expect(() =>
      service.compile('reconcile the payroll runs', authUser('author', ['suppliers.view'])),
    ).toThrow(/no capabilities you hold match/i);
  });

  it('reports the blast radius so a reviewer sees it before approving', () => {
    const { service } = makeService({ config: { allowedTiers: ['green', 'amber', 'red'] } });
    const manifest = new ManifestProvider();
    manifest.setForTesting([
      capability(),
      capability({
        id: 'SuppliersController.remove',
        handler: 'remove',
        verb: 'DELETE',
        path: 'suppliers/:id',
        permissions: ['suppliers.delete'],
        tier: 'red',
        tierReason: 'delete-verb',
      }),
    ]);
    (service as unknown as { manifest: ManifestProvider }).manifest = manifest;

    const compiled = service.compile(
      'remove a supplier',
      authUser('author', ['suppliers.view', 'suppliers.delete']),
    );
    expect(compiled.highestTier).toBe('red');
  });
});

describe('creating a procedure', () => {
  it('drops capabilities the author does not hold, whatever the client sent', async () => {
    const { service, prisma } = makeService();

    await service.create(
      {
        name: 'Supplier close-out',
        instruction: 'check supplier invoices',
        capabilities: ['SupplierInvoices_findAll', 'Payroll_findAll'],
      },
      authUser('author', ['supplier_invoices.view']),
    );

    const created = (prisma as never as { msaidiziProcedure: { create: jest.Mock } })
      .msaidiziProcedure.create.mock.calls[0][0].data;
    expect(created.capabilities).toEqual(['SupplierInvoices_findAll']);
  });

  it('refuses when none of the requested capabilities are available', async () => {
    const { service } = makeService();
    await expect(
      service.create(
        { name: 'X', instruction: 'y', capabilities: ['Payroll_findAll'] },
        authUser('author', ['suppliers.view']),
      ),
    ).rejects.toThrow(/none of the requested capabilities/i);
  });

  it('starts in DRAFT so it cannot run before review', async () => {
    const { service, prisma } = makeService();
    await service.create(
      { name: 'X', instruction: 'suppliers', capabilities: ['Suppliers_findAll'] },
      authUser('author', ['suppliers.view']),
    );
    const created = (prisma as never as { msaidiziProcedure: { create: jest.Mock } })
      .msaidiziProcedure.create.mock.calls[0][0].data;
    expect(created.status).toBe(MsaidiziProcedureStatus.DRAFT);
  });
});

describe('approval', () => {
  function withProcedure(procedure: Record<string, unknown>) {
    return makeService({
      prisma: {
        msaidiziProcedure: {
          findFirst: jest.fn(async () => procedure),
          update: jest.fn(async ({ data }) => ({ ...procedure, ...data })),
          create: jest.fn(),
          findMany: jest.fn(),
        },
      },
    });
  }

  it('refuses to let an author approve their own procedure', async () => {
    const { service } = withProcedure({
      id: 'proc-1',
      createdById: 'author',
      status: MsaidiziProcedureStatus.DRAFT,
      companyId: 'company-A',
    });

    await expect(service.activate('proc-1', authUser('author', []))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('accepts approval from somebody else', async () => {
    const { service } = withProcedure({
      id: 'proc-1',
      createdById: 'author',
      status: MsaidiziProcedureStatus.DRAFT,
      companyId: 'company-A',
    });

    const updated = await service.activate('proc-1', authUser('reviewer', []));
    expect(updated.status).toBe(MsaidiziProcedureStatus.ACTIVE);
  });
});

describe('running a procedure', () => {
  function withProcedure(procedure: Record<string, unknown>) {
    return makeService({
      prisma: {
        msaidiziProcedure: {
          findFirst: jest.fn(async () => procedure),
          update: jest.fn(),
          create: jest.fn(),
          findMany: jest.fn(),
        },
      },
    });
  }

  const active = {
    id: 'proc-1',
    createdById: 'author',
    status: MsaidiziProcedureStatus.ACTIVE,
    companyId: 'company-A',
    instruction: 'check supplier invoices',
    capabilities: ['SupplierInvoices_findAll', 'Suppliers_findAll'],
  };

  it('will not run a procedure that has not been approved', async () => {
    const { service } = withProcedure({ ...active, status: MsaidiziProcedureStatus.DRAFT });
    await expect(
      service.resolveForRun('proc-1', authUser('anyone', ['supplier_invoices.view'])),
    ).rejects.toThrow(/not been reviewed/i);
  });

  it('will not run an archived procedure', async () => {
    const { service } = withProcedure({ ...active, status: MsaidiziProcedureStatus.ARCHIVED });
    await expect(
      service.resolveForRun('proc-1', authUser('anyone', ['supplier_invoices.view'])),
    ).rejects.toThrow(/archived/i);
  });

  it('runs under the invoker permissions, not the author', async () => {
    const { service } = withProcedure(active);

    // The invoker holds only one of the two approved capabilities.
    const { entries } = await service.resolveForRun(
      'proc-1',
      authUser('clerk', ['supplier_invoices.view']),
    );

    expect(entries.map((e) => e.tool.name)).toEqual(['SupplierInvoices_findAll']);
  });

  it('refuses rather than half-running when the invoker holds none of it', async () => {
    const { service } = withProcedure(active);
    await expect(
      service.resolveForRun('proc-1', authUser('clerk', ['payroll.view'])),
    ).rejects.toThrow(/do not have access/i);
  });

  it('does not widen when the manifest grows after approval', async () => {
    const { service } = withProcedure(active);
    const manifest = new ManifestProvider();
    // A new endpoint lands that the invoker can reach and the instruction matches.
    manifest.setForTesting([
      ...MANIFEST,
      capability({
        id: 'SupplierInvoicesController.recent',
        controller: 'SupplierInvoicesController',
        handler: 'recent',
        path: 'supplier-invoices/recent',
        permissions: ['supplier_invoices.view'],
      }),
    ]);
    (service as unknown as { manifest: ManifestProvider }).manifest = manifest;

    const { entries } = await service.resolveForRun(
      'proc-1',
      authUser('clerk', ['supplier_invoices.view', 'suppliers.view']),
    );

    // Only the two capabilities that were approved, never the new one.
    expect(entries.map((e) => e.tool.name).sort()).toEqual([
      'SupplierInvoices_findAll',
      'Suppliers_findAll',
    ]);
  });
});
