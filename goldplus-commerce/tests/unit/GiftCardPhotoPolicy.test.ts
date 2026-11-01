import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  GIFT_CARD_PHOTO_RETENTION_DAYS, GIFT_CARD_PHOTOS_PER_DAY, GIFT_CARD_PHOTOS_PER_VISITOR_PER_DAY,
} from '../../apps/api/src/domain/credit/GiftCardPhoto';
import { policyBySlug } from '../../apps/web/src/lib/legal-policies';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const words: Record<number, string> = { 2: 'two', 3: 'three', 30: '30', 90: '90' };

// The privacy policy is a promise to customers: what it says about gift card photos must be what the code does.
describe('gift card photos: the privacy policy, the docs and the code say the same thing (0201)', () => {
  const privacy = read('apps/web/src/pages/privacy.astro').replace(/\s+/g, ' ');
  const docs = read('docs/gift-cards/README.md').replace(/\s+/g, ' ');

  it('the policy has a gift card section, listed in its contents, and moved to version 1.3', () => {
    expect(privacy).toContain('id="gift-cards"');
    expect(privacy).toContain('href="#gift-cards"');
    expect(policyBySlug('privacy')?.version).toBe('1.3');
  });

  it('every deletion period in the policy is the period the sweep uses', () => {
    const d = GIFT_CARD_PHOTO_RETENTION_DAYS;
    expect(privacy).toContain(`photo nobody used within ${words[d.unclaimed]} days`);
    expect(privacy).toContain(`refunded ${words[d.endedPurchase]} days after it ended`);
    expect(privacy).toContain(`expired ${words[d.doneCard]} days after that`);
    expect(docs).toContain(`can be put on a card for ${d.claim} days`);
    expect(docs).toContain(`An upload nothing claimed is deleted after ${d.unclaimed} days`);
    expect(docs).toContain(`deleted ${d.endedPurchase} days after it ended`);
    expect(docs).toContain(`deleted ${d.doneCard} days after its last movement`);
  });

  it('the policy promises what the code does: metadata removed, who can see it, who can remove it, erasure', () => {
    for (const claim of ['location, camera and other details', 'Only the person the card is for, the buyer and our staff can see it',
      'The person it is for, the buyer, or we can remove a photo at any time', 'the photos on cards you bought or received go with it',
      'The note is shown on the card, not in the text message']) {
      expect(privacy, claim).toContain(claim);
    }
    // No promise about backups the host does not keep (pre-migration dumps are kept until an off-site copy exists).
    expect(privacy).not.toMatch(/leave our backups within/);
  });

  it('the docs state the daily limits the use case enforces', () => {
    expect(docs).toContain(`${GIFT_CARD_PHOTOS_PER_VISITOR_PER_DAY} photos a day per visitor`);
    expect(docs).toContain(`${GIFT_CARD_PHOTOS_PER_DAY} photos a day across the whole shop`);
  });
});
