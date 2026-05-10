import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VerificationCheckUseCase } from '../../apps/api/src/application/use-cases/VerificationCheckUseCase';
import { DrizzleVerificationRepository } from '../../apps/api/src/infrastructure/db/repositories/DrizzleVerificationRepository';

describe('VerificationCheckUseCase', () => {
  let useCase: VerificationCheckUseCase;
  let mockRepo: any;

  beforeEach(() => {
    mockRepo = {
      findCode: vi.fn(),
      saveAttempt: vi.fn(),
      markCodeAsUsed: vi.fn(),
    };
    useCase = new VerificationCheckUseCase(mockRepo);
  });

  it('should return success when a valid unused code is provided', async () => {
    mockRepo.findCode.mockResolvedValue({ productId: 'prod-123', isUsed: false });
    
    const result = await useCase.execute('VALID-CODE', '127.0.0.1', 'test-ua');
    
    expect(result.success).toBe(true);
    expect(result.productId).toBe('prod-123');
    expect(mockRepo.saveAttempt).toHaveBeenCalled();
    expect(mockRepo.markCodeAsUsed).toHaveBeenCalledWith('VALID-CODE');
  });

  it('should return failure when a code is already used', async () => {
    mockRepo.findCode.mockResolvedValue({ productId: 'prod-123', isUsed: true });
    
    const result = await useCase.execute('USED-CODE');
    
    expect(result.success).toBe(false);
    expect(mockRepo.markCodeAsUsed).not.toHaveBeenCalled();
  });

  it('should return failure when a code does not exist', async () => {
    mockRepo.findCode.mockResolvedValue(null);
    
    const result = await useCase.execute('INVALID-CODE');
    
    expect(result.success).toBe(false);
    expect(mockRepo.saveAttempt).toHaveBeenCalled();
  });
});
