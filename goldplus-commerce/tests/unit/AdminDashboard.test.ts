import { describe, expect, it } from 'vitest';
import { GetAdminDashboardUseCase } from '../../apps/api/src/application/use-cases/admin/GetAdminDashboardUseCase';
import {
  IDashboardReadRepository,
  CommerceSnapshot,
  SystemHealthSnapshot,
} from '../../apps/api/src/application/ports/IDashboardReadRepository';
import {
  IActivityEventRepository,
  PersistedActivityEvent,
  EngagementCountRow,
} from '../../apps/api/src/application/ports/IActivityEventRepository';
import { ValidatedActivityEvent } from '../../apps/api/src/domain/engagement/ActivityEvent';

class FakeDashboardRepo implements IDashboardReadRepository {
  public since?: Date;
  async getCommerceSnapshot(since: Date): Promise<CommerceSnapshot> {
    this.since = since;
    return {
      orderCount: 10,
      paidOrderCount: 7,
      paidRevenue: 3_500_000,
      topProducts: [{ productName: 'Solar Panel 450W', sku: 'SP-450', quantity: 12 }],
    };
  }
  async getSystemHealthSnapshot(): Promise<SystemHealthSnapshot> {
    return { pendingOutboxEvents: 3, failedNotifications: 1 };
  }
}

class FakeEvents implements IActivityEventRepository {
  async save(event: ValidatedActivityEvent): Promise<PersistedActivityEvent> {
    return { ...event, id: 'e1', createdAt: new Date() };
  }
  async countByTypeSince(): Promise<EngagementCountRow[]> {
    return [{ eventType: 'PAGE_VIEW', count: 42 }];
  }
  async findRecentByVisitor(): Promise<PersistedActivityEvent[]> {
    return [];
  }
}

describe('GetAdminDashboardUseCase', () => {
  it('aggregates commerce, engagement, and system health', async () => {
    const uc = new GetAdminDashboardUseCase(new FakeDashboardRepo(), new FakeEvents());
    const dto = await uc.execute({ days: 30 });

    expect(dto.days).toBe(30);
    expect(dto.commerce.paidRevenue).toBe(3_500_000);
    expect(dto.commerce.topProducts[0].sku).toBe('SP-450');
    expect(dto.engagement[0].count).toBe(42);
    expect(dto.system.pendingOutboxEvents).toBe(3);
  });

  it('clamps the window to 90 days and defaults to 7', async () => {
    const repo = new FakeDashboardRepo();
    const uc = new GetAdminDashboardUseCase(repo, new FakeEvents());

    const wide = await uc.execute({ days: 9999 });
    expect(wide.days).toBe(90);

    const def = await uc.execute();
    expect(def.days).toBe(7);
  });
});
