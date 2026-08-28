import { MsaidiziTaskStatus } from '@prisma/client';
import {
  authoritativeRemainingTaskWallTimeMs,
  authoritativeTaskWallTimeExceeded,
  checkpointTaskWallTimeForAuthorization,
  projectedTaskWallTimeMs,
  remainingTaskWallTimeMs,
  taskWallTimeExceeded,
} from './msaidizi-task-wall-time';

describe('Msaidizi durable task wall time', () => {
  const checkpoint = new Date('2026-08-28T08:00:00.000Z');

  it('projects a persisted open interval after a process restart', () => {
    const reloaded = {
      consumedWallTimeMs: 12_500n,
      wallTimeCheckpointAt: checkpoint,
      maxWallTimeSeconds: 60,
    };

    expect(projectedTaskWallTimeMs(reloaded, new Date('2026-08-28T08:00:02.250Z'))).toBe(14_750n);
  });

  it('keeps the hard clock advancing while a task is paused or cancelling', () => {
    const persistedPausedOrCancellingTask = {
      consumedWallTimeMs: '5000',
      wallTimeCheckpointAt: checkpoint.toISOString(),
      maxWallTimeSeconds: 30,
    };

    expect(
      projectedTaskWallTimeMs(
        persistedPausedOrCancellingTask,
        new Date('2026-08-28T08:00:07.000Z'),
      ),
    ).toBe(12_000n);
  });

  it('does not reset elapsed usage on resume', () => {
    const resumed = {
      consumedWallTimeMs: 30_000n,
      wallTimeCheckpointAt: new Date('2026-08-28T08:01:00.000Z'),
      maxWallTimeSeconds: 120,
    };

    expect(projectedTaskWallTimeMs(resumed, new Date('2026-08-28T08:01:05.000Z'))).toBe(35_000n);
    expect(remainingTaskWallTimeMs(resumed, new Date('2026-08-28T08:01:05.000Z'))).toBe(85_000n);
  });

  it('freezes a terminal task at its persisted checkpoint', () => {
    const terminal = {
      consumedWallTimeMs: 42_125n,
      wallTimeCheckpointAt: null,
      maxWallTimeSeconds: 60,
    };

    expect(projectedTaskWallTimeMs(terminal, new Date('2099-01-01T00:00:00.000Z'))).toBe(42_125n);
  });

  it('enforces the millisecond ceiling without rounding down elapsed time', () => {
    const task = {
      consumedWallTimeMs: 9_500n,
      wallTimeCheckpointAt: checkpoint,
      maxWallTimeSeconds: 10,
    };

    expect(taskWallTimeExceeded(task, new Date('2026-08-28T08:00:00.499Z'))).toBe(false);
    expect(taskWallTimeExceeded(task, new Date('2026-08-28T08:00:00.500Z'))).toBe(true);
    expect(remainingTaskWallTimeMs(task, new Date('2026-08-28T08:00:00.750Z'))).toBe(0n);
  });

  it('ignores an older clock observation instead of subtracting usage', () => {
    const task = {
      consumedWallTimeMs: 8_000n,
      wallTimeCheckpointAt: checkpoint,
      maxWallTimeSeconds: 60,
    };

    expect(projectedTaskWallTimeMs(task, new Date('2026-08-28T07:59:59.000Z'))).toBe(8_000n);
  });

  it.each([['not-an-integer'], [-1n], [Number.MAX_SAFE_INTEGER + 1]])(
    'fails the hard budget closed for corrupt consumed usage %p',
    (consumedWallTimeMs) => {
      const task = {
        consumedWallTimeMs,
        wallTimeCheckpointAt: checkpoint,
        maxWallTimeSeconds: 60,
      };

      expect(taskWallTimeExceeded(task)).toBe(true);
      expect(remainingTaskWallTimeMs(task)).toBe(0n);
      expect(() => projectedTaskWallTimeMs(task)).toThrow('INVALID_CONSUMED_WALL_TIME');
    },
  );

  it('fails the hard budget closed for a corrupt persisted checkpoint', () => {
    const task = {
      consumedWallTimeMs: 1_000n,
      wallTimeCheckpointAt: 'not-a-timestamp',
      maxWallTimeSeconds: 60,
    };

    expect(taskWallTimeExceeded(task)).toBe(true);
    expect(remainingTaskWallTimeMs(task)).toBe(0n);
    expect(() => projectedTaskWallTimeMs(task)).toThrow('INVALID_WALL_TIME_CHECKPOINT');
  });

  it('checkpoints and evaluates with the database clock when the application clock is behind', async () => {
    const databaseNow = new Date('2026-08-28T10:00:00.000Z');
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest.fn().mockResolvedValue({
      consumedWallTimeMs: 60_000n,
      wallTimeCheckpointAt: databaseNow,
      maxWallTimeSeconds: 60,
    });

    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-28T09:59:30.000Z').getTime());
    const authoritative = await checkpointTaskWallTimeForAuthorization(
      { msaidiziTask: { updateMany, findUnique } } as never,
      'task-1',
      [MsaidiziTaskStatus.RUNNING],
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        status: { in: [MsaidiziTaskStatus.RUNNING] },
        startedAt: { not: null },
        endedAt: null,
      },
      data: { lastCheckpointAt: expect.any(Date) },
    });
    expect(authoritativeTaskWallTimeExceeded(authoritative!)).toBe(true);
    expect(authoritativeRemainingTaskWallTimeMs(authoritative!)).toBe(0n);
  });

  it('fails authoritative evaluation closed when the database checkpoint is missing', () => {
    const corrupt = {
      consumedWallTimeMs: 0n,
      wallTimeCheckpointAt: null,
      maxWallTimeSeconds: 60,
    };

    expect(authoritativeTaskWallTimeExceeded(corrupt)).toBe(true);
    expect(authoritativeRemainingTaskWallTimeMs(corrupt)).toBe(0n);
  });

  it('refuses authorization when the checkpoint CAS does not own an active task', async () => {
    const findUnique = jest.fn();
    const authoritative = await checkpointTaskWallTimeForAuthorization(
      {
        msaidiziTask: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findUnique,
        },
      } as never,
      'task-1',
    );

    expect(authoritative).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
