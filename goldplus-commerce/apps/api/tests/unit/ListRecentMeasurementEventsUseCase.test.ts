import { describe, it, expect, vi } from 'vitest';
import { ListRecentMeasurementEventsUseCase } from '../../src/application/use-cases/admin/ListRecentMeasurementEventsUseCase';

describe('ListRecentMeasurementEventsUseCase', () => {
  it('returns redacted events', async () => {
    const mockAccessPolicy = {
      canViewMeasurementDashboard: vi.fn().mockReturnValue(true),
    };
    const mockRepo = {
      getRecentRedactedEvents: vi.fn().mockResolvedValue([
        { id: '1', redactedPayload: { email: 'test@test.com' } }
      ]),
    };
    const mockRedactor = {
      redactPayload: vi.fn().mockReturnValue({ email: '[REDACTED_EMAIL]' }),
    };
    
    const useCase = new ListRecentMeasurementEventsUseCase(mockRepo as any, mockAccessPolicy as any, mockRedactor as any);
    const result = await useCase.execute('admin1', []);
    expect(result[0].redactedPayload.email).toBe('[REDACTED_EMAIL]');
  });
});
