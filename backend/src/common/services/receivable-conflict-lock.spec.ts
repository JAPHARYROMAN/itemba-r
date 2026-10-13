import { ConflictException } from '@nestjs/common';
import { lockReceivableWithoutWaiting } from './receivable-conflict-lock';

describe('receivable contention conflicts', () => {
  it.each([
    { code: '55P03' },
    { code: 'P2010', meta: { code: '55P03', message: 'could not obtain lock' } },
  ])('maps PostgreSQL busy-row errors to a retryable conflict (%j)', async (failure) => {
    const tx = { $queryRaw: jest.fn().mockRejectedValue(failure) };
    await expect(lockReceivableWithoutWaiting(tx as any, 'receivable')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('preserves database errors unrelated to contention', async () => {
    const failure = { code: 'P2010', meta: { code: '23505' } };
    const tx = { $queryRaw: jest.fn().mockRejectedValue(failure) };
    await expect(lockReceivableWithoutWaiting(tx as any, 'receivable')).rejects.toBe(failure);
  });
});
