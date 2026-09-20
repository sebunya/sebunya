import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { classifyTemplate, isTemplateClassified } from '../../apps/api/src/infrastructure/notifications/messageClassification';

/**
 * Every template a producer can emit must be classified by a human.
 *
 * An unclassified template falls through to MARKETING and is refused by the
 * consent gate — silently, from the sender's side. It has happened three times:
 * the password reset, the phone-verification OTP (9657bcca), and the paid-order
 * fulfilment alert, which was written, deployed, switched on and answered
 * DISABLED / NO_CONSENT_FOR_MARKETING on its first real send (2026-09-20).
 *
 * The owner's instruction that none of this shop's messages are marketing is
 * honoured HERE: not by weakening the gate, which must still refuse a genuine
 * promotional send without consent, but by making it impossible to ship a
 * message nobody classified. The runtime stays fail-closed; the failure moves
 * to the build, where somebody can see it.
 */
const API_SRC = join(__dirname, '../../apps/api/src');

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
}

/** Templates named in a `template:` field anywhere a message is produced. */
function producedTemplates(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(API_SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/template:\s*'([A-Za-z0-9_]+)'/g)) found.add(m[1]);
  }
  return [...found];
}

describe('every template a producer can emit', () => {
  const templates = producedTemplates();

  it('finds the templates the code hard-codes', () => {
    expect(templates.length).toBeGreaterThan(5);
    expect(templates).toContain('FULFILMENT_PAID_ORDER_ALERT');
    expect(templates).toContain('ADMIN_ORDER_EMAIL');
  });

  it('has a human decision behind each one, so none is blocked by default', () => {
    // 'proof' is a test fixture in a script, not a customer-facing message.
    const unclassified = templates.filter((t) => t !== 'proof' && !isTemplateClassified(t));
    expect(unclassified).toEqual([]);
  });

  it('keeps the paid-order alert operational: it goes to the shop, not a customer', () => {
    expect(classifyTemplate('FULFILMENT_PAID_ORDER_ALERT')).toBe('OPERATIONAL');
  });

  it('never blocks a message the recipient set in motion', () => {
    for (const t of ['ORDER_PAYMENT_SUCCESS', 'PASSWORD_RESET', 'PHONE_VERIFICATION', 'ORDER_DISPATCHED', 'SUPPORT_REQUEST_RECEIVED']) {
      expect(classifyTemplate(t)).not.toBe('MARKETING');
    }
  });

  it('still refuses a genuine promotional send without consent', () => {
    for (const t of ['LOYALTY_EXPIRY_WARNING', 'LOYALTY_POINTS_EARNED', 'SOME_NEW_CAMPAIGN_BLAST']) {
      expect(classifyTemplate(t)).toBe('MARKETING');
    }
  });
});
