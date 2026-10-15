import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveStockCount, type CountRecovery } from './inventory-adjustment-save';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  backendGet: api.get,
  backendPost: api.post,
  backendPatch: api.patch,
}));
const count = (): CountRecovery => ({
  request: {
    companyId: 'company',
    branchId: 'branch',
    reason: 'Physical count',
    idempotencyKey: 'count-key',
    lines: [
      {
        productId: 'product',
        unitId: 'unit',
        systemQuantity: 10,
        countedQuantity: 8.125,
        expectedRevision: 7,
      },
    ],
  },
});
const draft = {
  id: 'saved-draft',
  companyId: 'company',
  divisionId: 'authoritative-division',
  branchId: 'branch',
  reason: 'Physical count',
  notes: null,
  status: 'DRAFT',
  updatedAt: '2026-10-13T10:00:00.000Z',
  lines: [
    {
      id: 'line',
      productId: 'product',
      unitId: 'unit',
      systemQuantity: '10.0000',
      countedQuantity: '8.1250',
      varianceQuantity: '-1.8750',
      unitCost: null,
      reason: null,
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  api.post.mockResolvedValue(draft);
  api.get.mockResolvedValue(draft);
  api.patch.mockResolvedValue({ ...draft, status: 'PENDING_APPROVAL' });
});
describe('stock count recovery', () => {
  it('persists the returned ID before submission and retains captured lines', async () => {
    const state = count();
    const persist = vi.fn(async () => {
      expect(api.patch).not.toHaveBeenCalled();
      expect(state.recordId).toBe('saved-draft');
    });
    const result = await saveStockCount(state, persist, true);
    expect(result.status).toBe('PENDING_APPROVAL');
    expect(api.patch).toHaveBeenCalledWith('/stock-adjustments/saved-draft/submit', {
      expectedUpdatedAt: draft.updatedAt,
    });
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it('replays the exact key and payload after an unknown creation outcome', async () => {
    const state = count(),
      persist = vi.fn(async () => {});
    api.post.mockRejectedValueOnce(new Error('Connection lost'));
    await expect(saveStockCount(state, persist, true)).rejects.toThrow('Connection lost');
    await saveStockCount(state, persist, true);
    expect(api.post.mock.calls[0][1]).toBe(api.post.mock.calls[1][1]);
    expect(api.post.mock.calls[1][1].idempotencyKey).toBe('count-key');
  });
  it('verifies uncertain submission and retries the same saved draft', async () => {
    const state = count(),
      persist = vi.fn(async () => {});
    api.patch.mockRejectedValueOnce(new Error('Submission unavailable'));
    await expect(saveStockCount(state, persist, true)).rejects.toThrow('Submission unavailable');
    await saveStockCount(state, persist, true);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.patch.mock.calls.map((call) => call[0])).toEqual([
      '/stock-adjustments/saved-draft/submit',
      '/stock-adjustments/saved-draft/submit',
    ]);
  });
  it('recognizes a committed submission after the response was lost', async () => {
    const state = count();
    api.patch.mockRejectedValueOnce(new Error('Connection lost'));
    api.get.mockResolvedValueOnce({ ...draft, status: 'PENDING_APPROVAL' });
    expect((await saveStockCount(state, async () => {}, true)).status).toBe('PENDING_APPROVAL');
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it('retains the captured version and refuses to submit a draft edited during recovery', async () => {
    const state = count();
    api.patch.mockRejectedValueOnce(new Error('Submission unavailable'));
    await expect(saveStockCount(state, async () => {}, true)).rejects.toThrow(
      'Submission unavailable',
    );
    expect(state.expectedUpdatedAt).toBe(draft.updatedAt);
    api.get.mockResolvedValue({ ...draft, updatedAt: '2026-10-13T10:01:00.000Z' });
    await expect(saveStockCount(state, async () => {}, true)).rejects.toThrow(
      'saved count changed',
    );
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it('never submits until persistence of the saved identity succeeds', async () => {
    const state = count();
    await expect(
      saveStockCount(
        state,
        async () => {
          throw new Error('Draft lease lost');
        },
        true,
      ),
    ).rejects.toThrow('Draft lease lost');
    expect(state.recordId).toBe('saved-draft');
    expect(api.patch).not.toHaveBeenCalled();
  });
  it.each(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'REJECTED'])(
    'rejects edited captured content during known-ID %s recovery',
    async (status) => {
      const state = { ...count(), recordId: draft.id, expectedUpdatedAt: draft.updatedAt };
      api.get.mockResolvedValue({
        ...draft,
        status,
        lines: [{ ...draft.lines[0], countedQuantity: '7.0000', varianceQuantity: '-3.0000' }],
      });
      await expect(saveStockCount(state, async () => {}, true)).rejects.toThrow(
        'saved count changed',
      );
      expect(api.post).not.toHaveBeenCalled();
      expect(api.patch).not.toHaveBeenCalled();
      expect(state.recordId).toBe(draft.id);
      expect(state.request.idempotencyKey).toBe('count-key');
    },
  );
  it('rejects an edited submitted count after uncertain submission instead of reporting success', async () => {
    const state = count();
    api.patch.mockRejectedValue(new Error('Submission response lost'));
    api.get.mockResolvedValue({
      ...draft,
      status: 'PENDING_APPROVAL',
      lines: [{ ...draft.lines[0], countedQuantity: '7', varianceQuantity: '-3' }],
    });
    await expect(saveStockCount(state, async () => {}, true)).rejects.toThrow(
      'saved count changed',
    );
    expect(state.recordId).toBe(draft.id);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it.each([
    { branchId: 'other-branch' },
    { companyId: 'other-company' },
    { reason: 'Changed reason' },
    { notes: 'Changed notes' },
    { lines: [] },
    { lines: [{ ...draft.lines[0], unitId: 'changed-unit' }] },
    { lines: [{ ...draft.lines[0], varianceQuantity: '-9' }] },
    { lines: [{ ...draft.lines[0], unitCost: '20' }] },
  ])('refuses changed identity, scope or incomplete capture data', async (edited) => {
    const state = { ...count(), recordId: draft.id, expectedUpdatedAt: draft.updatedAt };
    api.get.mockResolvedValue({ ...draft, status: 'PENDING_APPROVAL', ...edited });
    await expect(saveStockCount(state, async () => {}, true)).rejects.toThrow(
      'saved count changed',
    );
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });
  it('recovers unchanged content with a later status timestamp and authoritative division', async () => {
    const state = { ...count(), recordId: draft.id, expectedUpdatedAt: draft.updatedAt };
    api.get.mockResolvedValue({
      ...draft,
      status: 'POSTED',
      updatedAt: '2026-10-13T12:00:00Z',
      lines: [
        {
          ...draft.lines[0],
          systemQuantity: 10.000000000000002,
          countedQuantity: 8.125,
          varianceQuantity: -1.875,
          reason: undefined,
          unitCost: undefined,
        },
      ],
    });
    expect((await saveStockCount(state, async () => {}, true)).status).toBe('POSTED');
    expect(api.patch).not.toHaveBeenCalled();
  });
  it('matches multiple lines independently of response order and rejects a one-tick edit', async () => {
    const state = { ...count(), recordId: draft.id, expectedUpdatedAt: draft.updatedAt };
    state.request.lines.push({
      productId: 'second',
      unitId: 'unit',
      systemQuantity: 0.1234,
      countedQuantity: 0.1236,
    });
    const second = {
      id: 'second-line',
      productId: 'second',
      unitId: 'unit',
      systemQuantity: '0.1234',
      countedQuantity: '0.1236',
      varianceQuantity: '0.0002',
      unitCost: null,
      reason: null,
    };
    api.get.mockResolvedValue({ ...draft, status: 'APPROVED', lines: [second, draft.lines[0]] });
    expect((await saveStockCount(state, async () => {}, true)).status).toBe('APPROVED');
    api.get.mockResolvedValue({
      ...draft,
      status: 'APPROVED',
      lines: [{ ...second, countedQuantity: '0.1237', varianceQuantity: '0.0003' }, draft.lines[0]],
    });
    await expect(saveStockCount(state, async () => {}, true)).rejects.toThrow(
      'saved count changed',
    );
  });
  it('does not collapse a large decimal count to a nearby edited count', async () => {
    const state = { ...count(), recordId: draft.id, expectedUpdatedAt: draft.updatedAt };
    state.request.lines = [
      {
        productId: 'product',
        unitId: 'unit',
        systemQuantity: 1234567890123,
        countedQuantity: 1234567890124,
      },
    ];
    api.get.mockResolvedValue({
      ...draft,
      status: 'APPROVED',
      lines: [
        {
          ...draft.lines[0],
          systemQuantity: '1234567890123.0000',
          countedQuantity: '1234567890124.0000',
          varianceQuantity: '1.0000',
        },
      ],
    });
    expect((await saveStockCount(state, async () => {}, true)).status).toBe('APPROVED');
    api.get.mockResolvedValue({
      ...draft,
      status: 'APPROVED',
      lines: [
        {
          ...draft.lines[0],
          systemQuantity: '1234567890123.0000',
          countedQuantity: '1234567890124.0001',
          varianceQuantity: '1.0001',
        },
      ],
    });
    await expect(saveStockCount(state, async () => {}, true)).rejects.toThrow(
      'saved count changed',
    );
  });
  it('fails closed when an optional cost contains invalid data', async () => {
    const state = { ...count(), recordId: draft.id, expectedUpdatedAt: draft.updatedAt };
    api.get.mockResolvedValue({
      ...draft,
      status: 'APPROVED',
      lines: [{ ...draft.lines[0], unitCost: 'invalid' }],
    });
    await expect(saveStockCount(state, async () => {}, true)).rejects.toThrow(
      'saved count changed',
    );
  });
  it('verifies a header-only submission response and refuses an unchanged DRAFT result', async () => {
    api.patch.mockResolvedValueOnce({ id: draft.id, status: 'PENDING_APPROVAL' });
    expect((await saveStockCount(count(), async () => {}, true)).lines).toEqual(draft.lines);
    api.patch.mockResolvedValueOnce({ id: draft.id, status: 'DRAFT' });
    await expect(saveStockCount(count(), async () => {}, true)).rejects.toThrow(
      'Submission did not complete',
    );
  });
});
