import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOrgScope } from './use-org-scope';
const page = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ backendPage: page }));
beforeEach(() => page.mockReset().mockResolvedValue({ data: [], total: 0 }));

describe('Organisation choices', () => {
  it('loads every company page and does not request skipped resources', async () => {
    page.mockImplementation(async (path, options) =>
      path === '/companies'
        ? {
            data: [
              {
                id: `company-${options.query.page}`,
                name: 'Company',
                code: String(options.query.page),
              },
            ],
            total: 2,
          }
        : { data: [], total: 0 },
    );
    const { result } = renderHook(() => useOrgScope('company-1', { skipEmployees: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.companies.map((row) => row.id)).toEqual(['company-1', 'company-2']);
    expect(page.mock.calls.some(([path]) => path === '/hr/employees')).toBe(false);
  });
  it('clears old hierarchy immediately and ignores responses for a previous company', async () => {
    let resolveOld: (value: unknown) => void = () => undefined;
    page.mockImplementation(async (path, options) => {
      if (path !== '/branches') return { data: [], total: 0 };
      if (options.query.companyId === 'old')
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      return {
        data: [
          { id: 'new-branch', name: 'New', division: { id: 'new-division', companyId: 'new' } },
        ],
        total: 1,
      };
    });
    const { result, rerender } = renderHook(
      ({ company }) => useOrgScope(company, { skipEmployees: true }),
      { initialProps: { company: 'old' } },
    );
    await waitFor(() => expect(result.current.scopeLoading).toBe(true));
    rerender({ company: 'new' });
    expect(result.current.branches).toEqual([]);
    await waitFor(() => expect(result.current.branches[0]?.id).toBe('new-branch'));
    await act(async () => resolveOld({ data: [{ id: 'old-branch' }], total: 1 }));
    expect(result.current.branches[0]).toMatchObject({
      id: 'new-branch',
      companyId: 'new',
      divisionId: 'new-division',
    });
  });
  it('exposes failed choices and retries them without clearing selected form values', async () => {
    page.mockRejectedValueOnce(new Error('Unavailable'));
    const { result } = renderHook(() => useOrgScope(undefined));
    await waitFor(() =>
      expect(result.current.error).toContain('Company choices could not be loaded'),
    );
    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('');
    expect(page).toHaveBeenCalledTimes(2);
  });
});
