import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { z } from 'zod';

const productFinderRoutes = new Hono();
const registry = Registry.getInstance();

const startSchema = z.object({
  anonymousId: z.string().optional()
});

const answerSchema = z.object({
  stepId: z.string().min(1),
  answer: z.union([z.string(), z.array(z.string())])
});

const actionSchema = z.object({
  action: z.enum(['recommendation_clicked', 'add_to_cart_intent', 'whatsapp_intent']),
  productId: z.string().uuid()
});

productFinderRoutes.post('/sessions', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'INVALID_PAYLOAD' }, 400);

  const userStr = c.req.header('x-user-id');
  const user = userStr ? { id: userStr } : undefined;

  const result = await registry.startProductFinderUseCase.execute({
    userId: user?.id,
    anonymousId: parsed.data.anonymousId
  });

  return c.json(result, 201);
});

productFinderRoutes.put('/sessions/:sessionId/answers', async (c) => {
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json().catch(() => ({}));
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'INVALID_PAYLOAD' }, 400);

  const result = await registry.answerProductFinderStepUseCase.execute({
    sessionId,
    stepId: parsed.data.stepId,
    answer: parsed.data.answer
  });

  if (!result.success) return c.json({ error: result.error }, 400);
  return c.json({ success: true });
});

productFinderRoutes.post('/sessions/:sessionId/complete', async (c) => {
  const sessionId = c.req.param('sessionId');
  const result = await registry.completeProductFinderUseCase.execute({ sessionId });
  
  if (result.error) return c.json({ error: result.error }, 400);
  
  // Strip PII from output just in case
  const safeOutput = registry.productFinderRedactor.redact(result);
  return c.json(safeOutput);
});

productFinderRoutes.get('/sessions/:sessionId/recommendations', async (c) => {
  const sessionId = c.req.param('sessionId');
  const result = await registry.getProductFinderRecommendationsUseCase.execute({ sessionId });
  
  if (result.error) return c.json({ error: result.error }, 400);
  
  const safeOutput = registry.productFinderRedactor.redact(result);
  return c.json(safeOutput);
});

productFinderRoutes.post('/sessions/:sessionId/actions', async (c) => {
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json().catch(() => ({}));
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'INVALID_PAYLOAD' }, 400);

  const result = await registry.recordProductFinderActionUseCase.execute({
    sessionId,
    action: parsed.data.action,
    productId: parsed.data.productId
  });

  if (result.error) return c.json({ error: result.error }, 400);
  return c.json({ success: true });
});

export { productFinderRoutes };
