import { scrubLogText } from './log-scrubber';

describe('log scrubber', () => {
  it('redacts the evaluator lease header in object, JSON, and proxy-style log forms', () => {
    const lease = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    for (const value of [
      `x-msaidizi-evaluation-lease: ${lease}`,
      `x-msaidizi-evaluation-lease=${lease}`,
      `{"x-msaidizi-evaluation-lease":"${lease}","path":"/generation-artifact"}`,
    ]) {
      const scrubbed = scrubLogText(value);
      expect(scrubbed).not.toContain(lease);
      expect(scrubbed).toContain('[REDACTED]');
    }
  });
});
