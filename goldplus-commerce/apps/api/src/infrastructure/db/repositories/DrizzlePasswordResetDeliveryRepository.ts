import { and, eq, isNull, sql } from 'drizzle-orm';

import {
  IPasswordResetDeliveryRepository,
  PASSWORD_RESET_DELIVERY_EVENT_TYPE,
  PasswordResetOperationSnapshot,
} from '../../../application/ports/IPasswordResetDelivery';
import { db } from '../client';
import { passwordResetTokens } from '../schema/identity';
import { notificationAttempts } from '../schema/phase11';
import { outboxEvents } from '../schema/system';

/**
 * MODEL_T persistence for password-reset delivery.
 *
 * The root token row IS the reset operation, so `operation_id` on the root
 * equals its own id and every rotation carries the same value. Nothing here
 * ever stores a raw token or a reset URL — only the one-way hash the rest of
 * the system already keeps.
 *
 * Every timestamp comparison uses `now()` from PostgreSQL rather than the
 * application host's clock. Expiry and eligibility are security decisions, and
 * two API replicas with drifting clocks must not disagree about whether a
 * credential is still alive.
 */
export class DrizzlePasswordResetDeliveryRepository implements IPasswordResetDeliveryRepository {
  async createOperation(input: {
    userId: string;
    tokenHash: string;
    tokenExpiresAt: Date;
    requestedIp: string | null;
    recipientEmail: string;
    workerEligibleAt: Date;
  }): Promise<{ operationId: string; tokenId: string; attemptId: string }> {
    // ONE transaction. Every write below uses `tx`, never `db` — a repository
    // that quietly reaches for the root connection is the classic way an
    // "atomic" block turns out to have committed only part of itself.
    return db.transaction(async (tx) => {
      const [token] = await tx
        .insert(passwordResetTokens)
        .values({
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: input.tokenExpiresAt,
          requestedIp: input.requestedIp,
        })
        .returning({ id: passwordResetTokens.id });

      // The root token IS the operation: its own id becomes the operation id,
      // and every later rotation inherits that value.
      await tx
        .update(passwordResetTokens)
        .set({ operationId: token.id })
        .where(eq(passwordResetTokens.id, token.id));

      const [attempt] = await tx
        .insert(notificationAttempts)
        .values({
          channel: 'email',
          recipient: input.recipientEmail,
          template: 'PASSWORD_RESET',
          status: 'PREPARED',
          relatedEntity: 'password_reset',
          // The EXACT token this attempt will carry — never resolved later from
          // "the latest token", which a rotation would make a different row.
          relatedEntityId: token.id,
        })
        .returning({ id: notificationAttempts.id });

      await tx.insert(outboxEvents).values({
        eventType: PASSWORD_RESET_DELIVERY_EVENT_TYPE,
        // Secret-free: an operation reference and nothing that could rebuild a link.
        payload: { operationId: token.id } as never,
        idempotencyKey: `password-reset-delivery:${token.id}`,
        status: 'pending',
        channel: 'email',
        template: 'PASSWORD_RESET',
        dryRunOnly: false,
        relatedEntity: 'password_reset',
        relatedEntityId: token.id,
        // Ownership: the originating request sends first. A recovery worker
        // becomes eligible only once this passes, so it cannot race a request
        // that is merely slow.
        nextAttemptAt: input.workerEligibleAt,
      });

      return { operationId: token.id, tokenId: token.id, attemptId: attempt.id };
    });
  }

  async loadOperation(operationId: string): Promise<PasswordResetOperationSnapshot | null> {
    const [row] = await db.execute(sql`
      select
        root.id                as operation_id,
        root.user_id           as user_id,
        root.created_at        as root_created_at,
        u.email                as recipient_email,
        -- Operation-WIDE. Any consumed token of this operation ends it, not
        -- merely the current one.
        (select max(t.consumed_at) from password_reset_tokens t
          where t.operation_id = root.id)                       as consumed_at,
        (select t.id from password_reset_tokens t
          where t.operation_id = root.id
            and t.consumed_at is null and t.superseded_at is null
          limit 1)                                              as current_token_id,
        (select t.expires_at from password_reset_tokens t
          where t.operation_id = root.id
            and t.consumed_at is null and t.superseded_at is null
          limit 1)                                              as current_token_expires_at,
        -- Only attempts that actually crossed the dispatch boundary. A local
        -- abort cost the provider nothing and must not spend retry budget.
        (select count(*) from notification_attempts na
          join password_reset_tokens t on t.id = na.related_entity_id
          where t.operation_id = root.id
            and na.status in ('DISPATCH_STARTED','SENT','FAILED','OUTCOME_UNKNOWN'))::int
                                                                as dispatched_attempts
      from password_reset_tokens root
      join users u on u.id = root.user_id
      where root.id = ${operationId} and root.operation_id = root.id
    `);

    // No root row means the operation is orphaned. Fail closed: the caller must
    // not invent identity for a reset nobody can prove was requested.
    if (!row) return null;

    const r = row as Record<string, any>;
    return {
      operationId: String(r.operation_id),
      userId: String(r.user_id),
      recipientEmail: String(r.recipient_email),
      rootCreatedAt: new Date(r.root_created_at),
      consumedAt: r.consumed_at ? new Date(r.consumed_at) : null,
      currentToken: r.current_token_id
        ? { id: String(r.current_token_id), expiresAt: new Date(r.current_token_expires_at) }
        : null,
      dispatchedAttempts: Number(r.dispatched_attempts ?? 0),
    };
  }

  async supersedeToken(tokenId: string): Promise<boolean> {
    const updated = await db
      .update(passwordResetTokens)
      .set({ supersededAt: new Date() })
      .where(
        and(
          eq(passwordResetTokens.id, tokenId),
          isNull(passwordResetTokens.supersededAt),
          isNull(passwordResetTokens.consumedAt),
        ),
      )
      .returning({ id: passwordResetTokens.id });
    return updated.length === 1;
  }

  async supersedeAndScheduleRetry(input: {
    operationId: string;
    tokenId: string;
    nextAttemptAt: Date;
    reason: string;
  }): Promise<boolean> {
    return db.transaction(async (tx) => {
      const superseded = await tx
        .update(passwordResetTokens)
        .set({ supersededAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.id, input.tokenId),
            isNull(passwordResetTokens.supersededAt),
            isNull(passwordResetTokens.consumedAt),
          ),
        )
        .returning({ id: passwordResetTokens.id });

      // Lost the race — another worker already retired this token, or the
      // customer consumed it. Do not arm a retry on top of someone else's
      // decision.
      if (superseded.length !== 1) return false;

      const armed = await tx
        .update(outboxEvents)
        .set({
          status: 'pending',
          nextAttemptAt: input.nextAttemptAt,
          lastError: input.reason.slice(0, 500),
          attemptCount: sql`${outboxEvents.attemptCount} + 1`,
          workerId: null,
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(outboxEvents.eventType, PASSWORD_RESET_DELIVERY_EVENT_TYPE),
            eq(outboxEvents.relatedEntityId, input.operationId),
            eq(outboxEvents.isProcessed, false),
          ),
        )
        .returning({ id: outboxEvents.id });

      return armed.length === 1;
    });
  }

  async finaliseIntent(input: { operationId: string; terminalReason: string }): Promise<boolean> {
    const updated = await db
      .update(outboxEvents)
      .set({
        isProcessed: true,
        processedAt: new Date(),
        status: 'processed',
        lastError: input.terminalReason.slice(0, 500),
        workerId: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(outboxEvents.eventType, PASSWORD_RESET_DELIVERY_EVENT_TYPE),
          eq(outboxEvents.relatedEntityId, input.operationId),
          eq(outboxEvents.isProcessed, false),
        ),
      )
      .returning({ id: outboxEvents.id });
    return updated.length === 1;
  }

  async claimDueIntent(now: Date, leaseUntil: Date): Promise<PasswordResetOperationSnapshot | null> {
    // Compare-and-set on the claim itself: `worker_id is null` in the WHERE
    // clause means two workers waking together cannot both win, without either
    // holding a lock across the work that follows.
    const claimed = await db.execute(sql`
      update outbox_events
      set worker_id = ${`password-reset-${process.pid}`},
          claimed_at = now(),
          lease_expires_at = ${leaseUntil},
          status = 'processing'
      where id = (
        select id from outbox_events
        where event_type = ${PASSWORD_RESET_DELIVERY_EVENT_TYPE}
          and is_processed = false
          and next_attempt_at <= ${now}
          and (worker_id is null or lease_expires_at < now())
        order by next_attempt_at asc
        limit 1
        for update skip locked
      )
      returning related_entity_id
    `);

    const rows = (claimed as any).rows ?? claimed;
    if (!rows || rows.length === 0) return null;
    return this.loadOperation(String(rows[0].related_entity_id));
  }

  async createRetryTokenAndAttempt(input: {
    operationId: string;
    tokenHash: string;
    tokenExpiresAt: Date;
    recipientEmail: string;
  }): Promise<{ tokenId: string; attemptId: string } | null> {
    return db.transaction(async (tx) => {
      const [root] = await tx
        .select({ userId: passwordResetTokens.userId })
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.id, input.operationId));
      if (!root) return null;

      // The partial unique index is the final backstop: if another worker has
      // already minted a current token for this operation, this insert violates
      // it rather than producing a second live credential.
      const [token] = await tx
        .insert(passwordResetTokens)
        .values({
          userId: root.userId,
          operationId: input.operationId,
          tokenHash: input.tokenHash,
          expiresAt: input.tokenExpiresAt,
          requestedIp: null,
        })
        .returning({ id: passwordResetTokens.id });

      const [attempt] = await tx
        .insert(notificationAttempts)
        .values({
          channel: 'email',
          recipient: input.recipientEmail,
          template: 'PASSWORD_RESET',
          status: 'PREPARED',
          relatedEntity: 'password_reset',
          relatedEntityId: token.id,
        })
        .returning({ id: notificationAttempts.id });

      return { tokenId: token.id, attemptId: attempt.id };
    });
  }
}
