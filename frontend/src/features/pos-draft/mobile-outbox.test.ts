import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileCapture, SessionChangedError } from './mobile-outbox';
import { capturePartition } from './capture-store';
import { webcrypto } from 'node:crypto';
import { draftFixture, submissionFixture } from './test-fixtures';
import { submissionEnvelope } from './types';
import type { LocalCapture } from './capture-store';
const capture: LocalCapture = {
  key: 'key',
  partition: 'owner-device',
  requestId: submissionFixture.requestId,
  submission: submissionFixture,
  state: 'LOCAL',
};
describe('approval capture reconciliation', () => {
  it('omits terminal metadata while preserving an older frozen request identity and business payload', () => {
    const older = { ...submissionFixture, terminalId: 'derived-terminal' };
    expect(submissionEnvelope(older)).toEqual(submissionFixture);
    expect(older.terminalId).toBe('derived-terminal');
    expect(submissionEnvelope(older).requestId).toBe('original-request');
  });
  it('never replays an acknowledged pending request', async () => {
    const outcome = vi.fn(),
      submit = vi.fn(),
      save = vi.fn();
    expect(
      await reconcileCapture(
        { ...capture, state: 'SUBMITTED', draft: draftFixture },
        { outcome, submit },
        save,
      ),
    ).toEqual(draftFixture);
    expect(outcome).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it('checks the original request before sending its frozen payload', async () => {
    const order: string[] = [];
    const outcome = vi.fn(async (id: string) => {
      order.push(`outcome:${id}`);
      return { state: 'not_found' as const };
    });
    const submit = vi.fn(async () => {
      order.push('submit');
      return draftFixture;
    });
    const save = vi.fn();
    await reconcileCapture(capture, { outcome, submit }, save);
    expect(order).toEqual(['outcome:original-request', 'submit']);
    expect(submit).toHaveBeenCalledWith(submissionFixture);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'SUBMITTED', draft: draftFixture }),
    );
  });
  it('acknowledges a pending server outcome after an uncertain response without posting twice', async () => {
    const submit = vi.fn(),
      save = vi.fn();
    await reconcileCapture(
      { ...capture, state: 'ATTENTION' },
      { outcome: vi.fn(async () => ({ state: 'pending', draft: draftFixture })), submit },
      save,
    );
    expect(submit).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ state: 'SUBMITTED' }));
  });
  it('keeps an unknown server outcome for manual attention and never assumes a failed write', async () => {
    const submit = vi.fn(),
      save = vi.fn();
    await expect(
      reconcileCapture(
        capture,
        { outcome: vi.fn(async () => ({ state: 'posted' })), submit },
        save,
      ),
    ).rejects.toThrow('server recorded');
    expect(submit).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'ATTENTION', requestId: 'original-request' }),
    );
  });
  it('cannot submit under a new session when sign-out occurs during the outcome check', async () => {
    let current = true;
    const submit = vi.fn(),
      save = vi.fn();
    const outcome = vi.fn(async () => {
      current = false;
      return { state: 'not_found' as const };
    });
    await expect(
      reconcileCapture(capture, { outcome, submit }, save, () => current),
    ).rejects.toBeInstanceOf(SessionChangedError);
    expect(submit).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it('ignores a late acknowledgement after device reassignment', async () => {
    let current = true;
    const save = vi.fn();
    await expect(
      reconcileCapture(
        capture,
        {
          outcome: vi.fn(async () => ({ state: 'not_found' })),
          submit: vi.fn(async () => {
            current = false;
            return draftFixture;
          }),
        },
        save,
        () => current,
      ),
    ).rejects.toBeInstanceOf(SessionChangedError);
    expect(save).not.toHaveBeenCalled();
  });
});
describe('owner and device partitions', () => {
  beforeEach(() => vi.stubGlobal('crypto', webcrypto));
  it('separates operators, enrolments, device secrets and credential resets without exposing the secret', async () => {
    const identity = {
      enrollmentId: 'enrollment',
      ownerId: 'operator',
      credentialVersion: 1,
      deviceSecret: 'a'.repeat(64),
    };
    const original = await capturePartition(identity);
    const variants = await Promise.all(
      [
        { ...identity, ownerId: 'other' },
        { ...identity, enrollmentId: 'other' },
        { ...identity, deviceSecret: 'b'.repeat(64) },
        { ...identity, credentialVersion: 2 },
      ].map(capturePartition),
    );
    expect(new Set([original, ...variants]).size).toBe(5);
    expect(original).not.toContain(identity.deviceSecret);
    expect(await capturePartition(identity)).toBe(original);
  });
});
