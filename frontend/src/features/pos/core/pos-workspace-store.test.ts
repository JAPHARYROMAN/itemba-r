import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceDatabase } from './testing/device-database';
import {
  clearActiveCart,
  holdActiveCart,
  listHeldCarts,
  readActiveCart,
  resumeHeldCart,
  saveActiveCart,
  updateHeldCart,
  type PosCartDraft,
} from './pos-workspace-store';
const h = vi.hoisted(() => ({ db: null as unknown as IDBDatabase }));
vi.mock('@/lib/mobile-pos-lite-store', () => ({ openDatabase: async () => h.db }));
let harness: ReturnType<typeof deviceDatabase>;
const draft = (instance = 'window-a', scope = 'terminal/owner/company/branch'): PosCartDraft => ({
  schemaVersion: 1,
  id: `cart-${instance}`,
  requestId: `original-${instance}`,
  revision: 0,
  scope,
  instance,
  state: 'active',
  name: 'Asha',
  note: 'Collect later',
  updatedAt: new Date().toISOString(),
  cart: [
    {
      product: {
        id: 'water',
        name: 'Water',
        code: 'W',
        barcode: null,
        unitId: 'u',
        unitSymbol: 'pc',
        sellingPrice: 1200,
        availableStock: 10,
        trackInventory: true,
      },
      quantity: 2,
      price: { unitPrice: 1000, reason: 'REGULAR_CUSTOMER' },
    },
  ],
  customer: { id: 'asha', name: 'Asha' },
  paymentMethod: 'MOBILE_MONEY',
  paymentReference: 'MP-1',
  receivedValue: '2000',
});
beforeEach(() => {
  harness = deviceDatabase();
  h.db = harness.db;
});
describe('device-private held carts', () => {
  it('keeps two active windows independent and restores all inputs after reopening', async () => {
    const a = await saveActiveCart(draft(), 0);
    await saveActiveCart({ ...draft('window-b'), customer: null, paymentMethod: 'CASH' }, 0);
    expect(await readActiveCart(a.scope, 'window-a')).toEqual(a);
    expect((await readActiveCart(a.scope, 'window-b'))?.customer).toBeNull();
    expect(await listHeldCarts(a.scope)).toEqual([]);
  });
  it('atomically moves an unpaid cart and only one competing window can claim it', async () => {
    const a = await saveActiveCart(draft(), 0);
    const held = await holdActiveCart(a, a.revision);
    expect(await readActiveCart(a.scope, a.instance)).toBeNull();
    const results = await Promise.allSettled([
      resumeHeldCart(a.scope, 'b', a.id, held.revision),
      resumeHeldCart(a.scope, 'c', a.id, held.revision),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await listHeldCarts(a.scope)).toEqual([]);
    const winner = results.find((r) => r.status === 'fulfilled');
    if (winner?.status === 'fulfilled')
      expect(winner.value).toMatchObject({
        requestId: a.requestId,
        cart: a.cart,
        customer: a.customer,
        paymentReference: 'MP-1',
      });
  });
  it('rejects stale writes, rename/discard and scope changes without replacing saved work', async () => {
    const a = await saveActiveCart(draft(), 0);
    await expect(saveActiveCart({ ...a, customer: null }, 0)).rejects.toThrow();
    const held = await holdActiveCart(a, a.revision);
    await updateHeldCart({ ...held, name: 'Renamed' });
    await expect(updateHeldCart(held, true)).rejects.toThrow();
    expect(await listHeldCarts('other-owner')).toEqual([]);
    await expect(resumeHeldCart('other-owner', 'b', held.id, held.revision)).rejects.toThrow();
    expect((await listHeldCarts(a.scope))[0].name).toBe('Renamed');
  });
  it('rolls back aborted writes and does not acknowledge them', async () => {
    harness.abortNext();
    await expect(saveActiveCart(draft(), 0)).rejects.toThrow();
    expect(await readActiveCart(draft().scope, 'window-a')).toBeNull();
  });
  it('never resumes a submitted cart, replaces an active cart or clears a newer revision', async () => {
    const a = await saveActiveCart(draft(), 0);
    await expect(holdActiveCart({ ...a, state: 'submitted' }, a.revision)).rejects.toThrow();
    await expect(clearActiveCart(a.scope, a.instance, a.id, 0)).rejects.toThrow();
    const b = await saveActiveCart(draft('window-b'), 0);
    const held = await holdActiveCart(b, b.revision);
    await expect(resumeHeldCart(a.scope, a.instance, b.id, held.revision)).rejects.toThrow();
    expect(await readActiveCart(a.scope, a.instance)).toEqual(a);
  });
});
