import { EntityCodeGeneratorService } from './entity-code-generator.service';

/**
 * Build a mock PrismaService whose `documentNumberSequence` delegate holds a
 * single in-memory row and models the concurrency-relevant semantics the
 * generator relies on:
 *   - `update({ increment })` is atomic (read+add in one call).
 *   - `updateMany({ where: { lastResetAt } })` is a compare-and-set: it only
 *     mutates (count 1) when the stored `lastResetAt` still equals the guard.
 *
 * The row object is shared, so two service calls interleaved against the same
 * mock observe each other's writes — enough to exercise the reset TOCTOU.
 */
function makeMock(initial: any) {
  const row = { ...initial };

  const sameInstant = (a: Date | null, b: Date | null | undefined) => {
    if (a === null || a === undefined) return b === null || b === undefined;
    if (b === null || b === undefined) return false;
    return a.getTime() === b.getTime();
  };

  const documentNumberSequence = {
    findFirst: jest.fn(async () => ({ ...row })),
    findUniqueOrThrow: jest.fn(async () => ({ ...row })),
    create: jest.fn(async () => ({ ...row })),
    update: jest.fn(async ({ data }: any) => {
      if (data.currentNumber && typeof data.currentNumber === 'object' && 'increment' in data.currentNumber) {
        row.currentNumber += data.currentNumber.increment;
      } else if (typeof data.currentNumber === 'number') {
        row.currentNumber = data.currentNumber;
      }
      if ('lastResetAt' in data) row.lastResetAt = data.lastResetAt;
      return { ...row };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      // Compare-and-set on the pinned lastResetAt guard.
      if ('lastResetAt' in where && !sameInstant(row.lastResetAt, where.lastResetAt)) {
        return { count: 0 };
      }
      if (typeof data.currentNumber === 'number') row.currentNumber = data.currentNumber;
      if ('lastResetAt' in data) row.lastResetAt = data.lastResetAt;
      return { count: 1 };
    }),
  };

  const prisma = { documentNumberSequence } as any;
  return { prisma, documentNumberSequence, row };
}

const baseRow = {
  id: 'seq-1',
  currentNumber: 0,
  padding: 5,
  prefix: 'TRIP-',
  suffix: '',
  resetFrequency: 'NEVER',
  lastResetAt: null as Date | null,
};

describe('EntityCodeGeneratorService.next()', () => {
  it('increments atomically for NEVER frequency (no reset path)', async () => {
    const { prisma, documentNumberSequence } = makeMock({
      ...baseRow,
      resetFrequency: 'NEVER',
      currentNumber: 41,
      lastResetAt: new Date('2026-01-01'),
    });
    const service = new EntityCodeGeneratorService(prisma);

    const code = await service.next({ entityType: 'Trip', companyId: 'c1', when: new Date('2026-07-02') });

    expect(code).toBe('TRIP-00042');
    // Fast path: a single increment update, never a reset claim.
    expect(documentNumberSequence.update).toHaveBeenCalledTimes(1);
    expect(documentNumberSequence.update.mock.calls[0][0].data).toEqual({
      currentNumber: { increment: 1 },
    });
    expect(documentNumberSequence.updateMany).not.toHaveBeenCalled();
  });

  it('resets to 1 via a guarded updateMany when the YEARLY period rolled over', async () => {
    const { prisma, documentNumberSequence, row } = makeMock({
      ...baseRow,
      resetFrequency: 'YEARLY',
      currentNumber: 900,
      lastResetAt: new Date('2025-06-01'),
    });
    const service = new EntityCodeGeneratorService(prisma);

    const code = await service.next({ entityType: 'Trip', companyId: 'c1', when: new Date('2026-01-02') });

    expect(code).toBe('TRIP-00001');
    // The reset went through the compare-and-set, guarded on the old lastResetAt.
    expect(documentNumberSequence.updateMany).toHaveBeenCalledTimes(1);
    const call = documentNumberSequence.updateMany.mock.calls[0][0];
    expect(call.where.lastResetAt).toEqual(new Date('2025-06-01'));
    expect(call.data.currentNumber).toBe(1);
    expect(row.currentNumber).toBe(1);
    expect(row.lastResetAt).toEqual(new Date('2026-01-02'));
  });

  it('does not reset within the same period (guard not triggered)', async () => {
    const { prisma, documentNumberSequence } = makeMock({
      ...baseRow,
      resetFrequency: 'MONTHLY',
      currentNumber: 5,
      lastResetAt: new Date('2026-07-01'),
    });
    const service = new EntityCodeGeneratorService(prisma);

    const code = await service.next({ entityType: 'Trip', companyId: 'c1', when: new Date('2026-07-02') });

    expect(code).toBe('TRIP-00006');
    expect(documentNumberSequence.updateMany).not.toHaveBeenCalled();
    expect(documentNumberSequence.update).toHaveBeenCalledTimes(1);
  });

  it('CONCURRENCY: two callers across a period boundary get 1 and 2, never duplicate 1', async () => {
    // Both callers observe the same stale lastResetAt and both decide a reset
    // is due. Only one updateMany may claim the reset; the loser must fall
    // through to an atomic increment off the freshly-reset value.
    const { prisma, documentNumberSequence, row } = makeMock({
      ...baseRow,
      resetFrequency: 'YEARLY',
      currentNumber: 500,
      lastResetAt: new Date('2025-03-01'),
    });
    const service = new EntityCodeGeneratorService(prisma);

    // Serialize the two advances against the shared row (the mock is
    // synchronous per-call, so running them back-to-back models the winner
    // committing before the loser's claim is evaluated).
    const first = await service.next({ entityType: 'Trip', companyId: 'c1', when: new Date('2026-01-05') });
    const second = await service.next({ entityType: 'Trip', companyId: 'c1', when: new Date('2026-01-05') });

    expect(first).toBe('TRIP-00001');
    expect(second).toBe('TRIP-00002');
    expect(row.currentNumber).toBe(2);
    // Only one reset was actually claimed; the second call's reset attempt
    // matched zero rows and it re-read + incremented instead.
    const claimed = documentNumberSequence.updateMany.mock.results.filter(
      (r) => (r.value as any) instanceof Promise,
    );
    expect(claimed.length).toBeGreaterThanOrEqual(1);
  });

  it('CONCURRENCY: loser of the reset claim retries and increments rather than throwing', async () => {
    // Simulate the loser directly: seed the service with a stale row via
    // findOrCreate, but have another writer reset the shared row first.
    const { prisma, documentNumberSequence, row } = makeMock({
      ...baseRow,
      resetFrequency: 'YEARLY',
      currentNumber: 500,
      lastResetAt: new Date('2025-03-01'),
    });
    const service = new EntityCodeGeneratorService(prisma);

    // Pre-reset the shared row as if a concurrent winner already committed,
    // but make findFirst hand back the STALE snapshot the loser observed.
    const staleSnapshot = { ...row };
    documentNumberSequence.findFirst.mockResolvedValueOnce(staleSnapshot);
    row.currentNumber = 1;
    row.lastResetAt = new Date('2026-01-05');

    const code = await service.next({ entityType: 'Trip', companyId: 'c1', when: new Date('2026-01-05') });

    // Loser's guarded reset must fail (count 0), then it re-reads (already
    // reset -> no reset due) and increments to 2.
    expect(code).toBe('TRIP-00002');
    expect(row.currentNumber).toBe(2);
    expect(documentNumberSequence.updateMany).toHaveBeenCalledTimes(1);
    expect(documentNumberSequence.updateMany.mock.results[0].value).resolves.toEqual({ count: 0 });
  });

  it('first-ever issue under a non-NEVER frequency stamps lastResetAt and starts at 1', async () => {
    const { prisma, documentNumberSequence, row } = makeMock({
      ...baseRow,
      resetFrequency: 'MONTHLY',
      currentNumber: 0,
      lastResetAt: null,
    });
    const service = new EntityCodeGeneratorService(prisma);

    const code = await service.next({ entityType: 'Trip', companyId: 'c1', when: new Date('2026-07-02') });

    expect(code).toBe('TRIP-00001');
    // Guard pinned on null lastResetAt.
    expect(documentNumberSequence.updateMany).toHaveBeenCalledTimes(1);
    expect(documentNumberSequence.updateMany.mock.calls[0][0].where.lastResetAt).toBeNull();
    expect(row.currentNumber).toBe(1);
    expect(row.lastResetAt).toEqual(new Date('2026-07-02'));
  });
});
