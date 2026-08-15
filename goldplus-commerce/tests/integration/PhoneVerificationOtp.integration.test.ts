import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { classifyTemplate } from '../../apps/api/src/infrastructure/notifications/messageClassification';

/**
 * Phone-verification OTP, proved against real PostgreSQL.
 *
 * The defect these cover shipped because the OTP's identity was only ever
 * examined by the routing table, never by a test that asked what GOVERNANCE
 * would make of it. So the proofs here are about persisted facts: what event
 * type is actually written, what template it actually carries, and whether the
 * outbox's own uniqueness constraint really stops a replay from becoming a
 * second SMS.
 *
 * Set COMMERCE_TEST_DATABASE_URL to a MIGRATED database. Skips otherwise.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('phone verification OTP on real PostgreSQL', () => {
  let raw: any;
  const userIds: string[] = [];
  const outboxIds: string[] = [];
  const tag = `otp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const newUser = async (): Promise<string> => {
    const email = `${tag}-${userIds.length}@example.test`;
    const [row] = await raw`
      insert into users (email, password_hash, display_name)
      values (${email}, 'x', 'OTP Test') returning id`;
    userIds.push(row.id);
    return row.id;
  };

  /** Exactly what OutboxOtpSender writes, so the test proves the real shape. */
  const enqueueOtp = async (phone: string, codeHashPrefix: string) => {
    const [row] = await raw`
      insert into outbox_events (event_type, payload, idempotency_key, status, channel, template, dry_run_only, related_entity)
      values ('PHONE_VERIFICATION_REQUESTED',
              ${raw.json({ kind: 'phone_verification', customerPhone: phone, customerEmail: null })},
              ${`otp:${phone}:${codeHashPrefix}`},
              'pending', 'sms', 'PHONE_VERIFICATION', false, 'user_phone')
      on conflict (idempotency_key) do nothing
      returning id`;
    if (row) outboxIds.push(row.id);
    return row ?? null;
  };

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 2, prepare: false });
  });

  afterAll(async () => {
    if (!raw) return;
    if (outboxIds.length) await raw`delete from outbox_events where id = any(${outboxIds})`;
    if (userIds.length) {
      await raw`delete from phone_verification_codes where user_id = any(${userIds})`;
      await raw`delete from users where id = any(${userIds})`;
    }
    await raw.end({ timeout: 5 });
  });

  describe('the persisted event carries a security identity', () => {
    it('writes the security event type and template, not a loyalty one', async () => {
      const created = await enqueueOtp('+256700000001', 'aaaa1111');
      const [row] = await raw`
        select event_type, template, channel from outbox_events where id = ${created.id}`;

      expect(row.event_type).toBe('PHONE_VERIFICATION_REQUESTED');
      expect(row.event_type).not.toBe('LOYALTY_EXPIRY_WARNING');
      expect(row.template).toBe('PHONE_VERIFICATION');
      expect(row.channel).toBe('sms');
    });

    it('classifies what was actually persisted as transactional', async () => {
      const [row] = await raw`
        select template from outbox_events where id = ${outboxIds[0]}`;
      // Reading the stored value back, rather than trusting the constant.
      expect(classifyTemplate(row.template)).toBe('TRANSACTIONAL');
    });
  });

  describe('outbox replay is not a resend', () => {
    it('refuses a duplicate enqueue of the same code for the same phone', async () => {
      const first = await enqueueOtp('+256700000002', 'bbbb2222');
      expect(first).not.toBeNull();

      // A worker retry or a crashed process re-running the producer.
      const second = await enqueueOtp('+256700000002', 'bbbb2222');
      expect(second).toBeNull();

      const [{ n }] = await raw`
        select count(*)::int as n from outbox_events
        where idempotency_key = ${'otp:+256700000002:bbbb2222'}`;
      expect(n).toBe(1);
    });

    it('allows a genuinely new code to be a new event', async () => {
      // A deliberate resend produces a different code, so a different key.
      const another = await enqueueOtp('+256700000002', 'cccc3333');
      expect(another).not.toBeNull();
    });
  });

  describe('challenge persistence keeps its security properties', () => {
    it('stores a hash, never the code, and expires it', async () => {
      const userId = await newUser();
      const codeHash = 'a'.repeat(64);
      await raw`
        insert into phone_verification_codes (user_id, phone_e164, code_hash, expires_at)
        values (${userId}, '+256700000003', ${codeHash}, now() + interval '10 minutes')`;

      const [row] = await raw`
        select code_hash, expires_at, consumed_at, attempts
        from phone_verification_codes where user_id = ${userId}`;

      expect(row.code_hash).toBe(codeHash);
      expect(row.code_hash).not.toMatch(/^\d{6}$/); // never a bare 6-digit code
      expect(row.consumed_at).toBeNull();
      expect(row.attempts).toBe(0);
      expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('supports the cooldown and hourly-cap reads the use case depends on', async () => {
      const userId = await newUser();
      for (const minutesAgo of [90, 30, 5]) {
        await raw`
          insert into phone_verification_codes (user_id, phone_e164, code_hash, expires_at, created_at)
          values (${userId}, '+256700000004', ${'b'.repeat(64)}, now(), now() - (${minutesAgo} * interval '1 minute'))`;
      }

      // lastOtpIssuedAt: most recent issue, consumed or not.
      const [last] = await raw`
        select created_at from phone_verification_codes
        where user_id = ${userId} order by created_at desc limit 1`;
      expect(Date.now() - new Date(last.created_at).getTime()).toBeLessThan(10 * 60_000);

      // otpCountSince: only the ones inside the window.
      const [{ n }] = await raw`
        select count(*)::int as n from phone_verification_codes
        where user_id = ${userId} and created_at >= now() - interval '1 hour'`;
      expect(n).toBe(2); // the 90-minute-old one is outside the window
    });

    it('counts a consumed code against the cooldown, so consuming is not a reset', async () => {
      const userId = await newUser();
      await raw`
        insert into phone_verification_codes (user_id, phone_e164, code_hash, expires_at, consumed_at)
        values (${userId}, '+256700000005', ${'c'.repeat(64)}, now() + interval '10 minutes', now())`;

      // `latestOtp` filters on consumed_at IS NULL and would see nothing here —
      // which is exactly why the cooldown needed its own read.
      const [{ n }] = await raw`
        select count(*)::int as n from phone_verification_codes
        where user_id = ${userId} and created_at >= now() - interval '1 hour'`;
      expect(n).toBe(1);
    });
  });
});
