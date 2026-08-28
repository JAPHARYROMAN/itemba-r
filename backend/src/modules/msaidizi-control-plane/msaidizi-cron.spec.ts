import {
  assertSupportedCronExpression,
  nextCronOccurrence,
  UnsupportedMsaidiziCronError,
} from './msaidizi-cron';

describe('Msaidizi durable routine cron', () => {
  it('calculates a five-field occurrence in the configured IANA timezone', () => {
    expect(
      nextCronOccurrence(
        '0 8 * * *',
        'Africa/Nairobi',
        new Date('2026-08-25T04:59:30.000Z'),
      ).toISOString(),
    ).toBe('2026-08-25T05:00:00.000Z');
  });

  it('supports a six-field expression with leading seconds', () => {
    expect(
      nextCronOccurrence('*/10 * * * * *', 'UTC', new Date('2026-08-25T00:00:05.000Z')),
    ).toEqual(new Date('2026-08-25T00:00:10.000Z'));
  });

  it('does not invent a wall-clock instant inside a daylight-saving gap', () => {
    expect(
      nextCronOccurrence(
        '0 2 * * *',
        'America/New_York',
        new Date('2026-03-08T06:59:00.000Z'),
      ).toISOString(),
    ).toBe('2026-03-09T06:00:00.000Z');
  });

  it('rejects aliases and Quartz extensions instead of interpreting them ambiguously', () => {
    expect(() => assertSupportedCronExpression('0 8 * JAN MON')).toThrow(
      UnsupportedMsaidiziCronError,
    );
    expect(() => assertSupportedCronExpression('0 8 ? * 1L')).toThrow(UnsupportedMsaidiziCronError);
  });
});
