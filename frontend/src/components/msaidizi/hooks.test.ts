import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MsaidiziCapabilities } from '@/lib/msaidizi-types';
import { useMsaidiziCapabilities, useMsaidiziConversations } from './hooks';

vi.mock('@/lib/msaidizi-client', () => ({
  fetchMsaidiziCapabilities: vi.fn(),
  listMsaidiziConversations: vi.fn(),
  deleteMsaidiziConversation: vi.fn(),
}));

const client = await import('@/lib/msaidizi-client');
const fetchCapabilities = vi.mocked(client.fetchMsaidiziCapabilities);
const listConversations = vi.mocked(client.listMsaidiziConversations);
const removeConversation = vi.mocked(client.deleteMsaidiziConversation);

const OFF: MsaidiziCapabilities = {
  enabled: false,
  writeMode: 'read-only',
  allowedTiers: ['green'],
  budgets: { maxToolCalls: 40, maxWrites: 10, toolBudget: 60 },
  narrowing: { active: false, permitted: 0, perRun: 0 },
  capabilities: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useMsaidiziCapabilities', () => {
  it('reports the off state rather than treating it as a failure to load', async () => {
    fetchCapabilities.mockResolvedValue(OFF);

    const { result } = renderHook(() => useMsaidiziCapabilities());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.capabilities).toEqual(OFF);
    expect(result.current.error).toBeNull();
  });

  // Defaulting to a read-only shape here would put "it cannot change anything"
  // on screen without having asked — the exact lie the endpoint was added to
  // prevent, arriving through the error path instead of the happy one.
  it('holds nothing at all when the check fails, rather than assuming read-only', async () => {
    fetchCapabilities.mockRejectedValue(new Error('Service Unavailable'));

    const { result } = renderHook(() => useMsaidiziCapabilities());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.capabilities).toBeNull();
    expect(result.current.error).toBe('Service Unavailable');
  });
});

describe('useMsaidiziConversations', () => {
  it('reads the totals off `meta`, which is not the house paginator', async () => {
    listConversations.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 7 },
    });

    const { result } = renderHook(() => useMsaidiziConversations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.total).toBe(7);
  });

  it('does not call the list at all while the module is known to be off', async () => {
    const { result } = renderHook(() => useMsaidiziConversations({ enabled: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(listConversations).not.toHaveBeenCalled();
  });

  it('refreshes after a removal, and surfaces a refusal instead of swallowing it', async () => {
    listConversations.mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    removeConversation.mockResolvedValue({ id: 'c1', removed: true });

    const { result } = renderHook(() => useMsaidiziConversations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.remove('c1');
    expect(removeConversation).toHaveBeenCalledWith('c1');
    expect(listConversations).toHaveBeenCalledTimes(2);

    removeConversation.mockRejectedValue(new Error('Conversation not found.'));
    await result.current.remove('gone');
    await waitFor(() => expect(result.current.error).toBe('Conversation not found.'));
    // The failed removal must not have triggered a reload that hides the message.
    expect(listConversations).toHaveBeenCalledTimes(2);
  });
});
