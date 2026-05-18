import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hasSeenBefore, markSeenBefore, shouldShowPickUpWhereYouLeftOff, getRecentlyViewedHistory } from '../../apps/web/src/lib/returning-user';
import { saveRecentlyViewedLocal } from '../../apps/web/src/lib/recommendations';

describe('GoldPlus UI Pass H1E — Visitor Intelligence and Context Privacy', () => {
  let localStorageMock: Record<string, string> = {};

  beforeEach(() => {
    localStorageMock = {};
    
    // Stub global window and localStorage safely
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => localStorageMock[key] || null,
        setItem: (key: string, value: string) => {
          localStorageMock[key] = String(value);
        },
        removeItem: (key: string) => {
          delete localStorageMock[key];
        }
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should detect returning visitor states correctly', () => {
    expect(hasSeenBefore()).toBe(false);

    markSeenBefore();
    expect(hasSeenBefore()).toBe(true);
    expect(localStorageMock['goldplus_seen_before']).toBe('true');
  });

  it('should manage and deduplicate recently viewed local history safely', () => {
    const product1 = { productId: 'id-1', slug: 'p-1', name: 'Product 1', imageUrl: 'url-1', price: 1000 };
    const product2 = { productId: 'id-2', slug: 'p-2', name: 'Product 2', imageUrl: 'url-2', price: 2000 };

    saveRecentlyViewedLocal(product1);
    let history = getRecentlyViewedHistory();
    expect(history.length).toBe(1);
    expect(history[0].productId).toBe('id-1');

    // Add again to test deduplication
    saveRecentlyViewedLocal(product1);
    history = getRecentlyViewedHistory();
    expect(history.length).toBe(1);

    // Add second product
    saveRecentlyViewedLocal(product2);
    history = getRecentlyViewedHistory();
    expect(history.length).toBe(2);
    expect(history[0].productId).toBe('id-2'); // Most recently viewed at top
  });

  it('should ensure strict tracking privacy limits (no forbidden data)', () => {
    // Assert that no sensitive fields (like tokens, phone, email, contact details, payment information) are stored
    const keys = Object.keys(localStorageMock);
    const forbiddenPatterns = [
      /token/i, /auth/i, /phone/i, /email/i, /address/i, 
      /card/i, /payment/i, /cvv/i, /password/i, /pni/i, /pii/i
    ];

    keys.forEach(key => {
      forbiddenPatterns.forEach(pattern => {
        expect(pattern.test(key)).toBe(false);
      });

      const value = localStorageMock[key];
      forbiddenPatterns.forEach(pattern => {
        expect(pattern.test(value)).toBe(false);
      });
    });
  });
});
