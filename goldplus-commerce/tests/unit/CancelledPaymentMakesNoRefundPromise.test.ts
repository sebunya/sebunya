import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A payment the customer stopped before it finished has no reversal behind it,
 * so "it will come back" was a promise the system does not make.
 */
describe('the PesaPal cancellation page promises only what we do', () => {
  const page = readFileSync(join(__dirname, '../../apps/web/src/pages/checkout/pesapal/cancelled.astro'), 'utf8');

  it('asks the customer to tell us instead of promising the money returns', () => {
    expect(page).not.toMatch(/it will come back/);
    expect(page).toContain('If money left your phone or card anyway, tell us and we will sort it out.');
  });
});
