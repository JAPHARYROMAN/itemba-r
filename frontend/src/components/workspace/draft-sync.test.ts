import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, backendGet, backendPost, backendPut } from '@/lib/api-client';
import { createDraftSync } from './draft-sync';
import { serializeDraftValues } from './draft-serializers';
import type { WorkspaceDraft } from './workspace-drafts';
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  backendGet: vi.fn(),
  backendPut: vi.fn(),
  backendPost: vi.fn(),
}));
const draft: WorkspaceDraft = {
  id: 'one',
  appId: 'invoice-desk',
  title: 'Purchase',
  context: { kind: 'invoice' },
  values: { amount: '100', companyId: 'company' },
  requestId: null,
  needsReview: false,
  updatedAt: 1,
};
beforeEach(() => vi.resetAllMocks());
describe('private automatic draft synchronization', () => {
  it('serializes only plain inputs and rejects local attachments', () => {
    expect(serializeDraftValues({ text: 'private', lines: [{ amount: '12' }] })).toEqual({
      text: 'private',
      lines: [{ amount: '12' }],
    });
    expect(() => serializeDraftValues({ file: new File(['hello'], 'bill.txt') })).toThrow(
      /attachments/,
    );
  });
  it('retains unsynchronized edits after network failure and retries the same revision', async () => {
    vi.mocked(backendPut)
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue({ revision: 1 });
    const sync = createDraftSync(() => {});
    sync.queue(draft);
    await expect(sync.flush(draft.id)).rejects.toThrow('offline');
    expect(sync.status(draft.id)).toBe('Offline');
    expect(sync.unsynced()).toBe(true);
    await sync.flush(draft.id);
    expect(sync.status(draft.id)).toBe('Saved');
    expect(sync.unsynced()).toBe(false);
    expect(vi.mocked(backendPut).mock.calls[1][1]).toMatchObject({
      expectedRevision: 0,
      content: { values: draft.values },
    });
  });
  it('does not overwrite a concurrent editor after a conflict', async () => {
    vi.mocked(backendPut).mockRejectedValue(new ApiError('Another editor', 409, {}));
    const sync = createDraftSync(() => {});
    sync.queue(draft);
    await expect(sync.flush(draft.id)).rejects.toThrow();
    const count = vi.mocked(backendPut).mock.calls.length;
    sync.retry();
    expect(vi.mocked(backendPut)).toHaveBeenCalledTimes(count);
    expect(sync.status(draft.id)).toBe('Needs attention');
    expect(sync.unsynced()).toBe(true);
  });
  it('writes transaction identity before acknowledging a save', async () => {
    vi.mocked(backendPut).mockResolvedValue({ revision: 1 });
    const sync = createDraftSync(() => {});
    sync.queue({ ...draft, requestId: 'original-transaction' });
    await sync.flush(draft.id);
    expect(backendPut).toHaveBeenCalledWith(
      '/workspace/drafts/one',
      expect.objectContaining({
        content: expect.objectContaining({ requestId: 'original-transaction' }),
      }),
    );
    expect(sync.status(draft.id)).toBe('Saved');
  });
});
