import { describe, expect, it, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  couponRedemptionIdentityHash,
  drawNotifyKey,
  paidMismatchTitle,
  positiveNumberEnv,
  runDetached,
} from '../../apps/api/src/infrastructure/wiringGuards';
import { addRunJob } from '../../apps/api/src/infrastructure/ai-visibility/AiVisibilityWiring';
import { widestRenditionByAsset } from '../../apps/api/src/infrastructure/db/mediaDisplayUrl';
import { PaymentsOpsConfigUseCase } from '../../apps/api/src/application/use-cases/payments/PaymentsOpsConfigUseCase';

const registry = readFileSync(join(__dirname, '../../apps/api/src/infrastructure/Registry.ts'), 'utf8');

describe('2026-11 review 234: Registry wiring', () => {
  it('the WhatsApp handler is caught, so a rejection cannot shut the API down', async () => {
    const onError = vi.fn();
    runDetached(Promise.reject(new Error('boom')), onError);
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalledOnce();
    expect(registry).toMatch(/runDetached\(\s*this\.goldieChannelUseCases\.handleWhatsApp/);
  });

  it('the abandonment publish uses getReadyQueue', () => {
    expect(registry).toContain('getReadyQueue(QUEUES.ABANDONED_CART_EVENTS)');
    expect(registry).not.toContain('getQueue(QUEUES.ABANDONED_CART_EVENTS)');
  });

  it('a retained failed AI-visibility run job is removed so the retry runs', async () => {
    const remove = vi.fn(async () => undefined);
    const add = vi.fn(async () => undefined);
    const q = { getJob: async () => ({ isFailed: async () => true, isCompleted: async () => false, remove }), add };
    expect(await addRunJob(q, 'r1')).toBe(true);
    expect(remove).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith('aiv-run', { runId: 'r1' }, expect.objectContaining({ jobId: 'aiv-run-r1' }));
  });

  it('a waiting run job is left alone (no double run)', async () => {
    const remove = vi.fn(async () => undefined);
    const q = { getJob: async () => ({ isFailed: async () => false, isCompleted: async () => false, remove }), add: vi.fn(async () => undefined) };
    await addRunJob(q, 'r1');
    expect(remove).not.toHaveBeenCalled();
  });

  it('displayUrlMap keeps the widest rendition, as the SQL readers do', () => {
    const m = widestRenditionByAsset([
      { assetId: 'a', url: 'small', width: 512 },
      { assetId: 'a', url: 'big', width: 1024 },
      { assetId: 'b', url: 'only', width: 300 },
    ]);
    expect(m.get('a')).toBe('big');
    expect(m.get('b')).toBe('only');
  });

  it('the draw notification key names the token, so a second identical win is told', () => {
    const a = drawNotifyKey({ userId: 'u', tokenId: 't1', label: '50 points', points: 50 });
    const b = drawNotifyKey({ userId: 'u', tokenId: 't2', label: '50 points', points: 50 });
    expect(a).not.toBe(b);
  });

  it('promotion thresholds ignore empty, zero and garbage env values', () => {
    expect(positiveNumberEnv('', 2000)).toBe(2000);
    expect(positiveNumberEnv('0', 2000)).toBe(2000);
    expect(positiveNumberEnv('20%', 2000)).toBe(2000);
    expect(positiveNumberEnv(undefined, 2000)).toBe(2000);
    expect(positiveNumberEnv(' 1500 ', 2000)).toBe(1500);
    expect(registry).toContain('positiveNumberEnv(process.env.PROMOTION_APPROVAL_PERCENT_BPS_THRESHOLD, 2000)');
  });

  it('the paid-mismatch title quotes the amount due, not the total', () => {
    const t = paidMismatchTitle('GP-1', 70_000, 80_000, 100_000);
    expect(t).toContain('UGX 80,000 is now due');
    expect(t).toContain('20,000 store credit');
    expect(paidMismatchTitle('GP-1', 70_000, 80_000, 80_000)).not.toContain('store credit');
  });

  it('the coupon redemption identity is peppered (HMAC), not a bare SHA-256', () => {
    const h = couponRedemptionIdentityHash('phone:+256700000000', 'pepper');
    expect(h).toBe(createHmac('sha256', 'pepper').update('phone:+256700000000').digest('hex'));
    expect(h).not.toBe(createHash('sha256').update('phone:+256700000000').digest('hex'));
    expect(h).toHaveLength(64);
  });

  it('payments ops config is written through a use case that validates and audits', async () => {
    const store = { values: vi.fn(async () => ({})), upsert: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };
    const audit = { execute: vi.fn(async () => undefined) };
    const uc = new PaymentsOpsConfigUseCase(store, audit);
    expect((await uc.set({ key: 'nope', value: '1', actorId: 'a' })).ok).toBe(false);
    expect(store.upsert).not.toHaveBeenCalled();
    const r = await uc.unset({ key: 'owner_review_threshold_ugx', actorId: 'a' });
    expect(r).toEqual({ ok: true, wasSet: false });
    expect(store.remove).toHaveBeenCalledWith('owner_review_threshold_ugx');
    expect(audit.execute).toHaveBeenCalledWith(expect.objectContaining({ action: 'PAYMENTS_OPS_CONFIG_UNSET' }));
    expect(registry).toContain('new PaymentsOpsConfigUseCase(');
  });
});
