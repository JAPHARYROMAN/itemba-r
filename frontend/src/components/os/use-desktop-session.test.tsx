import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { parseDesktopSession } from '@/lib/desktop';
import { useDesktopSession, type SavedDesktopSession } from './use-desktop-session';
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<object>()),
  backendGet: api.get,
  backendPut: api.put,
}));
const id = '11111111-1111-4111-8111-111111111111';
const deviceId = '22222222-2222-4222-8222-222222222222';
const layout = (view = 'overview') =>
  parseDesktopSession({
    version: 1,
    activeId: 'records-one',
    windows: [
      {
        id: 'records-one',
        appId: 'records',
        href: '/records?view=' + view,
        minimized: false,
        mode: 'floating',
        bounds: { x: 20, y: 20, width: 900, height: 600 },
      },
    ],
  });
const row = (view = 'overview', revision = 3): SavedDesktopSession => ({
  id,
  deviceId,
  revision,
  name: 'Desktop workspace',
  layout: layout(view),
  updatedAt: new Date().toISOString(),
});
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem('itemba.desktop.session.owner', id);
  localStorage.setItem('itemba.desktop.device.owner', deviceId);
  api.get.mockResolvedValue([row()]);
  api.put.mockImplementation(async (_: string, input: { layout: unknown }) => ({
    ...row(),
    revision: 4,
    layout: input.layout,
  }));
});
describe('Workspace session continuity', () => {
  it('restores this device and writes layout changes against the acknowledged revision', async () => {
    const { result } = renderHook(() => useDesktopSession('owner'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.session).toEqual(layout());
    act(() => result.current.setSession(layout('debtors')));
    expect(result.current.status).toBe('Saving workspace…');
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/workspace/sessions/' + id,
        expect.objectContaining({ expectedRevision: 3, layout: layout('debtors') }),
      ),
    );
    await waitFor(() => expect(result.current.savedSessions[0].layout).toEqual(layout('debtors')));
  });
  it('returns to saved when a layout change is undone before the debounce', async () => {
    const { result } = renderHook(() => useDesktopSession('owner'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.setSession(layout('debtors')));
    expect(result.current.status).toBe('Saving workspace…');
    act(() => result.current.setSession(layout()));
    expect(result.current.status).toBe('Workspace saved');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 950)));
    expect(api.put).not.toHaveBeenCalled();
  });
  it('keeps local windows after a conflict and only replaces remote layout after an explicit choice', async () => {
    api.get.mockResolvedValueOnce([row()]).mockResolvedValue([row('creditors', 8)]);
    api.put
      .mockRejectedValueOnce(new ApiError('Conflict', 409, null))
      .mockResolvedValue({ ...row('debtors', 9) });
    const { result } = renderHook(() => useDesktopSession('owner'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.setSession(layout('debtors')));
    await waitFor(() => expect(result.current.recovery).toBe('conflict'));
    expect(result.current.session).toEqual(layout('debtors'));
    expect(api.put).toHaveBeenCalledTimes(1);
    await act(() => result.current.recover('keep'));
    await waitFor(() => expect(result.current.status).toBe('Workspace saved'));
    expect(api.put).toHaveBeenLastCalledWith(
      '/workspace/sessions/' + id,
      expect.objectContaining({ expectedRevision: 8, layout: layout('debtors') }),
    );
  });
  it('can explicitly restore the saved layout without replaying a rejected update', async () => {
    api.get.mockResolvedValueOnce([row()]).mockResolvedValue([row('creditors', 8)]);
    api.put.mockRejectedValue(new ApiError('Conflict', 409, null));
    const { result } = renderHook(() => useDesktopSession('owner'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.setSession(layout('debtors')));
    await waitFor(() => expect(result.current.recovery).toBe('conflict'));
    await act(() => result.current.recover('saved'));
    expect(result.current.session).toEqual(layout('creditors'));
    expect(result.current.recovery).toBeNull();
    expect(api.put).toHaveBeenCalledTimes(1);
  });
  it('reconciles a successful save whose response was lost', async () => {
    api.get.mockResolvedValueOnce([row()]).mockResolvedValue([row('debtors', 4)]);
    api.put.mockRejectedValueOnce(new TypeError('Network interrupted'));
    const { result } = renderHook(() => useDesktopSession('owner'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.setSession(layout('debtors')));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.status).toBe('Workspace saved'));
    expect(result.current.recovery).toBeNull();
  });
  it('offers a choice on initial recovery instead of overwriting an existing layout', async () => {
    api.get
      .mockRejectedValueOnce(new TypeError('Offline'))
      .mockResolvedValue([row('creditors', 8)]);
    const { result } = renderHook(() => useDesktopSession('owner'));
    await waitFor(() => expect(result.current.recovery).toBe('connection'));
    act(() => result.current.setSession(layout('debtors')));
    await act(() => result.current.recover('retry'));
    expect(result.current.recovery).toBe('conflict');
    expect(result.current.session).toEqual(layout('debtors'));
    expect(api.put).not.toHaveBeenCalled();
  });
  it('ignores an in-flight save when the owner changes and clears old private layouts', async () => {
    let finish!: (value: SavedDesktopSession) => void;
    api.put.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(({ owner }) => useDesktopSession(owner), {
      initialProps: { owner: 'owner' },
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.setSession(layout('debtors')));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    api.get.mockResolvedValue([]);
    rerender({ owner: 'new-owner' });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => finish(row('debtors', 4)));
    expect(result.current.session.windows).toHaveLength(0);
    expect(result.current.savedSessions).toEqual([]);
    expect(result.current.sessionId).not.toBe(id);
  });
});
