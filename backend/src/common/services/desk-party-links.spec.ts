import { DeskPartyLinksService } from './desk-party-links.service';
import { AuthUser } from '../decorators/current-user.decorator';
const user = {
  id: 'reviewer',
  permissions: [
    'invoice_desk.view',
    'invoice_desk.manage',
    'suppliers.view',
    'suppliers.update',
    'sales_desk.view',
    'sales_desk.manage',
    'customers.view',
    'customers.update',
  ],
} as AuthUser;
function fixture(kind: 'supplier' | 'customer') {
  const source = {
    id: 'old',
    companyId: 'company',
    name: 'Original name',
    canonicalSupplierId: null,
    canonicalCustomerId: null,
  };
  const master = { id: 'master', companyId: 'company', name: 'Shared name' };
  const party = { findFirst: jest.fn().mockResolvedValue(source), update: jest.fn() };
  const canonical = { findFirst: jest.fn().mockResolvedValue(master) };
  const child = { count: jest.fn().mockResolvedValue(0) };
  const tx = {
    $queryRaw: jest.fn(),
    invoiceDeskSupplier: party,
    salesDeskCustomer: party,
    supplier: canonical,
    customer: canonical,
    invoiceDeskInvoice: child,
    salesDeskSale: child,
  };
  const db = { $transaction: jest.fn().mockImplementation((work) => work(tx)) };
  const companies = {
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company' }),
    assertCanAccessCompany: jest.fn(),
  };
  const org = { recordWhereFor: jest.fn().mockResolvedValue({ branchId: 'branch' }) };
  const audit = { logStrictInTransaction: jest.fn() };
  const service = new DeskPartyLinksService(
    db as never,
    companies as never,
    org as never,
    audit as never,
  );
  return {
    source,
    master,
    party,
    canonical,
    child,
    tx,
    db,
    org,
    service,
    run: () => service.link(user, kind, 'old', 'master'),
  };
}
describe.each(['supplier', 'customer'] as const)('%s shared directory', (kind) => {
  it('preserves the historical row and links only its shared identity', async () => {
    const f = fixture(kind);
    await f.run();
    expect(f.party.update).toHaveBeenCalledWith({
      where: { id: 'old' },
      data: { [kind === 'supplier' ? 'canonicalSupplierId' : 'canonicalCustomerId']: 'master' },
    });
    expect(f.canonical.findFirst.mock.calls[0][0].where.companyId).toBe('company');
  });
  it('does not link children outside writable branch access', async () => {
    const f = fixture(kind);
    f.child.count.mockResolvedValue(1);
    await expect(f.run()).rejects.toThrow('every associated transaction');
    expect(f.party.update).not.toHaveBeenCalled();
  });
  it('rejects a master outside the source company and authorised directory', async () => {
    const f = fixture(kind);
    f.canonical.findFirst.mockResolvedValue(null);
    await expect(f.run()).rejects.toThrow('same company');
    expect(f.party.update).not.toHaveBeenCalled();
  });
  it('refuses to rematch a previously linked profile', async () => {
    const f = fixture(kind);
    Object.assign(f.source, {
      [kind === 'supplier' ? 'canonicalSupplierId' : 'canonicalCustomerId']: 'another',
    });
    await expect(f.run()).rejects.toThrow('already linked');
    expect(f.party.update).not.toHaveBeenCalled();
  });
  it('does not infer an identity from a matching name on transaction creation', async () => {
    const f = fixture(kind);
    await expect(f.service.resolve(f.tx as never, user, kind, 'old', 'company')).rejects.toThrow(
      'Match this older',
    );
    expect(f.canonical.findFirst).not.toHaveBeenCalled();
  });
  it('requires canonical directory update permission', async () => {
    const f = fixture(kind);
    await expect(
      f.service.link(
        { ...user, permissions: user.permissions.filter((p) => !p.endsWith('.update')) },
        kind,
        'old',
        'master',
      ),
    ).rejects.toThrow('shared directory');
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
});
