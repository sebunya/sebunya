import { describe, it, expect, vi } from 'vitest';
import { BullMqGenericMeasurementQueue } from '../../src/infrastructure/measurement/BullMqGenericMeasurementQueue';

describe('BullMqGenericMeasurementQueue', () => {
  it('fallback mode logs only safe metadata and does not log raw payload or PII', async () => {
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;
    
    const queue = new BullMqGenericMeasurementQueue(null, mockLogger);
    
    const res = await queue.enqueueMeasurementEvent({
      eventId: 'evt-1',
      eventName: 'product_finder_started',
      source: 'product_finder',
      sessionId: 'sess-1',
      occurredAt: new Date().toISOString(),
      payload: {
        email: 'secret@example.com',
        phone: '1234567890',
        deepNested: {
           password: 'foo'
        }
      }
    });
    
    expect(res.queued).toBe(true);
    expect(res.status).toBe('fallback');
    
    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    
    const logCall = mockLogger.info.mock.calls[0];
    const logArg = logCall[0];
    
    expect(logArg.event.eventId).toBe('evt-1');
    expect(logArg.event.sessionId).toBe('sess-1');
    expect(logArg.event.source).toBe('product_finder');
    expect(logArg.event.eventName).toBe('product_finder_started');
    
    // Proving raw payload and PII are NOT logged
    expect(logArg.event.payload).toBeUndefined();
    expect(logArg.event.email).toBeUndefined();
    expect(logArg.event.phone).toBeUndefined();
    expect(JSON.stringify(logArg)).not.toContain('secret@example.com');
  });
});
