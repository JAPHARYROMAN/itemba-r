import { InventoryBalancesService } from './inventory-balances.service';

/**
 * Low-stock filter (TICKET-16).
 *
 * `findAll({ lowStock: true })` no longer uses a flat 0<x<=10 band. Instead it
 * resolves matching balance IDs via a raw join against products, comparing
 * quantityOnHand to the per-product threshold
 * (reorderLevel ?? minimumStockLevel ?? 10), then paginates + re-orders the page
 * back into the raw query's updatedAt-desc order.
 *
 * These tests pin: (1) the raw query drives the result and ordering, (2) the
 * company scope is read off the SAME Prisma where applyCompanyScopeWhere built,
 * and (3) the empty-deny scope short-circuits without ever running SQL — so the
 * low-stock path can never leak across companies.
 */

function makeService(opts: { rawIds?: string[]; rows?: any[] }) {
  const queryRaw = jest.fn().mockResolvedValue((opts.rawIds ?? []).map((id) => ({ id })));
  const findMany = jest.fn().mockResolvedValue(opts.rows ?? []);
  const count = jest.fn().mockResolvedValue(0);
  const prisma = {
    $queryRaw: queryRaw,
    inventoryBalance: { findMany, count },
  } as any;
  const companyScope = {} as any;
  const service = new InventoryBalancesService(prisma, companyScope);
  return { service, prisma, queryRaw, findMany, count };
}

// A single-company user reaches exactly one company via applyCompanyScopeWhere,
// producing where.companyId = '<id>'.
const singleCompanyUser = { id: 'u1', companyId: 'company-A', companyAccess: [] } as any;

describe('InventoryBalancesService.findAll lowStock', () => {
  it('drives results from the raw query and preserves its updatedAt-desc order', async () => {
    const { service, queryRaw, findMany } = makeService({
      rawIds: ['b3', 'b1', 'b2'],
      // findMany returns in arbitrary order; the service must re-sort to rawIds order.
      rows: [
        { id: 'b1', product: {} },
        { id: 'b2', product: {} },
        { id: 'b3', product: {} },
      ],
    });

    const result = await service.findAll({ lowStock: true, page: 1, limit: 20 }, singleCompanyUser);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result.total).toBe(3);
    expect(result.data.map((r: any) => r.id)).toEqual(['b3', 'b1', 'b2']);
    // findMany is queried only for the page's ids.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['b3', 'b1', 'b2'] } } }),
    );
  });

  it('paginates over the raw id list (page 2)', async () => {
    const { service, findMany } = makeService({
      rawIds: ['b1', 'b2', 'b3', 'b4', 'b5'],
      rows: [
        { id: 'b3', product: {} },
        { id: 'b4', product: {} },
      ],
    });

    const result = await service.findAll({ lowStock: true, page: 2, limit: 2 }, singleCompanyUser);

    expect(result.total).toBe(5);
    expect(result.totalPages).toBe(3);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['b3', 'b4'] } } }),
    );
    expect(result.data.map((r: any) => r.id)).toEqual(['b3', 'b4']);
  });

  it('passes the company-scope + filters into the raw query as bound params', async () => {
    const { service, queryRaw } = makeService({ rawIds: [], rows: [] });

    await service.findAll(
      { lowStock: true, productId: 'prod-9', locationId: 'branch-7', page: 1, limit: 20 },
      singleCompanyUser,
    );

    // Prisma.sql captures the literal company id, product id and branch id as
    // bound values — assert the scope actually reached the query.
    const sql = queryRaw.mock.calls[0][0];
    expect(sql.values).toEqual(expect.arrayContaining(['company-A', 'prod-9', 'branch-7']));
  });

  it('short-circuits (no SQL) when the scope is the empty-deny sentinel', async () => {
    const { service, queryRaw, findMany } = makeService({ rawIds: ['x'], rows: [] });
    // A user with no accessible company resolves to { id: { in: [] } } — deny.
    const deniedUser = { id: 'u2', companyId: undefined, companyAccess: [] } as any;

    const result = await service.findAll({ lowStock: true, page: 1, limit: 20 }, deniedUser);

    expect(queryRaw).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });

  it('does not touch the raw query for the non-low-stock branch', async () => {
    const { service, queryRaw, findMany, count } = makeService({});
    findMany.mockResolvedValueOnce([{ id: 'b1' }]);
    count.mockResolvedValueOnce(1);

    await service.findAll({ page: 1, limit: 20 }, singleCompanyUser);

    expect(queryRaw).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { updatedAt: 'desc' } }),
    );
  });
});
