import { describe, expect, it, vi } from 'vitest';
import { RecommendationMaterializer } from '../../apps/api/src/infrastructure/scheduler/RecommendationMaterializer';
import { Registry } from '../../apps/api/src/infrastructure/Registry';
import { GetRecommendationsUseCase } from '../../apps/api/src/application/recommendations/GetRecommendationsUseCase';

vi.mock('../../apps/api/src/infrastructure/db/client', () => {
  return {
    db: {
      select: () => ({
        from: () => [
          { id: 'cat-1', name: 'Charger', slug: 'charger' }
        ]
      })
    }
  };
});

describe('RecommendationMaterializer Unit Tests', () => {
  it('should run materialization process successfully', async () => {
    const registry = Registry.getInstance();
    
    // Mock the dependencies
    const saveSpy = vi.fn().mockResolvedValue(undefined);
    const findSpy = vi.fn().mockResolvedValue([
      { id: 'prod-1', name: 'Super Charger', slug: 'super-charger' }
    ]);
    const scoreSpy = vi.fn().mockResolvedValue([
      { productId: 'prod-1', name: 'Super Charger', slug: 'super-charger', score: 10 }
    ]);

    registry.productRecommendationReader.saveCachedRecommendations = saveSpy;
    registry.productRecommendationReader.findPublicProducts = findSpy;
    registry.getRecommendationsUseCase.generateV1ScoredCandidates = scoreSpy;

    const materializer = new RecommendationMaterializer();
    const result = await materializer.execute();

    expect(result.success).toBe(true);
    expect(result.processedCount).toBeGreaterThan(0);
    expect(saveSpy).toHaveBeenCalled();
  });
});

describe('GetRecommendationsUseCase Cache Integration', () => {
  it('should query cache first and return cached items', async () => {
    const mockReader: any = {
      findCachedRecommendations: vi.fn().mockResolvedValue([
        {
          productId: 'prod-1',
          slug: 'super-charger',
          name: 'Super Charger',
          price: 15000,
          currency: 'UGX',
          score: 10,
          reasonCodes: ['POPULAR']
        }
      ]),
      saveCachedRecommendations: vi.fn()
    };

    const mockScoring: any = {};
    const mockTrending: any = {};
    const mockFallback: any = {};
    const mockEligibility: any = {
      filter: (items: any) => items // bypass
    };
    const mockDedupe: any = {
      dedupe: (items: any) => items
    };
    const mockDiversity: any = {
      diversify: (items: any) => items
    };
    const mockRules: any = {
      apply: vi.fn().mockImplementation((args) => Promise.resolve({ candidates: args.candidates }))
    };

    const useCase = new GetRecommendationsUseCase(
      mockReader,
      null as any,
      mockScoring,
      mockTrending,
      mockFallback,
      mockEligibility,
      mockDedupe,
      mockDiversity,
      mockRules
    );

    const result = await useCase.execute({
      placement: 'home_trending'
    });

    expect(mockReader.findCachedRecommendations).toHaveBeenCalledWith('home_trending', 'global');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].productId).toBe('prod-1');
  });
});
