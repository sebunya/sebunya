import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ProcessOutboxBatchUseCase, type NotificationRoutingTarget } from '../../apps/api/src/application/use-cases/outbox/ProcessOutboxBatchUseCase';
import type { IOutboxRepository } from '../../apps/api/src/application/ports/IOutboxRepository';
import { RecordNotificationAttemptUseCase } from '../../apps/api/src/application/use-cases/notifications/RecordNotificationAttemptUseCase';
import { RoutePaidSocialEventUseCase } from '../../apps/api/src/application/use-cases/measurement/RoutePaidSocialEventUseCase';
import { NotificationTemplateRenderer } from '../../apps/api/src/application/use-cases/notifications/NotificationTemplateRenderer';
import { resetCodeHash, RESET_CODE_MARKER } from '../../apps/api/src/application/use-cases/identity/SmsPasswordResetUseCases';
import { phoneKey } from '../../apps/api/src/application/use-cases/measurement/HoldoutGate';
import { RecommendationAnalyticsService } from '../../apps/api/src/application/recommendations/RecommendationAnalyticsService';

const read = (p: string) => readFileSync(p, 'utf8');
const API = 'apps/api/src/';

describe('outbox: hopeless is per target, and dead letters keep who got it', () => {
  function run(results: Array<{ status: string; retryable?: boolean }>, attemptCount = 0) {
    const calls = { failure: [] as unknown[][], dead: [] as unknown[][] };
    const outbox = {
      claimDueBatch: async () => [{ id: 'e', eventType: 'X', payload: {}, attemptCount, isProcessed: false, createdAt: new Date(), nextAttemptAt: new Date() }],
      markProcessed: async () => {}, recordFailure: async (...a: unknown[]) => void calls.failure.push(a),
      markDeadLettered: async (...a: unknown[]) => void calls.dead.push(a),
    } as unknown as IOutboxRepository;
    const targets: NotificationRoutingTarget[] = results.map((r, i) => ({
      channel: 'sms', provider: { dispatch: async () => ({ providerCode: 'P', providerMessage: 'm', ...r }) as any },
      payload: { recipient: `+25670000000${i}`, template: 'T', data: {}, relatedEntity: 'order', relatedEntityId: 'GP-1' },
    }));
    const rec = new RecordNotificationAttemptUseCase({ save: async (i: any) => ({ id: 'a', attemptedAt: new Date(), ...i }), findRecent: async () => [], findByRelatedEntity: async () => [] });
    return { uc: new ProcessOutboxBatchUseCase(outbox, { route: async () => targets }, rec, () => 0.5), calls };
  }
  it('one credit-exhausted target and one rate-limited target: retried, not dead-lettered', async () => {
    const { uc, calls } = run([{ status: 'FAILED', retryable: false }, { status: 'FAILED' }]);
    await uc.execute();
    expect(calls.dead).toEqual([]);
    expect(calls.failure).toHaveLength(1);
  });
  it('every failure hopeless: dead-lettered with the targets already delivered', async () => {
    const { uc, calls } = run([{ status: 'SENT' }, { status: 'FAILED', retryable: false }]);
    await uc.execute();
    expect(calls.dead).toHaveLength(1);
    expect((calls.dead[0][2] as any).sentTargets).toHaveLength(1);
  });
  it('the repository keeps _sentTargets on the dead-letter write', () => {
    expect(read(API + 'infrastructure/db/repositories/DrizzleOutboxRepository.ts')).toContain('async markDeadLettered(eventId: string, error: string, opts?: { sentTargets?: string[] })');
  });
});

describe('paid social follows D-002: no stored refusal means sent', () => {
  it('uses advertisingConversionsSent, not the owner-default state', async () => {
    const addEvent = vi.fn();
    const consent = { advertisingConversionsSent: vi.fn(async () => true), getCurrentState: vi.fn() };
    const uc = new RoutePaidSocialEventUseCase({ getActiveDestinations: async () => [{ id: 'd1' }] } as any, { addEvent } as any, consent as any, { info() {}, error() {} } as any);
    await uc.execute('Purchase', {}, undefined, 'fp.1.2');
    expect(consent.advertisingConversionsSent).toHaveBeenCalledWith('fp.1.2', undefined);
    expect(consent.getCurrentState).not.toHaveBeenCalled();
    expect(addEvent).toHaveBeenCalledTimes(1);
    consent.advertisingConversionsSent.mockResolvedValueOnce(false);
    await uc.execute('Purchase', {}, 'u1');
    expect(addEvent).toHaveBeenCalledTimes(1);
  });
});

describe('WhatsApp order text: fulfilment state before payment state', () => {
  const r = new NotificationTemplateRenderer();
  it('a delivered cash-on-delivery order is not "payment pending"; a failed delivery is not "being prepared"', () => {
    const delivered = r.renderWhatsApp({ orderNumber: 'GP-1', orderStatus: 'delivered', paymentStatus: 'pending', totalUgx: 1 });
    const pending = r.renderWhatsApp({ orderNumber: 'GP-1', orderStatus: 'received', paymentStatus: 'pending', totalUgx: 1 });
    expect(delivered).not.toBe(pending);
    const failed = r.renderWhatsApp({ orderNumber: 'GP-1', orderStatus: 'delivery_failed', paymentStatus: 'paid', totalUgx: 1 });
    expect(failed).toContain('There is an update on your GoldPlus order GP-1');
  });
});

describe('reset codes are told apart from verification OTPs', () => {
  it('carries the marker and fits the 64-char column', () => {
    const h = resetCodeHash((v) => 'a'.repeat(64) + v, '123456');
    expect(h.startsWith(RESET_CODE_MARKER)).toBe(true);
    expect(h.length).toBeLessThanOrEqual(64);
  });
  it('the reset path reads only reset rows, verification never does', () => {
    const src = read(API + 'application/use-cases/identity/SmsPasswordResetUseCases.ts');
    expect(src).toContain("latestOtp(user.id, 'reset')");
    expect(src).toContain("86_400_000), 'reset')");
    const repo = read(API + 'infrastructure/loyalty/LoyaltyIdentityInfrastructure.ts');
    expect(repo).toContain("not like 'rst:%'");
  });
});

describe('holdout phone key uses the one Uganda phone rule', () => {
  it('every spelling of one number is one key, equal to the SQL digits rule', () => {
    const k = phoneKey('0772123456');
    for (const p of ['+256772123456', '256 772 123 456', '+256 (772) 123-456']) expect(phoneKey(p), p).toBe(k);
  });
});

describe('recommendation depth metrics', () => {
  it('windowDays is clamped to 1..90 and junk falls back to 30', async () => {
    const seen: number[] = [];
    const svc = new RecommendationAnalyticsService({ depthMetricsRaw: async (d: number) => { seen.push(d); return { totalEvents: 0, distinctRecommendedProducts: 0, activeProducts: 0, nullPlacementEvents: 0, invalidPlacementEvents: 0, topProducts: [], sourceBreakdown: [] }; } } as any);
    for (const d of [100000, -5, Number.NaN]) await svc.getDepthMetrics(d).catch(() => undefined);
    expect(seen).toEqual([90, 1, 30]);
  });
  it('depth uses the summary population, and legacy RECOMMENDATION_CLICK still counts as a click', () => {
    const src = read(API + 'infrastructure/db/repositories/DrizzleRecommendationAnalyticsRepository.ts');
    const depth = src.slice(src.indexOf('async depthMetricsRaw'));
    expect(depth).toContain("humanTrafficOnly('recommendation_events'");
    expect(depth).toContain("not in ('RECOMMENDATION_RESPONSE', 'RECOMMENDATION_ERROR')");
    expect(src.match(/in \('RECOMMENDATION_CLICKED', 'RECOMMENDATION_CLICK'\) then/g)).toHaveLength(4);
  });
});

describe('audience sync and WhatsApp consent evidence', () => {
  it('an unreadable segment is skipped, never cleared; archived still clears', () => {
    const src = read(API + 'application/use-cases/advertising/AudienceSyncUseCases.ts');
    expect(src).toContain("'SEGMENT_UNREADABLE'");
    expect(src).toContain('The list on the platform was left as it is.');
  });
  it('evidence is written on retries too (idempotent on consentEventId)', () => {
    const src = read(API + 'application/use-cases/first-party/WhatsAppMarketingConsentUseCases.ts');
    expect(src).not.toContain('if (!receipt.already_applied) {');
    expect(src).toContain('if (current?.last_consent_event_id === retriedId) await this.writeEvidence(retriedId, input, phone);');
  });
});
