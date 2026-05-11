import { describe, it, expect, vi } from 'vitest';
import { ListPublicProductsUseCase } from '../../apps/api/src/application/use-cases/products/ListPublicProductsUseCase';
import { IProductRepository } from '../../apps/api/src/application/ports/IProductRepository';

describe('ListPublicProductsUseCase filtering rules', () => {
  it('should clamp the limit parameter to a maximum of 100 and minimum of 1', async () => {
    const mockRepo = { findPublicViewList: vi.fn().mockResolvedValue([]) } as unknown as IProductRepository;
    const useCase = new ListPublicProductsUseCase(mockRepo);

    await useCase.execute({ limit: 500 });
    expect(mockRepo.findPublicViewList).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));

    await useCase.execute({ limit: -5 });
    expect(mockRepo.findPublicViewList).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
  });

  it('should slice the ids list to maximum of 3 items for safety bound clamping', async () => {
    const mockRepo = { findPublicViewList: vi.fn().mockResolvedValue([]) } as unknown as IProductRepository;
    const useCase = new ListPublicProductsUseCase(mockRepo);

    const inputIds = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5'];
    await useCase.execute({ ids: inputIds });
    
    expect(mockRepo.findPublicViewList).toHaveBeenCalledWith(
      expect.objectContaining({
        ids: ['id-1', 'id-2', 'id-3']
      })
    );
  });

  it('should properly forward category, inStock and search parameters', async () => {
    const mockRepo = { findPublicViewList: vi.fn().mockResolvedValue([]) } as unknown as IProductRepository;
    const useCase = new ListPublicProductsUseCase(mockRepo);

    await useCase.execute({ 
      category: 'electronics',
      inStock: true,
      search: 'goldplus charger'
    });
    
    expect(mockRepo.findPublicViewList).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'electronics',
        inStock: true,
        search: 'goldplus charger'
      })
    );
  });
});
