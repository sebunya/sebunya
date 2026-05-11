import { describe, it, expect, vi } from 'vitest';
import { UploadProductImagesUseCase, RawFilePayload } from '../../apps/api/src/application/use-cases/products/UploadProductImagesUseCase';
import { IProductImageStorage } from '../../apps/api/src/application/ports/IProductImageStorage';
import { IProductImageRepository } from '../../apps/api/src/application/ports/IProductImageRepository';

describe('UploadProductImagesUseCase', () => {
  it('should save files to disk and commit to repository', async () => {
    const mockStorage: Partial<IProductImageStorage> = {
      saveProductImage: vi.fn().mockResolvedValue({ url: '/fake.png', physicalPath: '/var/fake.png' }),
    };
    const mockRepo: Partial<IProductImageRepository> = {
      add: vi.fn().mockResolvedValue({ id: 'img1', productId: 'p1', url: '/fake.png', altText: 'Alt', displayOrder: 1, isPrimary: true }),
    };

    const uc = new UploadProductImagesUseCase(mockStorage as any, mockRepo as any);

    const mockFile: RawFilePayload = {
      name: 'test.jpg',
      type: 'image/jpeg',
      size: 1024,
      buffer: Buffer.from('hello'),
    };

    const result = await uc.execute({
      productId: 'p1',
      files: [mockFile],
      altText: 'Alt',
      makeFirstPrimary: true
    });

    expect(mockStorage.saveProductImage).toHaveBeenCalledOnce();
    expect(mockRepo.add).toHaveBeenCalledWith(expect.objectContaining({
      productId: 'p1',
      url: '/fake.png',
      makePrimary: true
    }));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('img1');
  });

  it('should cleanup written files if database commit fails', async () => {
    const mockStorage: Partial<IProductImageStorage> = {
      saveProductImage: vi.fn().mockResolvedValue({ url: '/fake.png', physicalPath: '/var/failure-cleanup.png' }),
      deleteProductImage: vi.fn().mockResolvedValue(undefined),
    };
    
    const mockRepo: Partial<IProductImageRepository> = {
      add: vi.fn().mockRejectedValue(new Error('DB crashed')),
    };

    const uc = new UploadProductImagesUseCase(mockStorage as any, mockRepo as any);

    const mockFile: RawFilePayload = {
      name: 'test.png',
      type: 'image/png',
      size: 500,
      buffer: Buffer.from('crash-me'),
    };

    await expect(uc.execute({
      productId: 'p2',
      files: [mockFile],
    })).rejects.toThrow('DB crashed');

    // Ensure cleanup was called!
    expect(mockStorage.deleteProductImage).toHaveBeenCalledWith('/var/failure-cleanup.png');
  });

  it('should reject unsupported MIME types instantly', async () => {
    const uc = new UploadProductImagesUseCase({} as any, {} as any);
    
    const badFile: RawFilePayload = {
      name: 'evil.exe',
      type: 'application/x-msdownload',
      size: 100,
      buffer: Buffer.from('nope'),
    };

    await expect(uc.execute({
      productId: 'p3',
      files: [badFile],
    })).rejects.toThrow(/unsupported format/);
  });
});
