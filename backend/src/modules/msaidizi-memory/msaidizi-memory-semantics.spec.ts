import { scoreMemoryRelevance } from './msaidizi-memory-semantics';

describe('governed deterministic memory semantics', () => {
  it('ranks concept-equivalent finance language above a shallow lexical match', () => {
    const relevant = scoreMemoryRelevance(
      'review supplier spending',
      'vendor expense reconciliation completed successfully',
    );
    const shallow = scoreMemoryRelevance(
      'review supplier spending',
      'supplier contact directory was refreshed',
    );

    expect(relevant.sharedConcepts).toEqual(
      expect.arrayContaining(['finance.expense', 'party.supplier', 'workflow.reconcile']),
    );
    expect(relevant.score).toBeGreaterThan(shallow.score);
    expect(relevant.semanticCosine).toBeGreaterThan(0);
  });
});
