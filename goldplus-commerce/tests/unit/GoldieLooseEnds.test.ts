import { describe, expect, it } from 'vitest';
import { ANSWERS_VALID_FROM, memoryUsable } from '../../apps/api/src/domain/assistant/AnswerMemory';
import { formatSocialReply } from '../../apps/api/src/domain/assistant/SocialGoldie';

const now = new Date(ANSWERS_VALID_FROM.getTime() + 86400_000);
const base = { pinned: false, retired: false, poorRatings: 0, expiresAt: new Date(now.getTime() + 86400_000) };

describe('answers remembered under the old instructions are not replayed', () => {
  it('an unpinned answer written before the cutoff is skipped; a pinned one, or one rewritten since, is served', () => {
    const old = new Date(ANSWERS_VALID_FROM.getTime() - 3600_000);
    expect(memoryUsable({ ...base, createdAt: old, updatedAt: old }, now)).toBe(false);
    expect(memoryUsable({ ...base, pinned: true, createdAt: old, updatedAt: old }, now)).toBe(true);
    expect(memoryUsable({ ...base, createdAt: old, updatedAt: new Date(ANSWERS_VALID_FROM.getTime() + 60_000) }, now)).toBe(true);
  });
});

describe('Messenger and Instagram list the same products as WhatsApp would', () => {
  const products = [
    { name: 'GoldPlus GP-P07 20000mAh Power Bank', url: 'https://shopgoldplus.com/products/p07', price_ugx: 130000, availability: 'in_stock' },
    { name: 'GoldPlus GP-X01 Power Bank', url: 'https://shopgoldplus.com/products/x01', price_ugx: 260000, availability: 'in_stock' },
  ];
  it('only what the answer names; nothing under a question', () => {
    expect(formatSocialReply({ text: 'I would go for the GP-P07 20000mAh: two full charges of your A14.', products, route: 'ai' }, 'messenger')).not.toContain('GP-X01');
    expect(formatSocialReply({ text: 'Which phone do you charge with it?', products, route: 'ai' }, 'instagram')).not.toContain('UGX');
  });
});
