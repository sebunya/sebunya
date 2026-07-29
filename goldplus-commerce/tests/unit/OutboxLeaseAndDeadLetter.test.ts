import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProcessOutboxBatchUseCase } from '../../apps/api/src/application/use-cases/outbox/ProcessOutboxBatchUseCase';

/**
 * Two defects motivated this.
 *
 * An event exhausted after MAX_ATTEMPTS was recorded with is_processed = true
 * and status 'processed' — identical, in every metric and every query, to one
 * that was actually delivered. The failures were invisible and unreplayable.
 *
 * And completion matched on id alone, so a worker whose lease had expired
 * mid-delivery could return afterwards and overwrite the outcome recorded by
 * the worker that had since taken the event over.
 */

const repoSource = readFileSync(
  join(__dirname, '../../apps/api/src/infrastructure/db/repositories/DrizzleOutboxRepository.ts'),
  'utf8',
);
const migration = readFileSync(
  join(__dirname, '../../apps/api/src/infrastructure/db/migrations/0054_outbox_lease_and_dead_letter.sql'),
  'utf8',
);

describe('lease ownership', () => {
  it('records who claimed the event and until when', () => {
    for (const column of ['worker_id', 'claimed_at', 'lease_expires_at']) {
      expect(migration).toContain(column);
    }
    expect(repoSource).toContain('workerId: this.workerId');
    expect(repoSource).toContain('claimedAt: now');
  });

  it('guards every completion path with the worker id', () => {
    // Without this, a stale worker can overwrite its successor — including
    // turning a delivered event back into a pending one and re-sending it.
    for (const method of ['markProcessed', 'markDeadLettered', 'recordFailure']) {
      const start = repoSource.indexOf(`async ${method}(`);
      expect(start, `${method} missing`).toBeGreaterThan(-1);
      const body = repoSource.slice(start, start + 900);
      expect(body, `${method} is not lease-guarded`).toContain('eq(outboxEvents.workerId, this.workerId)');
      expect(body, `${method} does not report whether it wrote`).toContain('.returning(');
    }
  });

  it('reports whether the write happened rather than assuming it', () => {
    expect(repoSource).toContain('return updated.length === 1;');
  });

  it('releases the lease when the event leaves processing', () => {
    // A completed event holding a lease would look like a stuck worker forever.
    const marks = repoSource.split('async mark').slice(1);
    for (const body of marks) expect(body.slice(0, 900)).toContain('workerId: null');
  });

  it('claims and completes in separate short transactions', () => {
    // Holding a transaction open across a provider call ties up a connection
    // for the provider's timeout and blocks everything behind it.
    const claim = repoSource
      .slice(repoSource.indexOf('async claimDueBatch'), repoSource.indexOf('async markProcessed'))
      // Strip comments, or the prose explaining WHY no provider call belongs
      // here would itself trip the check.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(claim).toContain('db.transaction');
    // Everything awaited inside the claim is a database call on the transaction.
    const awaited = claim.match(/await\s+([a-zA-Z_$][\w$.]*)/g) ?? [];
    expect(awaited.every((a) => /await\s+(tx|db)\b/.test(a))).toBe(true);
  });
});

describe('dead letters are not deliveries', () => {
  it('has a distinct terminal state', () => {
    expect(repoSource).toContain("status: 'dead_letter'");
    expect(repoSource).toContain('deadLetteredAt');
  });

  it('routes exhaustion to dead-letter rather than processed', () => {
    const useCase = readFileSync(
      join(__dirname, '../../apps/api/src/application/use-cases/outbox/ProcessOutboxBatchUseCase.ts'),
      'utf8',
    );
    expect(useCase).toContain('markDeadLettered');
    const exhaustion = useCase.slice(useCase.indexOf('nextAttemptCount >= MAX_ATTEMPTS'));
    expect(exhaustion.slice(0, 600)).toContain('markDeadLettered');
  });

  it('keeps a dead letter out of the claim query', () => {
    // is_processed stays true: leaving it false would make the claim scan pick
    // the event up forever.
    const dl = repoSource.slice(repoSource.indexOf('async markDeadLettered'), repoSource.indexOf('async recordFailure'));
    expect(dl).toContain('isProcessed: true');
  });

  it('counts from status, not from the processed boolean', () => {
    const metrics = repoSource.slice(repoSource.indexOf('async metrics('), repoSource.indexOf('async listDeadLettered'));
    expect(metrics).toContain("status = 'dead_letter'");
    expect(metrics).toContain('deadLettered');
  });

  it('exposes queue depth, oldest age and expired leases', () => {
    const metrics = repoSource.slice(repoSource.indexOf('async metrics('), repoSource.indexOf('async listDeadLettered'));
    for (const signal of ['pending', 'due', 'processing', 'oldest', 'expiredLeases']) {
      expect(metrics).toContain(signal);
    }
  });

  it('makes replay idempotent by requiring the dead-letter state', () => {
    const start = repoSource.indexOf('async replayDeadLettered');
    const replay = repoSource.slice(start, repoSource.indexOf('\n  }', start));
    expect(replay).toContain("eq(outboxEvents.status, 'dead_letter')");
    // The idempotency key is untouched, so a consumer that already saw the
    // original still deduplicates it.
    expect(replay).not.toContain('idempotencyKey');
  });

  it('backfills historical exhaustions so the list is not silently truncated', () => {
    expect(migration).toContain('"last_error" LIKE \'Exhausted after%\'');
    expect(migration).toContain('SET "status" = \'dead_letter\'');
  });
});

describe('outbox retry scheduling is preserved', () => {
  it('still uses the jittered backoff rather than reverting to a fixed delay', async () => {
    const { computeBackoffSeconds } = await import(
      '../../apps/api/src/application/use-cases/outbox/ProcessOutboxBatchUseCase'
    );
    const delays = new Set(Array.from({ length: 50 }, () => computeBackoffSeconds(3, Math.random)));
    expect(delays.size).toBeGreaterThan(5);
  });

  it('still bounds attempts', () => {
    expect(ProcessOutboxBatchUseCase).toBeDefined();
    const useCase = readFileSync(
      join(__dirname, '../../apps/api/src/application/use-cases/outbox/ProcessOutboxBatchUseCase.ts'),
      'utf8',
    );
    expect(useCase).toContain('MAX_ATTEMPTS = 8');
  });

  it('still claims with SKIP LOCKED', () => {
    expect(repoSource).toContain("skipLocked: true");
  });
});
