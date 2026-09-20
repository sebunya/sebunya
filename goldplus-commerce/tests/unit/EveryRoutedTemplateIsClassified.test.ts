import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { classifyMessage } from '../../apps/api/src/infrastructure/notifications/messageClassification';

/**
 * Every template the router can emit must be classified.
 *
 * An unclassified template falls through to MARKETING and is blocked by the
 * consent gate — silently, from the sender's point of view. It has now happened
 * twice: the phone-verification OTP (fixed 9657bcca) and the paid-order
 * fulfilment alert, which was written, deployed, and answered DISABLED /
 * BLOCK_CONSENT on its first real send (2026-09-20).
 *
 * So the check is not "remember to add it to the list" — it is this test.
 */
const routerSource = readFileSync(
  join(__dirname, '../../apps/api/src/infrastructure/notifications/NotificationRouter.ts'),
  'utf8',
);

describe('every template the router can emit', () => {
  const templates = [...new Set(
    [...routerSource.matchAll(/template:\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1]),
  )];

  it('finds the templates the router hard-codes', () => {
    expect(templates.length).toBeGreaterThan(0);
    expect(templates).toContain('FULFILMENT_PAID_ORDER_ALERT');
  });

  it('classifies each one, so none is silently blocked as marketing', () => {
    const unclassified = templates.filter((template) =>
      classifyMessage({ recipient: '+256700000000', template, data: {}, relatedEntity: 'order', relatedEntityId: null }) === 'MARKETING',
    );
    expect(unclassified).toEqual([]);
  });

  it('keeps the paid-order alert operational: it goes to the shop, not a customer', () => {
    expect(classifyMessage({
      recipient: '+256776004545',
      template: 'FULFILMENT_PAID_ORDER_ALERT',
      data: {},
      relatedEntity: 'order',
      relatedEntityId: null,
    })).toBe('OPERATIONAL');
  });
});
