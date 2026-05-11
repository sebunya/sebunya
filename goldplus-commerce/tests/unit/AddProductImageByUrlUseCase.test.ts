import { describe, it, expect } from 'vitest';
import { AddProductImageByUrlUseCase } from '../../apps/api/src/application/use-cases/products/AddProductImageByUrlUseCase';
import { IProductImageRepository, PersistedProductImage } from '../../apps/api/src/application/ports/IProductImageRepository';

function makeFake(): IProductImageRepository & { saved: PersistedProductImage[] } {
  const saved: PersistedProductImage[] = [];
  return {
    saved,
    async findByProductId(productId) { return saved.filter((s) => s.productId === productId); },
    async add(input) {
      const row: PersistedProductImage = {
        id: `img-${saved.length + 1}`,
        productId: input.productId,
        url: input.url,
        altText: input.altText,
        displayOrder: saved.length,
        isPrimary: input.makePrimary || saved.length === 0,
      };
      saved.push(row);
      return row;
    },
    async remove() { return null; },
    async setPrimary() { /* noop */ },
  };
}

describe('AddProductImageByUrlUseCase', () => {
  const valid = {
    productId: 'prod-1',
    url: 'https://cdn.goldplus.local/img1.png',
    altText: 'Generic Fast Charger',
    makePrimary: false,
  };

  it('persists a valid https URL', async () => {
    const repo = makeFake();
    const uc = new AddProductImageByUrlUseCase(repo);
    const r = await uc.execute(valid);
    expect(r.ok).toBe(true);
    expect(repo.saved).toHaveLength(1);
    if (r.ok) expect(r.image.isPrimary).toBe(true); // first row auto-primary
  });

  it('rejects http (non-https) URLs', async () => {
    const repo = makeFake();
    const uc = new AddProductImageByUrlUseCase(repo);
    const r = await uc.execute({ ...valid, url: 'http://cdn.example.com/img.png' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BAD_INPUT');
    expect(repo.saved).toHaveLength(0);
  });

  it('rejects javascript: URLs', async () => {
    const repo = makeFake();
    const uc = new AddProductImageByUrlUseCase(repo);
    const r = await uc.execute({ ...valid, url: 'javascript:alert(1)' });
    expect(r.ok).toBe(false);
    expect(repo.saved).toHaveLength(0);
  });

  it('rejects data: URLs', async () => {
    const repo = makeFake();
    const uc = new AddProductImageByUrlUseCase(repo);
    const r = await uc.execute({ ...valid, url: 'data:image/png;base64,abc' });
    expect(r.ok).toBe(false);
    expect(repo.saved).toHaveLength(0);
  });

  it('rejects empty productId', async () => {
    const repo = makeFake();
    const uc = new AddProductImageByUrlUseCase(repo);
    const r = await uc.execute({ ...valid, productId: '   ' });
    expect(r.ok).toBe(false);
    expect(repo.saved).toHaveLength(0);
  });

  it('rejects empty URL', async () => {
    const repo = makeFake();
    const uc = new AddProductImageByUrlUseCase(repo);
    const r = await uc.execute({ ...valid, url: '' });
    expect(r.ok).toBe(false);
    expect(repo.saved).toHaveLength(0);
  });

  it('rejects malformed URL strings', async () => {
    const repo = makeFake();
    const uc = new AddProductImageByUrlUseCase(repo);
    const r = await uc.execute({ ...valid, url: 'not-a-url-at-all' });
    expect(r.ok).toBe(false);
    expect(repo.saved).toHaveLength(0);
  });

  it('rejects over-long URLs', async () => {
    const repo = makeFake();
    const uc = new AddProductImageByUrlUseCase(repo);
    const r = await uc.execute({ ...valid, url: 'https://x.com/' + 'a'.repeat(2001) });
    expect(r.ok).toBe(false);
    expect(repo.saved).toHaveLength(0);
  });

  it('preserves the makePrimary flag', async () => {
    const repo = makeFake();
    const uc = new AddProductImageByUrlUseCase(repo);
    await uc.execute(valid); // first image auto-primary
    const r2 = await uc.execute({ ...valid, url: 'https://cdn.goldplus.local/img2.png', makePrimary: true });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.image.isPrimary).toBe(true);
  });
});
