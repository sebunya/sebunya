import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GetMyOrderUseCase } from '../../apps/api/src/application/use-cases/orders/CustomerOrderUseCases';
import type { ICustomerOrderRepository } from '../../apps/api/src/application/ports/ICustomerOrderRepository';

/**
 * Reading an order requires OWNING it, not merely holding a session.
 *
 * GET /commerce/orders/:id required a session and then answered with the raw
 * domain order: unmasked phone and email, the delivery address, the delivery GPS
 * coordinates, the line items, the internal user id and the pricing snapshot.
 * It never compared the order's user to the caller's.
 *
 * `findById` also resolves a non-UUID as an ORDER NUMBER, and order numbers are
 * `GP-YYYYMM-` plus four hex characters — 65,536 per month. So any free account
 * could walk a month of orders and read every customer's personal details.
 *
 * The masked, contact-verified, rate-limited path for an order NUMBER is
 * POST /orders/lookup. This route is for a signed-in customer's own order.
 */

const repo = (owner: string): ICustomerOrderRepository =>
  ({
    findByIdForUser: async (orderId: string, userId: string) =>
      userId === owner ? ({ id: orderId, orderNumber: 'GP-202608-ABCD' } as never) : null,
    listForUser: async () => [],
  }) as ICustomerOrderRepository;

describe('the ownership boundary itself', () => {
  it('gives a customer their own order', async () => {
    const result = await new GetMyOrderUseCase(repo('user-1')).execute('order-1', 'user-1');
    expect(result.ok).toBe(true);
  });

  it('refuses another customer the same order', async () => {
    const result = await new GetMyOrderUseCase(repo('user-1')).execute('order-1', 'user-2');
    expect(result.ok).toBe(false);
  });

  it('answers a missing order and someone else’s order identically', async () => {
    // Otherwise the endpoint is an oracle for which order ids exist.
    const notMine = await new GetMyOrderUseCase(repo('user-1')).execute('order-1', 'user-2');
    const missing = await new GetMyOrderUseCase(repo('nobody')).execute('no-such', 'user-2');
    expect(notMine).toEqual(missing);
  });
});

describe('the route is wired to that boundary', () => {
  const src = readFileSync(
    resolve(__dirname, '../../apps/api/src/interfaces/http/routes/commerce.ts'),
    'utf8',
  );
  const handler = src.slice(
    src.indexOf("routes.get('/orders/:id'"),
    src.indexOf("routes.post('/payments/pesapal/start'"),
  );

  it('scopes the read to the session’s own user id', () => {
    expect(handler).toMatch(/GetMyOrderUseCase\(registry\.orderRepo\)\.execute\(id, userId\)/);
    expect(handler).toMatch(/c\.get\('userId'\)/);
  });

  it('no longer reads an order by an enumerable order number', () => {
    // getOrderByIdUseCase resolves a non-UUID as an order number. It belongs to
    // /orders/lookup, which verifies a matching contact and masks its reply.
    expect(handler).not.toMatch(/getOrderByIdUseCase/);
  });

  it('never answers with the raw domain order', () => {
    expect(handler).not.toMatch(/data:\s*order\s*,/);
  });
});
