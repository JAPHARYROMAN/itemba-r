import { beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { deviceDatabase } from '../testing/device-database';
import { readActiveCart } from '../pos-workspace-store';
import { useHeldCarts } from './use-held-carts';

const state = vi.hoisted(() => ({ db: null as unknown as IDBDatabase }));
vi.mock('@/lib/mobile-pos-lite-store', () => ({ openDatabase: async () => state.db }));
beforeEach(() => {
  state.db = deviceDatabase().db;
});

it('rejects old workspace callbacks after an authority change without clearing either owner’s cart', async () => {
  const inputs = {
    cart: [{ product: { id: 'p1', sellingPrice: 1200 }, quantity: 1 }],
    customer: null,
    paymentMethod: 'CASH',
    paymentReference: '',
    receivedValue: '',
  };
  const view = renderHook(
    ({ scope }) =>
      useHeldCarts({
        scope,
        instance: 'window-a',
        enabled: true,
        editable: true,
        inputs: inputs as Parameters<typeof useHeldCarts>[0]['inputs'],
        restore: () => undefined,
        resolveSubmitted: async () => 'editable',
      }),
    { initialProps: { scope: 'alice' } },
  );
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  await act(() => view.result.current.flush());
  const old = view.result.current;
  view.rerender({ scope: 'bob' });
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  await act(() => view.result.current.flush());
  await expect(old.clear()).rejects.toThrow('no longer authorised');
  await expect(old.hold('Old cart', '')).rejects.toThrow('no longer authorised');
  expect((await readActiveCart('alice', 'window-a'))?.cart).toHaveLength(1);
  expect((await readActiveCart('bob', 'window-a'))?.cart).toHaveLength(1);
});
