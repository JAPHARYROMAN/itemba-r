import { DocumentationService } from './documentation.service';

function makePrisma() {
  return {
    userManual: {
      count: jest
        .fn()
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1),
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([
          { status: 'PUBLISHED', _count: { _all: 7 } },
          { status: 'DRAFT', _count: { _all: 1 } },
        ])
        .mockResolvedValueOnce([
          { moduleName: 'finance', _count: { _all: 3 } },
          { moduleName: null, _count: { _all: 2 } },
        ]),
      findMany: jest.fn().mockResolvedValue([{ id: 'manual-1' }]),
    },
    helpArticle: {
      count: jest
        .fn()
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(16)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2),
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([{ status: 'PUBLISHED', _count: { _all: 16 } }])
        .mockResolvedValueOnce([{ category: 'FINANCE', _count: { _all: 5 } }]),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { viewCount: 250, helpfulCount: 80, notHelpfulCount: 20 },
      }),
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'article-recent' }])
        .mockResolvedValueOnce([{ id: 'article-popular' }]),
    },
    guidedWalkthrough: {
      count: jest.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(5),
      groupBy: jest.fn().mockResolvedValue([{ status: 'ACTIVE', _count: { _all: 4 } }]),
    },
  } as any;
}

describe('DocumentationService feature breadth summary', () => {
  it('returns publication, engagement, stale-content, and walkthrough metrics', async () => {
    const service = new DocumentationService(makePrisma());

    const result = await service.getSummary();

    expect(result).toEqual(
      expect.objectContaining({
        totalManuals: 10,
        publishedManuals: 7,
        totalArticles: 20,
        publishedArticles: 16,
      }),
    );
    expect(result.manuals).toEqual({
      total: 10,
      published: 7,
      reviewed: 2,
      draft: 1,
      publishRate: 70,
    });
    expect(result.articles).toEqual({
      total: 20,
      published: 16,
      draft: 3,
      archived: 1,
      publishRate: 80,
      totalViews: 250,
      helpfulnessRate: 80,
    });
    expect(result.walkthroughs).toEqual({ total: 5, active: 4, activationRate: 80 });
    expect(result.staleContent).toEqual({
      manualDraftsOlderThan90Days: 1,
      articleDraftsOlderThan90Days: 2,
    });
    expect(result.manualsByModule).toEqual({ finance: 3, GENERAL: 2 });
    expect(result.articlesByCategory).toEqual({ FINANCE: 5 });
  });
});
