import type { MsaidiziTask } from './msaidizi-task-types';

export interface DisplayTaskWallTime {
  elapsedMs: number | null;
  ceilingMs: number;
  valid: boolean;
}

/**
 * Projects the persisted database-clock boundary for display only. Invalid
 * accounting is shown as unavailable rather than the dangerously reassuring
 * zero; backend authorization independently fails the same state closed.
 */
export function displayTaskWallTime(
  task: Pick<MsaidiziTask, 'consumedWallTimeMs' | 'wallTimeCheckpointAt' | 'maxWallTimeSeconds'>,
  now = Date.now(),
): DisplayTaskWallTime {
  const candidateCeilingMs =
    Number.isSafeInteger(task.maxWallTimeSeconds) && task.maxWallTimeSeconds > 0
      ? task.maxWallTimeSeconds * 1_000
      : 0;
  const ceilingMs = Number.isSafeInteger(candidateCeilingMs) ? candidateCeilingMs : 0;
  if (!/^\d+$/.test(task.consumedWallTimeMs) || ceilingMs <= 0) {
    return { elapsedMs: null, ceilingMs, valid: false };
  }
  const persisted = Number(task.consumedWallTimeMs);
  if (!Number.isSafeInteger(persisted) || persisted < 0) {
    return { elapsedMs: null, ceilingMs, valid: false };
  }
  if (task.wallTimeCheckpointAt === null) {
    return { elapsedMs: persisted, ceilingMs, valid: true };
  }
  const checkpoint = Date.parse(task.wallTimeCheckpointAt);
  if (!Number.isFinite(checkpoint) || !Number.isFinite(now)) {
    return { elapsedMs: null, ceilingMs, valid: false };
  }
  return {
    elapsedMs: persisted + Math.max(0, Math.floor(now - checkpoint)),
    ceilingMs,
    valid: true,
  };
}

export function formatTaskWallTime(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'Unavailable';
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
