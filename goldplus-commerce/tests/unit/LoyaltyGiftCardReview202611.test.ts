import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Fixes from the 2026-11 gift card / store credit / loyalty review that are best proven by their wiring. */
const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('manual points adjustment', () => {
  it('needs a fresh step-up, like creating store credit', () => {
    const routes = read('apps/api/src/interfaces/http/routes/admin/loyalty.ts');
    const line = routes.split('\n').find((l) => l.startsWith("routes.post('/adjust'"))!;
    expect(line).toContain("requireStepUp('payment_refund')");
    expect(read('apps/web/src/pages/admin/loyalty/adjustments.astro')).toContain('MFA_STEP_UP_REQUIRED');
  });
});
