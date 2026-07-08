import { describe, it, expect, vi } from 'vitest';
import { AnswerProductFinderStepUseCase } from '../../src/application/use-cases/product-finder/AnswerProductFinderStepUseCase';

describe('AnswerProductFinderStepUseCase', () => {
  it('records answer safely without inferring advertising consent', async () => {
    const mockRepo = {
      getSession: vi.fn().mockResolvedValue({ id: 'sess-1', answers: {} }),
      updateSessionAnswers: vi.fn().mockResolvedValue(undefined)
    } as any;

    const mockMeasurement = {
      publishFinderStepAnswered: vi.fn().mockResolvedValue(undefined)
    } as any;

    const uc = new AnswerProductFinderStepUseCase(mockRepo, mockMeasurement);

    const res = await uc.execute({ sessionId: 'sess-1', stepId: 'category', answer: 'Power' });
    
    expect(res.success).toBe(true);
    expect(mockRepo.updateSessionAnswers).toHaveBeenCalledWith('sess-1', { category: 'Power' });
    expect(mockMeasurement.publishFinderStepAnswered).toHaveBeenCalledWith('sess-1', 'category', 'Power');
  });

  it('fails if session not found', async () => {
    const mockRepo = { getSession: vi.fn().mockResolvedValue(null) } as any;
    const uc = new AnswerProductFinderStepUseCase(mockRepo, {} as any);
    const res = await uc.execute({ sessionId: 'sess-bad', stepId: 'c', answer: 'a' });
    expect(res.success).toBe(false);
    expect(res.error).toBe('SESSION_NOT_FOUND');
  });
});
