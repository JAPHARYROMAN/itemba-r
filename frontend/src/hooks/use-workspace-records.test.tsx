import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceRecords } from './use-workspace-records';
import { backendAllPages } from '@/lib/backend-all-pages';
const page = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ backendPage: page }));
beforeEach(() => {
  page.mockReset().mockResolvedValue({ data: [], total: 0 });
});
describe('Workspace requests', () => {
  it('keeps the latest filter results when an older request completes later', async () => {
    let resolveOld: (value: unknown) => void = () => undefined;
    page.mockImplementation(async (_path, opts) =>
      opts.query.search === 'old'
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : { data: [{ id: 'new' }], total: 1 },
    );
    const { result, rerender } = renderHook(
      ({ search }) => useWorkspaceRecords<{ id: string }>('/records', { search }, true),
      { initialProps: { search: 'old' } },
    );
    rerender({ search: 'new' });
    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'new' }]));
    await act(async () => resolveOld({ data: [{ id: 'old' }], total: 1 }));
    expect(result.current.rows).toEqual([{ id: 'new' }]);
    expect(page.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('exposes a recoverable error and makes no request without permission', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useWorkspaceRecords('/records', {}, enabled),
      { initialProps: { enabled: false } },
    );
    expect(page).not.toHaveBeenCalled();
    page.mockRejectedValueOnce(new Error('Unavailable'));
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.error).toBe('Unavailable'));
    await act(async () => result.current.reload());
    expect(result.current.error).toBe('');
  });
  it('fails the whole export if a later page fails rather than returning a partial register', async () => {
    page
      .mockResolvedValueOnce({ data: [{ id: 'first' }], total: 2 })
      .mockRejectedValueOnce(new Error('Page two unavailable'));
    await expect(backendAllPages('/employees', { companyId: 'allowed' })).rejects.toThrow(
      'Page two unavailable',
    );
    expect(page).toHaveBeenLastCalledWith(
      '/employees',
      expect.objectContaining({ query: { companyId: 'allowed', page: 2, limit: 100 } }),
    );
  });
});
