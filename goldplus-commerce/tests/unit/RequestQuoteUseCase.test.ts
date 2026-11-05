import { describe, it, expect } from 'vitest';
import { RequestQuoteUseCase } from '../../apps/api/src/application/use-cases/governance/RequestQuoteUseCase';
import { IQuoteRepository } from '../../apps/api/src/application/ports/IQuoteRepository';
import { Quote } from '../../apps/api/src/domain/quotes/Quote';

function makeFake(): IQuoteRepository & { saved: Quote[] } {
  const saved: Quote[] = [];
  return {
    saved,
    save: async (q) => {
      saved.push(q);
    },
    findAll: async () => saved,
    // Same rule as the Drizzle repository: same phone, product, quantity and message inside the window.
    saveUnlessRecentDuplicate: async (q, windowMs) => {
      const earlier = [...saved].reverse().find((s) => s.phone === q.phone && s.productName === q.productName
        && s.quantity === q.quantity && s.message === q.message && q.createdAt.getTime() - s.createdAt.getTime() <= windowMs);
      if (earlier) return { id: earlier.id, duplicate: true };
      saved.push(q);
      return { id: q.id, duplicate: false };
    },
  };
}

describe('RequestQuoteUseCase', () => {
  const valid = {
    customerName: 'Alice Buyer',
    email: 'alice@example.com',
    phone: '+256700000000',
    productName: 'Fast chargers',
    quantity: '50',
    message: 'Need by end of month.',
    kind: 'wholesale',
  };

  it('persists a quote and returns the new id', async () => {
    const repo = makeFake();
    const uc = new RequestQuoteUseCase(repo);
    const r = await uc.execute(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.quoteId).toMatch(/^[0-9a-f-]{36}$/);
      expect(repo.saved).toHaveLength(1);
      expect(repo.saved[0].id).toBe(r.quoteId);
    }
  });

  it('rejects missing customer name', async () => {
    const repo = makeFake();
    const uc = new RequestQuoteUseCase(repo);
    const r = await uc.execute({ ...valid, customerName: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BAD_INPUT');
    expect(repo.saved).toHaveLength(0);
  });

  it('rejects email without @', async () => {
    const repo = makeFake();
    const uc = new RequestQuoteUseCase(repo);
    const r = await uc.execute({ ...valid, email: 'not-an-email' });
    expect(r.ok).toBe(false);
    expect(repo.saved).toHaveLength(0);
  });

  it('rejects missing quantity', async () => {
    const repo = makeFake();
    const uc = new RequestQuoteUseCase(repo);
    const r = await uc.execute({ ...valid, quantity: '' });
    expect(r.ok).toBe(false);
    expect(repo.saved).toHaveLength(0);
  });

  it('normalises email casing/whitespace', async () => {
    const repo = makeFake();
    const uc = new RequestQuoteUseCase(repo);
    await uc.execute({ ...valid, email: '  ALICE@example.COM  ' });
    expect(repo.saved[0].email).toBe('alice@example.com');
  });

  it('allows empty message (optional field)', async () => {
    const repo = makeFake();
    const uc = new RequestQuoteUseCase(repo);
    const r = await uc.execute({ ...valid, message: '' });
    expect(r.ok).toBe(true);
  });

  it('keeps the unit a buyer typed, so staff read "2 cartons", not "2" (brief WP1, no-JS path)', async () => {
    const repo = makeFake();
    const uc = new RequestQuoteUseCase(repo);
    await uc.execute({ ...valid, quantity: '2 cartons', message: '' });
    expect(repo.saved[0].message).toBe('[Quantity as typed: 2 cartons]');
    await uc.execute({ ...valid, quantity: '1,200' });
    expect(repo.saved[1].message).toBe('Need by end of month.');
    expect(repo.saved[1].quantity).toBe(1200);
  });

  it('a double tap or retry of the plain form yields ONE enquiry with the same id', async () => {
    const repo = makeFake();
    const uc = new RequestQuoteUseCase(repo);
    const a = await uc.execute(valid);
    const b = await uc.execute(valid);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.quoteId).toBe(a.quoteId);
    expect(repo.saved).toHaveLength(1);
  });

  it('a genuinely different request is a new enquiry', async () => {
    const repo = makeFake();
    const uc = new RequestQuoteUseCase(repo);
    await uc.execute(valid);
    await uc.execute({ ...valid, quantity: '60' });
    await uc.execute({ ...valid, productName: 'Power banks' });
    expect(repo.saved).toHaveLength(3);
  });
});
