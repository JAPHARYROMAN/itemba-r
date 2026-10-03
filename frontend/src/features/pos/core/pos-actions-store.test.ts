import { beforeEach, expect, it, vi } from 'vitest';
import { deviceDatabase } from './testing/device-database';
import { clearPosAction, readPosAction, savePosAction, type PosAction } from './pos-actions-store';
const h = vi.hoisted(() => ({ db: null as unknown as IDBDatabase }));
vi.mock('@/lib/mobile-pos-lite-store', () => ({ openDatabase: async () => h.db }));
let harness: ReturnType<typeof deviceDatabase>;
const action: PosAction = {
  requestId: 'original-request',
  saleId: 'sale',
  kind: 'collections',
  body: { requestId: 'original-request', method: 'CASH', amount: 100 },
};
beforeEach(() => {
  harness = deviceDatabase();
  h.db = harness.db;
});
it('restores an acknowledged frozen request and keeps other owners private', async () => {
  await savePosAction('owner-a', action);
  expect(await readPosAction('owner-a')).toEqual(action);
  expect(await readPosAction('owner-b')).toBeNull();
});
it('does not acknowledge a write that aborts', async () => {
  harness.abortNext();
  await expect(savePosAction('a', action)).rejects.toThrow();
  expect(await readPosAction('a')).toBeNull();
});
it('prevents two windows from replacing an unresolved financial request', async () => {
  const results = await Promise.allSettled([
    savePosAction('a', action),
    savePosAction('a', { ...action, requestId: 'different-request' }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await readPosAction('a')).toEqual(action);
  await expect(clearPosAction('a', 'different-request')).rejects.toThrow();
  expect(await readPosAction('a')).toEqual(action);
});
it('allows a refusal marker without altering the original financial inputs', async () => {
  await savePosAction('a', action);
  await expect(
    savePosAction('a', { ...action, body: { ...action.body, amount: 200 } }),
  ).rejects.toThrow();
  expect(await readPosAction('a')).toEqual(action);
  await savePosAction('a', { ...action, rejected: true });
  await clearPosAction('a', action.requestId);
  expect(await readPosAction('a')).toBeNull();
});
