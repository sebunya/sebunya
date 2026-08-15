import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The B+ password-reset operation, against real PostgreSQL.
 *
 * Three writes have to land together or not at all — root token, secret-free
 * delivery intent, PREPARED attempt. A mocked repository cannot prove that: it
 * will happily "roll back" writes it never made, and the classic failure here
 * is one repository quietly using the root connection instead of the
 * transaction, so the block looks atomic and commits partially.
 *
 * Set COMMERCE_TEST_DATABASE_URL to a MIGRATED database. Skips otherwise.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('password reset operation on real PostgreSQL', () => {
  let raw: any;
  let repo: any;
  const userIds: string[] = [];
  const tag = `pro-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const newUser = async (): Promise<string> => {
    const [row] = await raw`
      insert into users (email, password_hash, display_name)
      values (${`${tag}-${userIds.length}@example.test`}, 'x', 'Reset Op') returning id`;
    userIds.push(row.id);
    return row.id;
  };

  /** 64 hex chars, genuinely distinct — token_hash is uniquely indexed. */
  const freshHash = () =>
    Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

  const create = async (userId: string, over: Record<string, any> = {}) =>
    repo.createOperation({
      userId,
      tokenHash: freshHash(),
      tokenExpiresAt: new Date(Date.now() + 60 * 60_000),
      requestedIp: null,
      recipientEmail: `${tag}@example.test`,
      workerEligibleAt: new Date(Date.now() + 5 * 60_000),
      ...over,
    });

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    const mod = await import(
      '../../apps/api/src/infrastructure/db/repositories/DrizzlePasswordResetDeliveryRepository'
    );
    repo = new (mod as any).DrizzlePasswordResetDeliveryRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    if (userIds.length) {
      await raw`delete from notification_attempts where recipient like ${`${tag}%`}`;
      await raw`delete from outbox_events where related_entity = 'password_reset' and related_entity_id in (select id from password_reset_tokens where user_id = any(${userIds}))`;
      await raw`delete from password_reset_tokens where user_id = any(${userIds})`;
      await raw`delete from users where id = any(${userIds})`;
    }
    await raw.end({ timeout: 5 });
  });

  describe('the initial transaction lands all three writes', () => {
    it('creates root token, delivery intent and PREPARED attempt together', async () => {
      const userId = await newUser();
      const { operationId, tokenId, attemptId } = await create(userId);

      const [token] = await raw`select id, operation_id, superseded_at, consumed_at from password_reset_tokens where id = ${tokenId}`;
      const [intent] = await raw`select event_type, related_entity_id, payload::text as payload, next_attempt_at, is_processed from outbox_events where related_entity_id = ${operationId}`;
      const [attempt] = await raw`select id, status, related_entity_id, template from notification_attempts where id = ${attemptId}`;

      // The root token IS the operation.
      expect(token.operation_id).toBe(token.id);
      expect(operationId).toBe(tokenId);
      expect(token.superseded_at).toBeNull();

      expect(intent.event_type).toBe('PASSWORD_RESET_DELIVERY');
      expect(intent.is_processed).toBe(false);

      expect(attempt.status).toBe('PREPARED');
      // The attempt names the EXACT token it will carry.
      expect(attempt.related_entity_id).toBe(tokenId);
      expect(attempt.template).toBe('PASSWORD_RESET');
    });

    it('keeps no reset secret in the durable intent', async () => {
      const userId = await newUser();
      const { operationId } = await create(userId);
      const [intent] = await raw`select payload::text as payload from outbox_events where related_entity_id = ${operationId}`;
      // Only an operation reference. Nothing that could rebuild a link.
      expect(intent.payload).toContain(operationId);
      expect(intent.payload).not.toMatch(/token=|rawToken|reset-password\?/);
    });

    it('leaves the intent invisible to the worker during the request window', async () => {
      const userId = await newUser();
      const { operationId } = await create(userId);
      const [intent] = await raw`select next_attempt_at from outbox_events where related_entity_id = ${operationId}`;
      // The originating request owns the first send; a recovery worker must not
      // race it merely because the request is slow.
      expect(new Date(intent.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('rolls back everything when one write fails', async () => {
      const userId = await newUser();
      const first = await create(userId);

      // Reuse the same token hash: the unique index on token_hash rejects it,
      // and the whole transaction must die with it.
      const [{ token_hash: hash }] = await raw`select token_hash from password_reset_tokens where id = ${first.tokenId}`;
      const attemptsBefore = await raw`select count(*)::int as n from notification_attempts where recipient like ${`${tag}%`}`;
      const intentsBefore = await raw`select count(*)::int as n from outbox_events where event_type = 'PASSWORD_RESET_DELIVERY'`;

      await expect(create(userId, { tokenHash: hash })).rejects.toThrow();

      const attemptsAfter = await raw`select count(*)::int as n from notification_attempts where recipient like ${`${tag}%`}`;
      const intentsAfter = await raw`select count(*)::int as n from outbox_events where event_type = 'PASSWORD_RESET_DELIVERY'`;

      // No orphan attempt, no orphan intent — every write shared the transaction.
      expect(attemptsAfter[0].n).toBe(attemptsBefore[0].n);
      expect(intentsAfter[0].n).toBe(intentsBefore[0].n);
    });
  });

  describe('the operation read model is operation-wide', () => {
    it('reports the current token and zero dispatched attempts initially', async () => {
      const userId = await newUser();
      const { operationId, tokenId } = await create(userId);
      const snap = await repo.loadOperation(operationId);

      expect(snap.currentToken.id).toBe(tokenId);
      expect(snap.consumedAt).toBeNull();
      // PREPARED has not crossed the dispatch boundary, so it costs no budget.
      expect(snap.dispatchedAttempts).toBe(0);
    });

    it('counts only attempts that crossed the dispatch boundary', async () => {
      const userId = await newUser();
      const { operationId, tokenId } = await create(userId);

      await raw`insert into notification_attempts (channel, recipient, template, status, related_entity, related_entity_id)
                values ('email', ${`${tag}@example.test`}, 'PASSWORD_RESET', 'NOT_DISPATCHED', 'password_reset', ${tokenId})`;
      let snap = await repo.loadOperation(operationId);
      expect(snap.dispatchedAttempts).toBe(0);

      await raw`insert into notification_attempts (channel, recipient, template, status, related_entity, related_entity_id)
                values ('email', ${`${tag}@example.test`}, 'PASSWORD_RESET', 'FAILED', 'password_reset', ${tokenId})`;
      snap = await repo.loadOperation(operationId);
      expect(snap.dispatchedAttempts).toBe(1);
    });

    it('sees consumption of ANY token of the operation, not just the current one', async () => {
      const userId = await newUser();
      const { operationId, tokenId } = await create(userId);

      // The customer used the first token; a rotation happened afterwards.
      await raw`update password_reset_tokens set consumed_at = now() where id = ${tokenId}`;
      await raw`insert into password_reset_tokens (user_id, operation_id, token_hash, expires_at)
                values (${userId}, ${operationId}, ${'b'.repeat(64)}, now() + interval '30 minutes')`;

      const snap = await repo.loadOperation(operationId);
      // Asking only the current token would miss this and re-send a link for a
      // reset that is already finished.
      expect(snap.consumedAt).not.toBeNull();
    });

    it('returns null for an orphaned operation id', async () => {
      expect(await repo.loadOperation('44444444-4444-4444-8444-444444444444')).toBeNull();
    });
  });

  describe('supersede and retry scheduling', () => {
    it('retires the token and arms the intent in one step', async () => {
      const userId = await newUser();
      const { operationId, tokenId } = await create(userId);

      const armed = await repo.supersedeAndScheduleRetry({
        operationId,
        tokenId,
        nextAttemptAt: new Date(Date.now() + 60_000),
        reason: 'RETRYABLE:rate_limited',
      });
      expect(armed).toBe(true);

      const snap = await repo.loadOperation(operationId);
      // ZERO live credentials during backoff: the provider proved it never took
      // the message, so leaving one usable would be exposure for nothing.
      expect(snap.currentToken).toBeNull();

      const [intent] = await raw`select next_attempt_at, is_processed, last_error from outbox_events where related_entity_id = ${operationId}`;
      expect(intent.is_processed).toBe(false);
      expect(new Date(intent.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('mints the replacement token only when asked, and keeps the operation id', async () => {
      const userId = await newUser();
      const { operationId, tokenId } = await create(userId);
      await repo.supersedeAndScheduleRetry({ operationId, tokenId, nextAttemptAt: new Date(), reason: 'r' });

      const minted = await repo.createRetryTokenAndAttempt({
        operationId,
        tokenHash: freshHash(),
        tokenExpiresAt: new Date(Date.now() + 30 * 60_000),
        recipientEmail: `${tag}@example.test`,
      });

      const [token] = await raw`select operation_id from password_reset_tokens where id = ${minted.tokenId}`;
      expect(token.operation_id).toBe(operationId);
      expect(minted.tokenId).not.toBe(tokenId);

      const [attempt] = await raw`select status, related_entity_id from notification_attempts where id = ${minted.attemptId}`;
      expect(attempt.status).toBe('PREPARED');
      expect(attempt.related_entity_id).toBe(minted.tokenId);
    });

    it('cannot mint a second current token for one operation', async () => {
      const userId = await newUser();
      const { operationId } = await create(userId);
      // A current token already exists; the partial unique index is the backstop.
      await expect(
        repo.createRetryTokenAndAttempt({
          operationId,
          tokenHash: freshHash(),
          tokenExpiresAt: new Date(Date.now() + 30 * 60_000),
          recipientEmail: `${tag}@example.test`,
        }),
      ).rejects.toThrow(/password_reset_one_current_token_per_operation/);
    });
  });

  describe('claiming is exclusive', () => {
    it('gives a due intent to exactly one of two concurrent workers', async () => {
      const userId = await newUser();
      const { operationId } = await create(userId, { workerEligibleAt: new Date(Date.now() - 1000) });

      const [a, b] = await Promise.all([
        repo.claimDueIntent(new Date(), new Date(Date.now() + 60_000)),
        repo.claimDueIntent(new Date(), new Date(Date.now() + 60_000)),
      ]);

      const winners = [a, b].filter((r) => r?.operationId === operationId);
      expect(winners).toHaveLength(1);
    });

    it('does not hand out an intent that is not yet due', async () => {
      const userId = await newUser();
      await create(userId, { workerEligibleAt: new Date(Date.now() + 10 * 60_000) });
      // Claim with a `now` before eligibility — the request still owns it.
      const claimed = await repo.claimDueIntent(new Date(Date.now() - 60_000), new Date(Date.now() + 60_000));
      expect(claimed).toBeNull();
    });
  });
});
