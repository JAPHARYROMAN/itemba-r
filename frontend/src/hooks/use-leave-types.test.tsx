import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useLeaveTypes } from './use-leave-types';
const page = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ backendPage: page }));
beforeEach(() => page.mockReset());
it('loads every leave type page with the selected company scope', async () => {
  page
    .mockResolvedValueOnce({ data: [{ id: 'a', name: 'Annual' }], total: 2 })
    .mockResolvedValueOnce({ data: [{ id: 'b', name: 'Sick' }], total: 2 });
  const { result } = renderHook(() => useLeaveTypes('company'));
  await waitFor(() => expect(result.current.rows).toHaveLength(2));
  expect(page).toHaveBeenLastCalledWith(
    '/hr/leave-types',
    expect.objectContaining({ query: { companyId: 'company', page: 2, limit: 100 } }),
  );
});
it('does not present partial choices if a later page fails, and retries the complete read', async () => {
  page
    .mockResolvedValueOnce({ data: [{ id: 'a', name: 'Annual' }], total: 2 })
    .mockRejectedValueOnce(new Error('Second page unavailable'));
  const { result } = renderHook(() => useLeaveTypes('company'));
  await waitFor(() => expect(result.current.error).toBe('Second page unavailable'));
  expect(result.current.rows).toEqual([]);
  page.mockResolvedValue({ data: [{ id: 'b', name: 'Restored' }], total: 1 });
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.rows).toEqual([{ id: 'b', name: 'Restored' }]));
  expect(result.current.error).toBe('');
});
it('clears obsolete company choices and ignores a late response from that company', async () => {
  let finish: (v: unknown) => void = () => {};
  page
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ data: [{ id: 'new', name: 'Current' }], total: 1 });
  const { result, rerender } = renderHook(({ company }) => useLeaveTypes(company), {
    initialProps: { company: 'old' },
  });
  const previousSignal = page.mock.calls[0][1].signal as AbortSignal;
  rerender({ company: 'new' });
  await waitFor(() => expect(result.current.rows).toEqual([{ id: 'new', name: 'Current' }]));
  expect(previousSignal.aborted).toBe(true);
  await act(async () => finish({ data: [{ id: 'old', name: 'Obsolete' }], total: 1 }));
  expect(result.current.rows).toEqual([{ id: 'new', name: 'Current' }]);
});
