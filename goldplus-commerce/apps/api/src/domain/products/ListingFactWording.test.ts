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
  it('GP-P05W: wireless charging needs a wireless-capable phone; magnets only hold it; wired and wireless ratings stay separate (brief A2)', () => {
    const short = '10000mAh power bank that snaps onto the back of a phone with a magnetic ring and charges it wirelessly at up to 15W. Type-C and iPhone cables built in, 22.5W wired.';
    const long = 'No cable, no holding it in place. The GP-P05W snaps magnetically onto the back of a phone that has a magnetic ring or a magnetic case and charges it wirelessly at up to 15W while you keep using the phone. For any other phone, a Type-C cable and a Lightning cable are built into the back, with wired charging up to 22.5W. 10000mAh capacity. Same-day delivery in Kampala and Wakiso.';
    const s = rewordListingFacts(short); const l = rewordListingFacts(long);
    for (const out of [s, l]) {
      expect(out).toMatch(/only if the phone (itself )?supports wireless charging/);
      expect(LISTING_FACT_CLAIM.test(out)).toBe(false);
      expect(rewordListingFacts(out)).toBe(out);
      expect(out).toContain('15W'); expect(out).toContain('22.5W');
    }
    expect(LISTING_FACT_CLAIM.test(short)).toBe(true);
    expect(LISTING_FACT_CLAIM.test(long)).toBe(true);
    expect(l).toContain('does not make a phone wirelessly chargeable');
    expect(l).toContain('For a phone with a Type-C or Lightning port');
    expect(l.endsWith('10000mAh capacity. Same-day delivery in Kampala and Wakiso.')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(500);
  });
});
