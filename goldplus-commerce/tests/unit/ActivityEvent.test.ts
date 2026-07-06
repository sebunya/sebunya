import { describe, expect, it } from 'vitest';
import { validateActivityEvent, ACTIVITY_EVENT_TYPES } from '../../apps/api/src/domain/engagement/ActivityEvent';
import { RecordActivityEventUseCase } from '../../apps/api/src/application/use-cases/engagement/RecordActivityEventUseCase';
import { GetEngagementSummaryUseCase } from '../../apps/api/src/application/use-cases/engagement/GetEngagementSummaryUseCase';
import {
  IActivityEventRepository,
  PersistedActivityEvent,
  EngagementCountRow,
} from '../../apps/api/src/application/ports/IActivityEventRepository';
import { ValidatedActivityEvent } from '../../apps/api/src/domain/engagement/ActivityEvent';

class InMemoryActivityEventRepository implements IActivityEventRepository {
  public saved: PersistedActivityEvent[] = [];

  async save(event: ValidatedActivityEvent): Promise<PersistedActivityEvent> {
    const persisted: PersistedActivityEvent = {
      ...event,
      id: `evt-${this.saved.length + 1}`,
      createdAt: new Date(),
    };
    this.saved.push(persisted);
    return persisted;
  }

  async countByTypeSince(since: Date): Promise<EngagementCountRow[]> {
    const counts = new Map<string, number>();
    for (const e of this.saved) {
      if (e.createdAt >= since) counts.set(e.eventType, (counts.get(e.eventType) ?? 0) + 1);
    }
    return [...counts.entries()].map(([eventType, count]) => ({ eventType, count }));
  }

  async findRecentByVisitor(visitorId: string, limit: number): Promise<PersistedActivityEvent[]> {
    return this.saved.filter((e) => e.visitorId === visitorId).slice(-limit);
  }
}

describe('validateActivityEvent', () => {
  it('accepts every documented event type', () => {
    for (const type of ACTIVITY_EVENT_TYPES) {
      const result = validateActivityEvent({ visitorId: 'v1', eventType: type });
      expect(result.ok, `${type} should be valid`).toBe(true);
    }
  });

  it('rejects a missing visitor id', () => {
    const result = validateActivityEvent({ visitorId: '  ', eventType: 'PAGE_VIEW' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('MISSING_VISITOR');
  });

  it('rejects unknown event types to keep the vocabulary closed', () => {
    const result = validateActivityEvent({ visitorId: 'v1', eventType: 'SOMETHING_ELSE' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN_EVENT_TYPE');
  });

  it('normalises event type casing', () => {
    const result = validateActivityEvent({ visitorId: 'v1', eventType: 'add_to_cart' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.event.eventType).toBe('ADD_TO_CART');
  });

  it('keeps only scalar properties and rejects nested objects', () => {
    const bad = validateActivityEvent({
      visitorId: 'v1',
      eventType: 'PAGE_VIEW',
      properties: { nested: { a: 1 } } as any,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('BAD_PROPERTIES');

    const good = validateActivityEvent({
      visitorId: 'v1',
      eventType: 'PAGE_VIEW',
      properties: { plan: 'gold', qty: 3, returning: true, skipped: null },
    });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.event.properties).toEqual({ plan: 'gold', qty: 3, returning: true });
  });

  it('caps the number of properties per event', () => {
    const properties: Record<string, number> = {};
    for (let i = 0; i < 21; i++) properties[`k${i}`] = i;
    const result = validateActivityEvent({ visitorId: 'v1', eventType: 'PAGE_VIEW', properties });
    expect(result.ok).toBe(false);
  });

  it('truncates over-long strings instead of failing', () => {
    const result = validateActivityEvent({
      visitorId: 'v1',
      eventType: 'PAGE_VIEW',
      path: '/x'.repeat(600),
      properties: { note: 'y'.repeat(1000) },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.path!.length).toBeLessThanOrEqual(500);
      expect((result.event.properties.note as string).length).toBeLessThanOrEqual(500);
    }
  });
});

describe('RecordActivityEventUseCase', () => {
  it('persists a valid event', async () => {
    const repo = new InMemoryActivityEventRepository();
    const uc = new RecordActivityEventUseCase(repo);
    const result = await uc.execute({
      visitorId: 'v1',
      eventType: 'PRODUCT_VIEW',
      entity: 'product',
      entityId: 'p-123',
    });
    expect(result.ok).toBe(true);
    expect(repo.saved).toHaveLength(1);
    expect(repo.saved[0].eventType).toBe('PRODUCT_VIEW');
  });

  it('does not persist invalid events', async () => {
    const repo = new InMemoryActivityEventRepository();
    const uc = new RecordActivityEventUseCase(repo);
    const result = await uc.execute({ visitorId: 'v1', eventType: 'NOT_A_THING' });
    expect(result.ok).toBe(false);
    expect(repo.saved).toHaveLength(0);
  });
});

describe('GetEngagementSummaryUseCase', () => {
  it('aggregates counts and clamps the window', async () => {
    const repo = new InMemoryActivityEventRepository();
    const record = new RecordActivityEventUseCase(repo);
    await record.execute({ visitorId: 'v1', eventType: 'PAGE_VIEW' });
    await record.execute({ visitorId: 'v2', eventType: 'PAGE_VIEW' });
    await record.execute({ visitorId: 'v1', eventType: 'ADD_TO_CART' });

    const uc = new GetEngagementSummaryUseCase(repo);
    const summary = await uc.execute({ days: 9999 });
    expect(summary.days).toBe(90);
    const pageViews = summary.counts.find((c) => c.eventType === 'PAGE_VIEW');
    expect(pageViews?.count).toBe(2);
  });
});
