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
});
