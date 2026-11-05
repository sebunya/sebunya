import { describe, it, expect } from 'vitest';
import { rewordListingFacts, LISTING_FACT_CLAIM } from './ListingFactWording';

describe('rewordListingFacts', () => {
  it('names the USB-A connector instead of "any USB port" (GP-64GB-F short description)', () => {
    const s = '64GB flash disk (USB 3.0) for full phone backups, films and office archives. Metal body with a key-ring loop; works in any USB port.';
    expect(rewordListingFacts(s)).toBe('64GB flash disk (USB 3.0) for full phone backups, films and office archives. Metal body with a key-ring loop; plugs into a USB-A port.');
  });
  it('leaves the same-day delivery promise alone (owner 2026-11-05: same-day dispatch and delivery)', () => {
    expect(rewordListingFacts('Plug and play. Same-day delivery in Kampala and Wakiso.')).toBe('Plug and play. Same-day delivery in Kampala and Wakiso.');
  });
  it('leaves other copy untouched and is idempotent', () => {
    const s = 'USB 3.0, and it still works in an older USB 2.0 port.';
    expect(rewordListingFacts(s)).toBe(s);
    const once = rewordListingFacts('Plugs into any USB port on a laptop. Same-day delivery in Kampala and Wakiso.');
    expect(rewordListingFacts(once)).toBe(once);
    expect(LISTING_FACT_CLAIM.test(once)).toBe(false);
  });
});
