import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEAD_LETTER_STATES, isDeadLettered } from '../../apps/api/src/domain/outbox/TerminalState';
import { toRelatedEntityId } from '../../apps/api/src/domain/notifications/RelatedEntityId';

/**
 * The two 2026-08-14 outbox defects, proved against real PostgreSQL.
 *
 * Both were type-boundary defects that only PostgreSQL could reject, so a mock
 * cannot prove either one. A fake repository accepts '' for a uuid quite
 * happily — that is exactly why the crash reached production and retried 299
 * times.
 *
 * Set COMMERCE_TEST_DATABASE_URL to a MIGRATED database. Skips otherwise.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('outbox reliability on real PostgreSQL', () => {
  let raw: any;
  const outboxIds: string[] = [];
  const attemptIds: string[] = [];

  const tag = `rel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const insertOutbox = async (status: string, eventType = 'TELEMETRY_DISPATCH') => {
    const [row] = await raw`
      insert into outbox_events (event_type, payload, status, is_processed, dead_lettered_at, idempotency_key, last_error)
      values (${eventType}, ${raw.json({ tag })}, ${status}, true, now(), ${`${tag}-${status}-${Math.random()}`}, 'seeded')
      returning id`;
    outboxIds.push(row.id);
    return row.id as string;
  };

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 2, prepare: false });
  });

  afterAll(async () => {
    if (!raw) return;
    if (attemptIds.length) await raw`delete from notification_attempts where id = any(${attemptIds})`;
    if (outboxIds.length) await raw`delete from outbox_events where id = any(${outboxIds})`;
    await raw.end({ timeout: 5 });
  });

  describe('an absent relation is storable; an empty string is not', () => {
    it('rejects the empty string the router used to send — the actual production crash', async () => {
      // This is the exact failure: `invalid input syntax for type uuid: ""`,
      // thrown AFTER the SMS had already been dispatched.
      await expect(
        raw`insert into notification_attempts (channel, recipient, template, status, related_entity, related_entity_id)
            values ('sms', '+256700000000', 'PHONE_VERIFICATION', 'SENT', 'user_phone', ${''})
            returning id`,
      ).rejects.toThrow(/invalid input syntax for type uuid/i);
    });

    it('accepts null, which is what the boundary now produces', async () => {
      const [row] = await raw`
        insert into notification_attempts (channel, recipient, template, status, related_entity, related_entity_id)
        values ('sms', '+256700000000', 'PHONE_VERIFICATION', 'SENT', 'user_phone', ${toRelatedEntityId('')})
        returning id, related_entity_id`;
      attemptIds.push(row.id);
      expect(row.related_entity_id).toBeNull();
    });

    it('accepts a real uuid unchanged', async () => {
      const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
      const [row] = await raw`
        insert into notification_attempts (channel, recipient, template, status, related_entity, related_entity_id)
        values ('email', 'ops@example.com', 'ADMIN_ORDER_EMAIL', 'SENT', 'order', ${toRelatedEntityId(id)})
        returning id, related_entity_id`;
      attemptIds.push(row.id);
      expect(row.related_entity_id).toBe(id);
    });

    it('turns a malformed id into a storable null instead of a crash', async () => {
      const [row] = await raw`
        insert into notification_attempts (channel, recipient, template, status, related_entity, related_entity_id)
        values ('sms', '+256700000000', 'PHONE_VERIFICATION', 'SENT', 'user_phone', ${toRelatedEntityId('not-a-uuid')})
        returning id, related_entity_id`;
      attemptIds.push(row.id);
      expect(row.related_entity_id).toBeNull();
    });
  });

  describe('dead-letter reads span both historical spellings', () => {
    it('counts rows written by either writer', async () => {
      const a = await insertOutbox('dead_letter');
      const b = await insertOutbox('dead_lettered');

      const [both] = await raw`
        select count(*)::int as n from outbox_events
        where id = any(${[a, b]}) and status = any(${[...DEAD_LETTER_STATES]})`;
      expect(both.n).toBe(2);

      // The old single-literal filter, kept here to show what it missed.
      const [legacy] = await raw`
        select count(*)::int as n from outbox_events
        where id = any(${[a, b]}) and status = 'dead_letter'`;
      expect(legacy.n).toBe(1);
    });

    it('can replay a telemetry dead letter, which the old filter could not', async () => {
      const id = await insertOutbox('dead_lettered');

      const updated = await raw`
        update outbox_events
        set is_processed = false, status = 'pending', attempt_count = 0,
            next_attempt_at = now(), dead_lettered_at = null, processed_at = null
        where id = ${id} and status = any(${[...DEAD_LETTER_STATES]})
        returning id`;
      expect(updated.length).toBe(1);

      // Idempotent: it is no longer dead-lettered, so a second replay is a no-op
      // rather than a second copy on the queue.
      const again = await raw`
        update outbox_events set is_processed = false
        where id = ${id} and status = any(${[...DEAD_LETTER_STATES]})
        returning id`;
      expect(again.length).toBe(0);
    });

    it('agrees with the domain predicate on what production actually holds', async () => {
      const rows = await raw`
        select distinct status from outbox_events where status = any(${[...DEAD_LETTER_STATES]})`;
      for (const row of rows) expect(isDeadLettered(row.status)).toBe(true);

      // A live event must never read as dead-lettered.
      for (const live of ['pending', 'processing', 'processed', 'retrying']) {
        expect(isDeadLettered(live)).toBe(false);
      }
    });
  });
});
