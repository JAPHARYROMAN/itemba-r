import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceChoices } from './use-workspace-choices';
const page = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ backendPage: page }));
beforeEach(() => page.mockReset());
it('loads every selector page with its company scope', async () => {
  page
    .mockResolvedValueOnce({ data: [{ id: 'a' }], total: 2 })
    .mockResolvedValueOnce({ data: [{ id: 'b' }], total: 2 });
  const { result } = renderHook(() =>
    useWorkspaceChoices('/hr/payroll-periods', { companyId: 'company' }),
  );
  await waitFor(() => expect(result.current.rows).toHaveLength(2));
  expect(page).toHaveBeenLastCalledWith(
    '/hr/payroll-periods',
    expect.objectContaining({ query: { companyId: 'company', page: 2, limit: 100 } }),
  );
});
it('discards incomplete choices after a later page fails and retries the full query', async () => {
  page
    .mockResolvedValueOnce({ data: [{ id: 'a' }], total: 2 })
    .mockRejectedValueOnce(new Error('Later page failed'));
  const { result } = renderHook(() =>
    useWorkspaceChoices('/chart-of-accounts', { companyId: 'company' }),
  );
  await waitFor(() => expect(result.current.error).toBe('Later page failed'));
  expect(result.current.rows).toEqual([]);
  page.mockResolvedValue({ data: [{ id: 'restored' }], total: 1 });
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.rows).toEqual([{ id: 'restored' }]));
  expect(result.current.error).toBe('');
});
it('aborts obsolete scope loads and ignores late results', async () => {
  let finish: (v: unknown) => void = () => {};
  page
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ data: [{ id: 'new' }], total: 1 });
  const { result, rerender } = renderHook(
    ({ company }) => useWorkspaceChoices('/hr/payroll-runs', { companyId: company }),
    { initialProps: { company: 'old' } },
  );
  const signal = page.mock.calls[0][1].signal as AbortSignal;
  rerender({ company: 'new' });
  await waitFor(() => expect(result.current.rows).toEqual([{ id: 'new' }]));
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ data: [{ id: 'old' }], total: 1 }));
  expect(result.current.rows).toEqual([{ id: 'new' }]);
});
it('does not fetch disabled choices and clears them when permission is removed', async () => {
  page.mockResolvedValue({ data: [{ id: 'allowed' }], total: 1 });
  const { result, rerender } = renderHook(
    ({ enabled }) => useWorkspaceChoices('/hr/payroll-runs', {}, enabled),
    { initialProps: { enabled: false } },
  );
  expect(page).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await waitFor(() => expect(result.current.rows).toHaveLength(1));
  const signal = page.mock.calls[0][1].signal as AbortSignal;
  rerender({ enabled: false });
  expect(result.current.rows).toEqual([]);
  expect(signal.aborted).toBe(true);
});
