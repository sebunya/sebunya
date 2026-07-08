import { describe, it, expect, vi } from 'vitest';
import { PreparePaidSocialPayloadUseCase } from '../../src/application/use-cases/measurement/PreparePaidSocialPayloadUseCase';
import { IPaidSocialDestinationMapperRegistry, PaidSocialDestinationMapper, DestinationMapperResult } from '../../src/application/ports/measurement/PaidSocialDestinationMapper';

class MockRegistry implements IPaidSocialDestinationMapperRegistry {
  private mappers = new Map<string, PaidSocialDestinationMapper>();

  register(mapper: PaidSocialDestinationMapper) {
    this.mappers.set(mapper.destinationKey, mapper);
  }

  getMapper(destinationKey: string): PaidSocialDestinationMapper | undefined {
    return this.mappers.get(destinationKey);
  }

  hasMapper(destinationKey: string): boolean {
    return this.mappers.has(destinationKey);
  }

  getSupportedDestinations(): string[] {
    return Array.from(this.mappers.keys());
  }
}

describe('PreparePaidSocialPayloadUseCase', () => {
  it('returns VALIDATION_FAILED when destination mapper is missing', () => {
    const registry = new MockRegistry();
    const useCase = new PreparePaidSocialPayloadUseCase(registry);

    const result = useCase.execute('unknown_dest', 'purchase', 'evt_1', {});
    
    expect(result.success).toBe(false);
    expect(result.status).toBe('VALIDATION_FAILED');
    expect(result.errors).toContain('No mapper found for destination unknown_dest');
  });

  it('delegates to the correct mapper when found', () => {
    const mockMapperResult: DestinationMapperResult = {
      success: true,
      status: 'MAPPED',
      destination: 'test_dest',
      eventName: 'purchase',
      destinationEventName: 'Purchase',
      eventId: 'evt_1',
      idempotencyKey: 'test_dest:evt_1',
      payload: { foo: 'bar' },
      redactedSummary: { event_name: 'Purchase' }
    };

    const mockMapper: PaidSocialDestinationMapper = {
      destinationKey: 'test_dest',
      supportedEvents: ['purchase'],
      mapEvent: vi.fn().mockReturnValue(mockMapperResult),
      validateEvent: vi.fn()
    };

    const registry = new MockRegistry();
    registry.register(mockMapper);

    const useCase = new PreparePaidSocialPayloadUseCase(registry);
    const result = useCase.execute('test_dest', 'purchase', 'evt_1', { value: 100 });

    expect(result).toBe(mockMapperResult);
    expect(mockMapper.mapEvent).toHaveBeenCalledWith('purchase', 'evt_1', { value: 100 });
  });
});
