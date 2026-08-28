import { MsaidiziTaskStatus, Prisma } from '@prisma/client';

/**
 * Durable task wall-clock projection.
 *
 * `consumedWallTimeMs` is folded by the PostgreSQL accounting trigger on every
 * task write. `wallTimeCheckpointAt` is the persisted database-clock boundary
 * for a started, non-terminal task. Projecting the still-open interval keeps
 * reads and pre-dispatch budget gates quantitative between checkpoints without
 * treating process uptime, pause, or worker restarts as new clocks.
 */
export interface MsaidiziTaskWallTimeState {
  consumedWallTimeMs: bigint | number | string;
  wallTimeCheckpointAt: Date | string | null;
  maxWallTimeSeconds: number;
}

export interface AuthoritativeMsaidiziTaskWallTimeState {
  consumedWallTimeMs: bigint;
  wallTimeCheckpointAt: Date | null;
  maxWallTimeSeconds: number;
}

type WallTimeDatabaseClient = Pick<Prisma.TransactionClient, 'msaidiziTask'>;

const MILLISECONDS_PER_SECOND = 1_000n;

export class MsaidiziWallTimeAccountingError extends Error {
  constructor(readonly code: 'INVALID_CONSUMED_WALL_TIME' | 'INVALID_WALL_TIME_CHECKPOINT') {
    super(code);
    this.name = 'MsaidiziWallTimeAccountingError';
  }
}

export function projectedTaskWallTimeMs(
  task: Pick<MsaidiziTaskWallTimeState, 'consumedWallTimeMs' | 'wallTimeCheckpointAt'>,
  now: Date | number = Date.now(),
): bigint {
  const persisted = nonnegativeBigInt(task.consumedWallTimeMs);
  const checkpoint = timestampMilliseconds(task.wallTimeCheckpointAt);
  if (checkpoint === null) return persisted;
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(nowMs) || nowMs <= checkpoint) return persisted;
  return persisted + BigInt(Math.floor(nowMs - checkpoint));
}

export function taskWallTimeExceeded(
  task: MsaidiziTaskWallTimeState,
  now: Date | number = Date.now(),
): boolean {
  if (!Number.isSafeInteger(task.maxWallTimeSeconds) || task.maxWallTimeSeconds <= 0) return true;
  try {
    return (
      projectedTaskWallTimeMs(task, now) >=
      BigInt(task.maxWallTimeSeconds) * MILLISECONDS_PER_SECOND
    );
  } catch (error) {
    if (error instanceof MsaidiziWallTimeAccountingError) return true;
    throw error;
  }
}

export function remainingTaskWallTimeMs(
  task: MsaidiziTaskWallTimeState,
  now: Date | number = Date.now(),
): bigint {
  if (!Number.isSafeInteger(task.maxWallTimeSeconds) || task.maxWallTimeSeconds <= 0) return 0n;
  try {
    const remaining =
      BigInt(task.maxWallTimeSeconds) * MILLISECONDS_PER_SECOND -
      projectedTaskWallTimeMs(task, now);
    return remaining > 0n ? remaining : 0n;
  } catch (error) {
    if (error instanceof MsaidiziWallTimeAccountingError) return 0n;
    throw error;
  }
}

/**
 * Folds the open interval with PostgreSQL's clock and then reads the same row.
 * Authorization paths must use this before evaluating a ceiling; comparing a
 * database checkpoint with application Date.now() alone can fail open when the
 * application host clock is behind PostgreSQL.
 */
export async function checkpointTaskWallTimeForAuthorization(
  client: WallTimeDatabaseClient,
  taskId: string,
  allowedStatuses: readonly MsaidiziTaskStatus[] = [MsaidiziTaskStatus.RUNNING],
): Promise<AuthoritativeMsaidiziTaskWallTimeState | null> {
  const checkpointed = await client.msaidiziTask.updateMany({
    where: {
      id: taskId,
      status: { in: [...allowedStatuses] },
      startedAt: { not: null },
      endedAt: null,
    },
    // The database trigger deliberately ignores this process clock for wall
    // accounting; the write is only the checkpoint signal.
    data: { lastCheckpointAt: new Date() },
  });
  if (checkpointed.count !== 1) return null;
  return client.msaidiziTask.findUnique({
    where: { id: taskId },
    select: {
      consumedWallTimeMs: true,
      wallTimeCheckpointAt: true,
      maxWallTimeSeconds: true,
    },
  });
}

export function authoritativeTaskWallTimeExceeded(task: MsaidiziTaskWallTimeState): boolean {
  if (task.wallTimeCheckpointAt === null) return true;
  const databaseNow =
    task.wallTimeCheckpointAt instanceof Date
      ? task.wallTimeCheckpointAt
      : new Date(task.wallTimeCheckpointAt);
  return taskWallTimeExceeded(task, databaseNow);
}

export function authoritativeRemainingTaskWallTimeMs(task: MsaidiziTaskWallTimeState): bigint {
  if (task.wallTimeCheckpointAt === null) return 0n;
  const databaseNow =
    task.wallTimeCheckpointAt instanceof Date
      ? task.wallTimeCheckpointAt
      : new Date(task.wallTimeCheckpointAt);
  return remainingTaskWallTimeMs(task, databaseNow);
}

function nonnegativeBigInt(value: bigint | number | string): bigint {
  try {
    let parsed: bigint;
    if (typeof value === 'bigint') {
      parsed = value;
    } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
      parsed = BigInt(value);
    } else if (typeof value === 'string' && /^\d+$/.test(value)) {
      parsed = BigInt(value);
    } else {
      throw new MsaidiziWallTimeAccountingError('INVALID_CONSUMED_WALL_TIME');
    }
    if (parsed < 0n) {
      throw new MsaidiziWallTimeAccountingError('INVALID_CONSUMED_WALL_TIME');
    }
    return parsed;
  } catch (error) {
    if (error instanceof MsaidiziWallTimeAccountingError) throw error;
    throw new MsaidiziWallTimeAccountingError('INVALID_CONSUMED_WALL_TIME');
  }
}

function timestampMilliseconds(value: Date | string | null): number | null {
  if (value === null) return null;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new MsaidiziWallTimeAccountingError('INVALID_WALL_TIME_CHECKPOINT');
  }
  return timestamp;
}
