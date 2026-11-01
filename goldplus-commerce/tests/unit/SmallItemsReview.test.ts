import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GetFulfilmentOverviewUseCase } from '../../apps/api/src/application/use-cases/fulfilment/GetFulfilmentOverviewUseCase';

const read = (p: string) => readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

describe('smaller review items (211, 212, 213)', () => {
  it('every fulfilment /:id route refuses a non-uuid id before touching Postgres', () => {
    const src = read('apps/api/src/interfaces/http/routes/admin/fulfilment.ts');
    const idRoutes = src.match(/^routes\.(get|post|patch|put|delete)\('\/:id[^']*',.*$/gm) ?? [];
    expect(idRoutes.length).toBeGreaterThan(15);
    for (const line of idRoutes) expect(line).toMatch(/'\/:id[^']*', requireTaskId,/);
  });

  it('admin order transition and note refuse a non-uuid id, and a note needs a real order', () => {
    const src = read('apps/api/src/interfaces/http/routes/admin/orders.ts');
    const transition = src.slice(src.indexOf("routes.post('/:id/transition'"), src.indexOf("routes.post('/:id/note'"));
    expect(transition).toMatch(/if \(!ORDER_ID\.test\(orderId\)\) return notFound\(c\);/);
    const note = src.slice(src.indexOf("routes.post('/:id/note'"));
    expect(note).toMatch(/if \(!ORDER_ID\.test\(orderId\)\) return notFound\(c\);/);
    expect(note.indexOf('orderRepo.findById(orderId)')).toBeLessThan(note.indexOf('ORDER_NOTE_ADDED'));
  });

  it('the quote request drops the organisation unless the buyer is an organisation', () => {
    const src = read('apps/web/src/pages/quote-request.astro');
    expect(src).toMatch(/organisation: String\(form\.get\('kind'\) \?\? initialKind\) === 'corporate' \? String\(form\.get\('organisation'\) \?\? ''\)\.trim\(\) : '',/);
  });

  it('the fulfilment badge counts unworkable orders with count(*), uncapped', async () => {
    const find = vi.fn();
    const repo = { countNew: async () => 1, countOverdue: async () => 2, countOrdersWithoutActiveTask: async () => 350, findOrdersWithoutActiveTask: find } as never;
    expect(await new GetFulfilmentOverviewUseCase(repo).badge()).toEqual({ newOrders: 1, overdue: 2, unworkable: 350 });
    expect(find).not.toHaveBeenCalled();
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleFulfilmentRepository.ts')).toMatch(/async countOrdersWithoutActiveTask[\s\S]{0,300}count\(\*\)::int/);
  });
});
