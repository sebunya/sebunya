import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { productFinderRoutes } from '../../src/interfaces/http/routes/product-finder';
import { Registry } from '../../src/infrastructure/Registry';

describe('ProductFinderRoutes', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    // Mock user context mapping
    app.use('*', async (c, next) => {
      c.set('user', { id: 'u1' });
      await next();
    });
    app.route('/product-finder', productFinderRoutes);
  });

  it('starts session successfully', async () => {
    const spy = vi.spyOn(Registry.getInstance().startProductFinderUseCase, 'execute').mockResolvedValue({ sessionId: 'sess-123' });
    
    const res = await app.request('/product-finder/sessions', {
      method: 'POST',
      body: JSON.stringify({ anonymousId: 'anon-1' }),
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'u1' }
    });
    
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sessionId).toBe('sess-123');
    expect(spy).toHaveBeenCalledWith({ userId: 'u1', anonymousId: 'anon-1' });
  });

  it('answers step successfully', async () => {
    const spy = vi.spyOn(Registry.getInstance().answerProductFinderStepUseCase, 'execute').mockResolvedValue({ success: true });
    
    const res = await app.request('/product-finder/sessions/sess-1/answers', {
      method: 'PUT',
      body: JSON.stringify({ stepId: 'cat', answer: 'Power' }),
      headers: { 'Content-Type': 'application/json' }
    });
    
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith({ sessionId: 'sess-1', stepId: 'cat', answer: 'Power' });
  });
});
