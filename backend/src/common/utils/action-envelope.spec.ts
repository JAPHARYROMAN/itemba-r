import { exactActionEnvelopeDigest, normaliseHttpActionEnvelope } from './action-envelope';

describe('exact action envelope', () => {
  it('normalises planned path and query values to their HTTP representation', () => {
    expect(
      normaliseHttpActionEnvelope({
        path: { id: 41 },
        query: { page: 2, status: ['OPEN', 'OVERDUE'], filter: { branch: 'A' }, omit: null },
        body: { amount: 9000 },
      }),
    ).toEqual({
      path: { id: '41' },
      query: { page: '2', status: ['OPEN', 'OVERDUE'], filter: '{"branch":"A"}' },
      body: { amount: 9000 },
    });
  });

  it('produces the same digest before and after an HTTP round trip', () => {
    const planned = {
      path: { id: 41 },
      query: { include: true },
      body: { memo: 'Rent', amount: 9000 },
    };
    const received = {
      path: { id: '41' },
      query: { include: 'true' },
      body: { memo: 'Rent', amount: 9000 },
    };
    expect(exactActionEnvelopeDigest(planned)).toBe(exactActionEnvelopeDigest(received));
  });

  it('rejects ambiguous or incomplete envelopes', () => {
    expect(exactActionEnvelopeDigest({ body: {} })).toBeNull();
    expect(exactActionEnvelopeDigest({ path: {}, query: {}, surprise: true })).toBeNull();
  });
});
