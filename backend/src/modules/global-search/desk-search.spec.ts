import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CompanyScopeService, OrganizationScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { DeskSearchService } from './desk-search.service';
import { GlobalSearchService } from './global-search.service';

type Row = Record<string, unknown>;
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return (value as Row[]).every((entry) => matches(row, entry));
    if (key === 'OR') return (value as Row[]).some((entry) => matches(row, entry));
    if (value === null || typeof value !== 'object') return row[key] === value;
    const condition = value as Row;
    if ('in' in condition) return (condition.in as unknown[]).includes(row[key]);
    if ('contains' in condition)
      return String(row[key] ?? '')
        .toLowerCase()
        .includes(String(condition.contains).toLowerCase());
    if ('some' in condition)
      return (row[key] as Row[]).some((entry) => matches(entry, condition.some as Row));
    return !!row[key] && matches(row[key] as Row, condition);
  });
}
function project(row: Row, selection: Row): Row {
  return Object.fromEntries(
    Object.entries(selection).map(([key, value]) => {
      if (value === true) return [key, row[key]];
      const nested = value as { select: Row; where?: Row };
      const source = row[key];
      return [
        key,
        Array.isArray(source)
          ? source
              .filter((entry) => !nested.where || matches(entry, nested.where))
              .map((entry) => project(entry, nested.select))
          : source
            ? project(source as Row, nested.select)
            : source,
      ];
    }),
  );
}
const date = new Date('2026-09-20T00:00:00Z');
function organization(companyId = 'a', divisionId = 'd1', branchId = 'b1') {
  return {
    companyId,
    divisionId,
    branchId,
    company: { name: `Company ${companyId}` },
    branch: { name: `Branch ${branchId}` },
  };
}
const rows = (id: string, scope = organization()) => ({
  ...scope,
  id,
  invoiceNumber: `ALPHA invoice ${id}`,
  invoiceDate: date,
  description: 'Alpha purchase',
  supplier: { name: 'Alpha supplier' },
  voidedAt: null,
  saleNumber: `ALPHA sale ${id}`,
  saleDate: date,
  customer: { name: 'Alpha customer' },
  lines: [],
});
const permissions = ['invoice_desk.view', 'cash_desk.view', 'sales_desk.view', 'documents.view'];
const user: AuthUser = {
  id: 'reader',
  email: 'reader@example.test',
  roles: [],
  permissions,
  companyId: 'a',
  companyAccess: [],
  roleScopes: ['BRANCH'],
  divisionAccess: [],
  branchAccess: [{ branchId: 'b1', accessLevel: 'READ' }],
};
function setup() {
  const invoices = [
    rows('own'),
    rows('other-branch', organization('a', 'd1', 'b2')),
    rows('foreign', organization('b', 'd2', 'b3')),
  ];
  const movements = [
    {
      id: 'transfer',
      description: 'Alpha intercompany transfer',
      reference: 'ALPHA-REF',
      businessDate: date,
      kind: 'LOAN',
      reversedAt: null,
      entries: [
        { account: { ...organization(), name: 'Visible till' } },
        { account: { ...organization('b', 'd2', 'b3'), name: 'Private till' } },
      ],
    },
  ];
  const documents = [
    {
      ...organization(),
      id: 'document',
      title: 'Alpha contract',
      fileName: 'contract.pdf',
      version: 3,
      documentCode: 'ALPHA-DOC',
      description: '',
      status: 'ACTIVE',
      deletedAt: null,
    },
    { ...organization(), id: 'deleted', title: 'Alpha deleted', deletedAt: date },
    { ...organization('b'), id: 'foreign', title: 'Alpha foreign', deletedAt: null },
    { companyId: null, id: 'group', title: 'Alpha group', deletedAt: null },
  ];
  const delegate = (data: Row[]) => ({
    findMany: jest.fn(async (args: { where: Row; select: Row; take: number }) =>
      data
        .filter((row) => matches(row, args.where))
        .slice(0, args.take)
        .map((row) => project(row, args.select)),
    ),
  });
  const attachments: Row[] = [];
  const db = {
    invoiceDeskAttachment: delegate(attachments),
    invoiceDeskInvoice: delegate(invoices),
    salesDeskSale: delegate(invoices),
    cashDeskMovement: delegate(movements),
    document: delegate(documents),
  };
  const prisma = db as unknown as PrismaService;
  const company = new CompanyScopeService(prisma),
    org = new OrganizationScopeService(prisma);
  const desks = new DeskSearchService(prisma, org);
  return {
    db,
    invoices,
    attachments,
    service: new GlobalSearchService(prisma, company, org, desks),
  };
}

describe('Universal Desk record search', () => {
  it('returns scoped records with direct destinations and no hidden transfer party', async () => {
    const { service } = setup();
    const result = await service.search({ q: '  alpha  ' }, user);
    expect(result.query).toBe('alpha');
    expect(result.total).toBe(4);
    expect(result.groups.map((group) => group.key)).toEqual([
      'desk-invoices',
      'desk-sales',
      'desk-movements',
      'documents',
    ]);
    expect(result.groups.flatMap((group) => group.results.map((row) => row.href))).toEqual([
      '/invoice-desk?record=own',
      '/sales-desk?record=own',
      '/cash-desk?record=transfer',
      '/group-control/documents/document',
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /Private till|Company b|other-branch|deleted|foreign/,
    );
  });
  it.each([
    ['BRANCH', [], [{ branchId: 'b1', accessLevel: 'READ' }], ['own']],
    ['DIVISION', [{ divisionId: 'd1', accessLevel: 'READ' }], [], ['own', 'other-branch']],
    ['COMPANY', [], [], ['own', 'other-branch']],
    ['GROUP', [], [], ['own', 'other-branch']],
    ['BRANCH', [], [], []],
  ] as const)(
    'honours %s scope and explicit organisation grants',
    async (role, divisions, branches, ids) => {
      const { service } = setup();
      const result = await service.search(
        { q: 'alpha' },
        {
          ...user,
          permissions: ['invoice_desk.view'],
          roleScopes: [role],
          divisionAccess: [...divisions],
          branchAccess: [...branches],
        },
      );
      expect(result.groups.flatMap((group) => group.results.map((row) => row.id))).toEqual(ids);
    },
  );
  it('combines secondary company and branch grants and honours a requested company', async () => {
    const { service } = setup();
    const granted = {
      ...user,
      permissions: ['sales_desk.view'],
      companyAccess: [{ companyId: 'b', accessLevel: 'READ' }],
      branchAccess: [{ branchId: 'b3', accessLevel: 'READ' }],
    };
    const result = await service.search({ q: 'alpha', companyId: 'b' }, granted);
    expect(result.groups[0].results.map((row) => row.id)).toEqual(['foreign']);
    await expect(service.search({ q: 'alpha', companyId: 'b' }, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('fails closed with no company grants and never queries an unpermitted source', async () => {
    const { service, db } = setup();
    expect((await service.search({ q: 'alpha' }, { ...user, companyId: null })).total).toBe(0);
    Object.values(db).forEach((delegate) => delegate.findMany.mockClear());
    expect((await service.search({ q: 'alpha' }, { ...user, permissions: [] })).total).toBe(0);
    Object.values(db).forEach((delegate) => expect(delegate.findMany).not.toHaveBeenCalled());
  });
  it('uses source-specific permissions, including document access independently of ERP', async () => {
    const { service, db } = setup();
    const result = await service.search(
      { q: 'contract.pdf' },
      { ...user, permissions: ['documents.view'] },
    );
    expect(result.groups[0].results[0].id).toBe('document');
    expect(db.invoiceDeskInvoice.findMany).not.toHaveBeenCalled();
    expect(db.cashDeskMovement.findMany).not.toHaveBeenCalled();
    expect(db.salesDeskSale.findMany).not.toHaveBeenCalled();
    expect(db.document.findMany.mock.calls[0][0].select).not.toHaveProperty('storageKey');
  });
  it('bounds the number of matches and does not query for a one-character search', async () => {
    const { service, db, invoices } = setup();
    invoices.push(...Array.from({ length: 20 }, (_, index) => rows(`extra-${index}`)));
    const viewer = { ...user, permissions: ['invoice_desk.view'] };
    expect((await service.search({ q: 'a' }, viewer)).total).toBe(0);
    expect(db.invoiceDeskInvoice.findMany).not.toHaveBeenCalled();
    expect((await service.search({ q: 'alpha' }, viewer)).total).toBe(5);
    expect((await service.search({ q: 'alpha', limit: '999' }, viewer)).total).toBe(12);
  });
  it('encodes a record id as one route parameter and finds supplier matches', async () => {
    const { service, invoices } = setup();
    invoices[0].id = 'invoice & branch';
    invoices[0].supplier.name = 'Unique supplier';
    const result = await service.search(
      { q: 'unique supplier' },
      { ...user, permissions: ['invoice_desk.view'] },
    );
    expect(result.groups[0].results[0].href).toBe('/invoice-desk?record=invoice%20%26%20branch');
  });
  it('searches only files without running financial or ERP register queries', async () => {
    const { service, db, attachments, invoices } = setup();
    attachments.push({
      id: 'receipt',
      invoiceId: 'own',
      name: 'scan.pdf',
      createdAt: date,
      invoice: invoices[0],
      content: Buffer.from('private bytes'),
      digest: 'private digest',
    });
    const result = await service.search(
      { q: 'alpha', category: 'files' },
      {
        ...user,
        permissions: [
          ...permissions,
          'companies.read',
          'products.view',
          'sales.view',
          'purchases.view',
        ],
      },
    );
    expect(result.total).toBe(2);
    expect(result.groups.map((group) => group.key)).toEqual(['documents', 'invoice-attachments']);
    expect(result.groups[0].results[0].file).toEqual({
      kind: 'document',
      id: 'document',
      title: 'Alpha contract',
      fileName: 'contract.pdf',
      version: 3,
    });
    expect(result.groups[1].results[0]).toMatchObject({
      href: '/invoice-desk?record=own',
      file: { kind: 'invoice-attachment', id: 'receipt', invoiceId: 'own', fileName: 'scan.pdf' },
    });
    expect(db.invoiceDeskInvoice.findMany).not.toHaveBeenCalled();
    expect(db.salesDeskSale.findMany).not.toHaveBeenCalled();
    expect(db.cashDeskMovement.findMany).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/private bytes|private digest|content|storageKey/);
    expect(db.invoiceDeskAttachment.findMany.mock.calls[0][0].select).not.toHaveProperty('content');
  });
  it.each([
    ['BRANCH', [], [{ branchId: 'b1', accessLevel: 'READ' }], ['scan-own']],
    [
      'DIVISION',
      [{ divisionId: 'd1', accessLevel: 'READ' }],
      [],
      ['scan-own', 'scan-other-branch'],
    ],
    ['COMPANY', [], [], ['scan-own', 'scan-other-branch']],
    ['BRANCH', [], [], []],
  ] as const)(
    'keeps invoice files within %s access even when the supplier matches',
    async (role, divisions, branches, ids) => {
      const { service, attachments, invoices } = setup();
      attachments.push(
        ...invoices.map((invoice) => ({
          id: `scan-${invoice.id}`,
          invoiceId: invoice.id,
          name: 'Scanned receipt.pdf',
          createdAt: date,
          invoice,
        })),
      );
      const result = await service.search(
        { q: 'alpha supplier', category: 'files' },
        {
          ...user,
          permissions: ['invoice_desk.view'],
          roleScopes: [role],
          divisionAccess: [...divisions],
          branchAccess: [...branches],
        },
      );
      expect(result.groups.flatMap((group) => group.results.map((row) => row.id))).toEqual(ids);
    },
  );
  it('requires each file source permission and keeps requested company boundaries', async () => {
    const { service, db, attachments, invoices } = setup();
    attachments.push({
      id: 'scan',
      invoiceId: 'own',
      name: 'alpha.pdf',
      createdAt: date,
      invoice: invoices[0],
    });
    const documentsOnly = await service.search(
      { q: 'alpha', category: 'files' },
      { ...user, permissions: ['documents.view'] },
    );
    expect(documentsOnly.groups.map((group) => group.key)).toEqual(['documents']);
    expect(db.invoiceDeskAttachment.findMany).not.toHaveBeenCalled();
    expect(
      (await service.search({ q: 'alpha', category: 'files' }, { ...user, permissions: [] })).total,
    ).toBe(0);
    await expect(
      service.search({ q: 'alpha', category: 'files', companyId: 'b' }, user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.search({ q: 'alpha', category: 'everything' }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('bounds file results and encodes the invoice record destination', async () => {
    const { service, attachments, invoices } = setup();
    attachments.push(
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `scan-${index}`,
        invoiceId: 'invoice & branch',
        name: 'alpha.pdf',
        createdAt: date,
        invoice: invoices[0],
      })),
    );
    const result = await service.search(
      { q: 'alpha', category: 'files', limit: '999' },
      { ...user, permissions: ['invoice_desk.view'] },
    );
    expect(result.total).toBe(12);
    expect(result.groups[0].results[0].href).toBe('/invoice-desk?record=invoice%20%26%20branch');
  });
});
