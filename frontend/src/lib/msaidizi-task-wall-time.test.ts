import { displayTaskWallTime, formatTaskWallTime } from './msaidizi-task-wall-time';

describe('Msaidizi task wall-time display', () => {
  it('projects persisted usage across pause and resume', () => {
    expect(
      displayTaskWallTime(
        {
          consumedWallTimeMs: '12500',
          wallTimeCheckpointAt: '2026-08-28T08:00:00.000Z',
          maxWallTimeSeconds: 120,
        },
        Date.parse('2026-08-28T08:00:02.500Z'),
      ),
    ).toEqual({ elapsedMs: 15_000, ceilingMs: 120_000, valid: true });
  });

  it('freezes a terminal task without an open checkpoint', () => {
    expect(
      displayTaskWallTime(
        {
          consumedWallTimeMs: '42125',
          wallTimeCheckpointAt: null,
          maxWallTimeSeconds: 60,
        },
        Date.parse('2099-01-01T00:00:00.000Z'),
      ).elapsedMs,
    ).toBe(42_125);
  });

  it.each([
    { consumedWallTimeMs: '-1', wallTimeCheckpointAt: null },
    { consumedWallTimeMs: 'corrupt', wallTimeCheckpointAt: null },
    { consumedWallTimeMs: '1', wallTimeCheckpointAt: 'not-a-time' },
  ])('shows corrupt accounting as unavailable instead of zero', (corrupt) => {
    expect(displayTaskWallTime({ ...corrupt, maxWallTimeSeconds: 60 }).valid).toBe(false);
    expect(displayTaskWallTime({ ...corrupt, maxWallTimeSeconds: 60 }).elapsedMs).toBeNull();
  });

  it('shows an overflowing ceiling as unavailable', () => {
    expect(
      displayTaskWallTime({
        consumedWallTimeMs: '1',
        wallTimeCheckpointAt: null,
        maxWallTimeSeconds: Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual({ elapsedMs: null, ceilingMs: 0, valid: false });
  });

  it('formats elapsed and ceiling values quantitatively', () => {
    expect(formatTaskWallTime(7_205_000)).toBe('2h 0m 5s');
    expect(formatTaskWallTime(125_000)).toBe('2m 5s');
    expect(formatTaskWallTime(9_999)).toBe('9s');
  });
});
