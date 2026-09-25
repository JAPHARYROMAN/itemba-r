import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { DEFAULT_APPEARANCE } from '@/lib/desktop';
import { useDesktopProfile } from './use-desktop-profile';
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), theme: vi.fn(), motion: vi.fn() }));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<object>()),
  backendGet: api.get,
  backendPut: api.put,
}));
vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ setMode: api.theme }) }));
vi.mock('@/hooks/use-motion-preference', () => ({
  useMotionPreference: () => ({ setMode: api.motion }),
}));
const saved = { ...DEFAULT_APPEARANCE, wallpaperId: 'itemba-v1-pearl-fold' };
const local = { ...DEFAULT_APPEARANCE, wallpaperId: 'itemba-interstellar-v1-event-horizon' };
const profile = (desktop = DEFAULT_APPEARANCE, desktopRevision = 3) => ({
  desktop,
  desktopRevision,
});
beforeEach(() => {
  vi.resetAllMocks();
  api.get.mockResolvedValue(profile());
  api.put.mockResolvedValue({ desktopRevision: 4 });
});

describe('Appearance recovery', () => {
  it('preserves a conflicting preview and only replaces the account after an explicit choice', async () => {
    api.get.mockResolvedValueOnce(profile()).mockResolvedValue(profile(saved, 8));
    api.put
      .mockRejectedValueOnce(new ApiError('Conflict', 409, null))
      .mockResolvedValue({ desktopRevision: 9 });
    const { result } = renderHook(() => useDesktopProfile('owner'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.update(() => local));
    await waitFor(() => expect(result.current.recovery).toBe('conflict'));
    expect(result.current.appearance.wallpaperId).toBe(local.wallpaperId);
    expect(api.put).toHaveBeenCalledTimes(1);
    await act(() => result.current.recover('keep'));
    await waitFor(() => expect(result.current.status).toBe('Synced to your account'));
    expect(api.put).toHaveBeenLastCalledWith(
      '/user-preferences/me',
      expect.objectContaining({ desktop: local, expectedDesktopRevision: 8 }),
    );
  });

  it('uses saved account settings without reloading or writing the conflicting local copy', async () => {
    api.get.mockResolvedValueOnce(profile()).mockResolvedValue(profile(saved, 8));
    api.put.mockRejectedValue(new ApiError('Conflict', 409, null));
    const { result } = renderHook(() => useDesktopProfile('owner'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.update(() => local));
    await waitFor(() => expect(result.current.recovery).toBe('conflict'));
    await act(() => result.current.recover('saved'));
    expect(result.current.appearance.wallpaperId).toBe(saved.wallpaperId);
    expect(result.current.recovery).toBeNull();
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('recognises an acknowledged save after its response was lost, without resubmitting', async () => {
    api.get.mockResolvedValueOnce(profile()).mockResolvedValue(profile(local, 4));
    api.put.mockRejectedValueOnce(new TypeError('Network interrupted'));
    const { result } = renderHook(() => useDesktopProfile('owner'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.update(() => local));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.status).toBe('Synced to your account'));
    expect(result.current.recovery).toBeNull();
    expect(result.current.appearance.wallpaperId).toBe(local.wallpaperId);
  });

  it('does not overwrite an established account when recovering an initial load failure', async () => {
    api.get.mockRejectedValueOnce(new TypeError('Offline')).mockResolvedValue(profile(saved, 8));
    const { result } = renderHook(() => useDesktopProfile('owner'));
    await waitFor(() => expect(result.current.recovery).toBe('connection'));
    act(() => result.current.update(() => local));
    await act(() => result.current.recover('retry'));
    expect(result.current.recovery).toBe('conflict');
    expect(result.current.appearance.wallpaperId).toBe(local.wallpaperId);
    expect(api.put).not.toHaveBeenCalled();
  });

  it('ignores an old account response after the owner changes', async () => {
    let finish!: (value: unknown) => void;
    api.get
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(profile(saved, 10));
    const { result, rerender } = renderHook(({ id }) => useDesktopProfile(id), {
      initialProps: { id: 'first' },
    });
    rerender({ id: 'second' });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => finish(profile(local, 4)));
    expect(result.current.appearance.wallpaperId).toBe(saved.wallpaperId);
    expect(api.put).not.toHaveBeenCalled();
  });
});
